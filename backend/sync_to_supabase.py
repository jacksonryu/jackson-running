#!/usr/bin/env python3
"""
Jackson Running Engine - Step 3: 통합 자동 동기화 (Intervals.icu -> Supabase)

sync_intervals.py(수집) + import_to_supabase.py(적재)를 하나로 합친 스크립트.
Intervals.icu API에서 최신 데이터를 직접 조회해서 중간에 로컬 JSON을 거치지 않고
바로 Supabase Data API로 UPSERT한다.

동작 방식:
    - 최초 실행(로컬 상태 파일이 없을 때): 최근 365일 전체를 동기화
    - 이후 실행: 최근 INCREMENTAL_SYNC_DAYS(기본 7)일만 다시 조회해서
      새 activity뿐 아니라 최근에 수정된 activity/wellness도 갱신
    - activity_intervals / activity_streams는 "이미 Supabase에 저장된 적 없는
      Run 계열 activity"에 대해서만 새로 내려받는다 (매번 반복 다운로드하지 않음)

사전 조건:
    - database/schema.sql을 Supabase에 먼저 적용해 둘 것
    - .env에 INTERVALS_API_KEY, INTERVALS_ATHLETE_ID, SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY 4개가 모두 있을 것

실행:
    python sync_to_supabase.py                 # 기본: 증분 동기화 (또는 최초라면 365일)
    python sync_to_supabase.py --full           # 강제로 365일 전체 재동기화
    python sync_to_supabase.py --json-backup    # data/raw/*.json 로컬 백업도 같이 남김 (선택)
"""

import argparse
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import requests
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

INTERVALS_API_KEY = os.getenv("INTERVALS_API_KEY")
INTERVALS_ATHLETE_ID = os.getenv("INTERVALS_ATHLETE_ID")
SUPABASE_URL_RAW = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

INTERVALS_BASE_URL = "https://intervals.icu/api/v1"

FULL_SYNC_DAYS = 365
INCREMENTAL_SYNC_DAYS = 7        # 3~7일 권장 범위 중 기본값. 필요하면 조정.
CHUNK_DAYS = 90                  # Intervals.icu 요청 시 기간 분할 단위 (365일 최초 동기화용)

REQUEST_TIMEOUT_SEC = 30
MAX_RETRIES = 5
INITIAL_BACKOFF_SEC = 2

STATE_FILE = Path("data/.sync_state.json")   # 마지막 동기화 시각 기록 (로컬 state)

# 상세 streams/intervals를 반드시 받아올 종목.
# 'Treadmill'은 이 프로젝트에서 아직 실제 API type 값으로 확인되지 않았으므로
# 실제 활동의 'type' 값을 inspect_data.py 결과로 확인한 뒤 필요하면 이 목록을 조정할 것.
DETAIL_REQUIRED_TYPES = {"Run", "TrailRun", "VirtualRun", "Treadmill"}

_printed_endpoints: Set[str] = set()


def log(msg: str) -> None:
    print(msg)


def fail(msg: str) -> None:
    print(f"[오류] {msg}", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# 설정 검증
# ---------------------------------------------------------------------------

def check_config() -> None:
    missing = []
    if not INTERVALS_API_KEY:
        missing.append("INTERVALS_API_KEY")
    if not INTERVALS_ATHLETE_ID:
        missing.append("INTERVALS_ATHLETE_ID")
    if not SUPABASE_URL_RAW:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        fail(f".env 파일에 다음 값이 없습니다: {', '.join(missing)}")


# ---------------------------------------------------------------------------
# Supabase REST URL / 연결 확인 (import_to_supabase.py와 동일한 방식)
# ---------------------------------------------------------------------------

def normalize_base_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    url = url.strip().rstrip("/")
    lowered = url.lower()
    for suffix in ("/rest/v1", "/rest/v1/".rstrip("/")):
        if lowered.endswith(suffix):
            url = url[: -len(suffix)]
            break
    return url.rstrip("/")


SUPABASE_BASE_URL = normalize_base_url(SUPABASE_URL_RAW)
SUPABASE_REST_URL = f"{SUPABASE_BASE_URL}/rest/v1" if SUPABASE_BASE_URL else None


def supabase_table_url(table: str) -> str:
    return f"{SUPABASE_REST_URL}/{table}"


def supabase_headers(extra: Optional[dict] = None) -> dict:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def log_endpoint_once(method: str, url: str, params: Optional[dict] = None) -> None:
    key = f"{method} {url}?{params}"
    if key in _printed_endpoints:
        return
    _printed_endpoints.add(key)
    log(f"  [요청] {method} {url}" + (f"  (params={params})" if params else ""))


def check_supabase_connection() -> None:
    if not SUPABASE_BASE_URL:
        fail("SUPABASE_URL이 비어있습니다. 형식: https://<project-id>.supabase.co")

    check_url = f"{SUPABASE_REST_URL}/"
    log("=" * 60)
    log("0. Supabase 연결 확인")
    log("=" * 60)
    log(f"  base URL: {SUPABASE_BASE_URL}")
    log(f"  REST endpoint: {check_url}")

    try:
        resp = requests.get(check_url, headers=supabase_headers(), timeout=REQUEST_TIMEOUT_SEC)
    except requests.exceptions.RequestException as exc:
        fail(f"Supabase에 연결할 수 없습니다: {exc}")
        return

    if resp.status_code >= 400:
        fail(f"Supabase 연결 확인 실패: HTTP {resp.status_code} - {resp.text[:300]}")
        return

    log(f"  연결 확인 성공 (HTTP {resp.status_code})\n")


def supabase_upsert(table: str, row: dict, on_conflict: str) -> None:
    url = supabase_table_url(table)
    params = {"on_conflict": on_conflict}
    log_endpoint_once("POST", url, params)

    headers = supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"})
    resp = requests.post(url, headers=headers, params=params, json=row, timeout=REQUEST_TIMEOUT_SEC)
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")


def supabase_get_existing_activity_ids_with_streams() -> Set[str]:
    """
    이미 activity_streams에 저장된 activity_id 목록을 가져온다.
    -> 이 목록에 없는 activity만 '새로 발견한 activity'로 간주해 intervals/streams를 내려받는다.
    """
    url = supabase_table_url("activity_streams")
    params = {"select": "activity_id", "limit": "100000"}
    log_endpoint_once("GET", url, params)
    try:
        resp = requests.get(url, headers=supabase_headers(), params=params, timeout=REQUEST_TIMEOUT_SEC)
        resp.raise_for_status()
        rows = resp.json()
        return {r["activity_id"] for r in rows if "activity_id" in r}
    except (requests.exceptions.RequestException, ValueError, KeyError) as exc:
        log(f"  [경고] 기존 activity_streams 목록 조회 실패 ({exc}) - 모든 대상 activity를 새로 처리합니다.")
        return set()


# ---------------------------------------------------------------------------
# 로컬 동기화 상태 (마지막 동기화 시각)
# ---------------------------------------------------------------------------

def load_sync_state() -> Optional[dict]:
    if not STATE_FILE.exists():
        return None
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def save_sync_state(last_synced_at: datetime) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump({"last_synced_at": last_synced_at.isoformat()}, f, ensure_ascii=False, indent=2)


def determine_sync_window(force_full: bool) -> Tuple[date, date, bool]:
    """반환: (oldest, newest, is_first_run)"""
    # GitHub Actions runner는 UTC이므로 한국 날짜(UTC+9)를 명시적으로 사용한다.
    today = datetime.now(timezone(timedelta(hours=9))).date()
    state = load_sync_state()
    if force_full or state is None:
        return today - timedelta(days=FULL_SYNC_DAYS), today, True
    return today - timedelta(days=INCREMENTAL_SYNC_DAYS), today, False


# ---------------------------------------------------------------------------
# Intervals.icu 세션 / 요청 (재시도 포함)
# ---------------------------------------------------------------------------

def make_intervals_session() -> requests.Session:
    session = requests.Session()
    session.auth = HTTPBasicAuth("API_KEY", INTERVALS_API_KEY)
    return session


def intervals_request(session: requests.Session, url: str, params: Optional[dict] = None) -> Union[list, dict, None]:
    """
    404는 '이 리소스가 없음'으로 간주해 None 반환 (오류 아님, 예: interval 없는 easy run).
    그 외 오류는 재시도하고, 그래도 실패하면 None을 반환하며 경고만 출력한다
    (전체 동기화가 죽지 않게 하기 위해 여기서는 sys.exit 하지 않는다).
    """
    backoff = INITIAL_BACKOFF_SEC
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, params=params, timeout=REQUEST_TIMEOUT_SEC)
        except requests.exceptions.RequestException as exc:
            if attempt == MAX_RETRIES:
                log(f"    [경고] 네트워크 오류로 요청 실패, 건너뜁니다: {exc}")
                return None
            time.sleep(backoff)
            backoff *= 2
            continue

        if resp.status_code == 200:
            if not resp.text.strip():
                return None
            return resp.json()
        if resp.status_code == 404:
            return None
        if resp.status_code == 401:
            fail("Intervals.icu 인증 실패(401). INTERVALS_API_KEY / INTERVALS_ATHLETE_ID를 확인하세요.")
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", backoff))
            log(f"    레이트 리밋(429), {retry_after}초 대기 후 재시도 ({attempt}/{MAX_RETRIES})")
            time.sleep(retry_after)
            backoff *= 2
            continue
        if 500 <= resp.status_code < 600:
            if attempt == MAX_RETRIES:
                log(f"    [경고] 서버 오류({resp.status_code}) 반복, 건너뜁니다.")
                return None
            time.sleep(backoff)
            backoff *= 2
            continue

        log(f"    [경고] 예상하지 못한 응답({resp.status_code}): {resp.text[:200]}")
        return None

    return None


def date_chunks(oldest: date, newest: date, chunk_days: int):
    cursor = oldest
    while cursor <= newest:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), newest)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def fetch_activities(session: requests.Session, oldest: date, newest: date) -> List[dict]:
    log(f"\n[Intervals.icu] activity 조회: {oldest} ~ {newest}")
    url = f"{INTERVALS_BASE_URL}/athlete/{INTERVALS_ATHLETE_ID}/activities"
    all_activities: Dict[str, dict] = {}

    for c_oldest, c_newest in date_chunks(oldest, newest, CHUNK_DAYS):
        params = {"oldest": c_oldest.isoformat(), "newest": c_newest.isoformat()}
        result = intervals_request(session, url, params)
        if isinstance(result, list):
            for a in result:
                if a.get("id") is not None:
                    all_activities[str(a["id"])] = a
        time.sleep(0.3)

    log(f"  -> {len(all_activities)}건 조회됨")
    return list(all_activities.values())


def fetch_wellness(session: requests.Session, oldest: date, newest: date) -> List[dict]:
    log(f"\n[Intervals.icu] wellness 조회: {oldest} ~ {newest}")
    url = f"{INTERVALS_BASE_URL}/athlete/{INTERVALS_ATHLETE_ID}/wellness"
    all_wellness: Dict[str, dict] = {}

    for c_oldest, c_newest in date_chunks(oldest, newest, CHUNK_DAYS):
        params = {"oldest": c_oldest.isoformat(), "newest": c_newest.isoformat()}
        result = intervals_request(session, url, params)
        if isinstance(result, list):
            for w in result:
                if w.get("id") is not None:
                    all_wellness[w["id"]] = w
        time.sleep(0.3)

    log(f"  -> {len(all_wellness)}건 조회됨")
    return list(all_wellness.values())


def fetch_activity_intervals(session: requests.Session, activity_id: str) -> List[dict]:
    url = f"{INTERVALS_BASE_URL}/activity/{activity_id}/intervals"
    result = intervals_request(session, url)
    if isinstance(result, dict) and isinstance(result.get("icu_intervals"), list):
        return result["icu_intervals"]
    if isinstance(result, list):
        return result
    return []


def fetch_activity_streams(session: requests.Session, activity_id: str) -> Any:
    url = f"{INTERVALS_BASE_URL}/activity/{activity_id}/streams"
    return intervals_request(session, url)


# ---------------------------------------------------------------------------
# 안전 변환 헬퍼
# ---------------------------------------------------------------------------

def safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_int(value: Any) -> Optional[int]:
    f = safe_float(value)
    if f is None:
        return None
    try:
        return int(f)
    except (TypeError, ValueError, OverflowError):
        return None


def safe_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def safe_datetime_str(value: Any) -> Optional[str]:
    if not value or not isinstance(value, str):
        return None
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return None
    return value


def safe_date_str(value: Any) -> Optional[str]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value[:10])
    except ValueError:
        return None
    return parsed.isoformat()


# ---------------------------------------------------------------------------
# 통계
# ---------------------------------------------------------------------------

class Stats:
    def __init__(self, label: str):
        self.label = label
        self.success = 0
        self.failed = 0
        self.skipped = 0
        self.errors: List[str] = []

    def ok(self):
        self.success += 1

    def fail(self, identifier: str, exc: Exception):
        self.failed += 1
        self.errors.append(f"{identifier}: {exc}")

    def skip(self):
        self.skipped += 1

    def report(self):
        log(f"\n[{self.label}] 성공 {self.success} / 실패 {self.failed} / 건너뜀 {self.skipped}")
        if self.errors:
            log("  실패 상세 (최대 10개 표시):")
            for e in self.errors[:10]:
                log(f"    - {e}")
            if len(self.errors) > 10:
                log(f"    ... 외 {len(self.errors) - 10}건")


# ---------------------------------------------------------------------------
# activities / wellness / intervals / streams 컬럼 매핑 (import_to_supabase.py와 동일)
# ---------------------------------------------------------------------------

ACTIVITY_COLUMNS: List[Tuple[str, Any, str]] = [
    ("type", safe_str, "type"),
    ("start_date_local", safe_datetime_str, "start_date_local"),
    ("distance", safe_float, "distance"),
    ("moving_time", safe_int, "moving_time"),
    ("elapsed_time", safe_int, "elapsed_time"),
    ("total_elevation_gain", safe_float, "total_elevation_gain"),
    ("average_heartrate", safe_float, "average_heartrate"),
    ("max_heartrate", safe_float, "max_heartrate"),
    ("average_speed", safe_float, "average_speed"),
    ("max_speed", safe_float, "max_speed"),
    ("average_cadence", safe_float, "average_cadence"),
    ("gap", safe_float, "gap"),
    ("pace", safe_float, "pace"),
    ("icu_training_load", safe_float, "icu_training_load"),
    ("icu_atl", safe_float, "icu_atl"),
    ("icu_ctl", safe_float, "icu_ctl"),
    ("icu_rpe", safe_float, "icu_rpe"),
]

WELLNESS_COLUMNS: List[Tuple[str, Any, str]] = [
    ("resting_hr", safe_float, "restingHR"),
    ("hrv", safe_float, "hrv"),
    ("sleep_secs", safe_int, "sleepSecs"),
    ("sleep_score", safe_float, "sleepScore"),
    ("weight", safe_float, "weight"),
    ("atl", safe_float, "atl"),
    ("ctl", safe_float, "ctl"),
    ("ramp_rate", safe_float, "rampRate"),
]

INTERVAL_COLUMNS: List[Tuple[str, Any, str]] = [
    ("start_index", safe_int, "start_index"),
    ("end_index", safe_int, "end_index"),
    ("distance", safe_float, "distance"),
    ("moving_time", safe_float, "moving_time"),
    ("elapsed_time", safe_float, "elapsed_time"),
    ("average_heartrate", safe_float, "average_heartrate"),
    ("max_heartrate", safe_float, "max_heartrate"),
    ("average_cadence", safe_float, "average_cadence"),
    ("average_watts", safe_float, "average_watts"),
    ("gap", safe_float, "gap"),
    ("average_gradient", safe_float, "average_gradient"),
    ("total_elevation_gain", safe_float, "total_elevation_gain"),
    ("intensity", safe_float, "intensity"),
    ("zone", safe_str, "zone"),
    ("label", safe_str, "label"),
]


def normalize_streams(streams_data: Any) -> Dict[str, list]:
    normalized: Dict[str, list] = {}
    if isinstance(streams_data, list):
        for item in streams_data:
            if isinstance(item, dict) and "type" in item:
                data = item.get("data", [])
                if isinstance(data, list):
                    normalized[item["type"]] = data
    elif isinstance(streams_data, dict):
        for key, value in streams_data.items():
            if isinstance(value, dict) and isinstance(value.get("data"), list):
                normalized[key] = value["data"]
            elif isinstance(value, list):
                normalized[key] = value
    return normalized


# ---------------------------------------------------------------------------
# Upsert 단계들
# ---------------------------------------------------------------------------

def sync_activities(activities: List[dict], stats: Stats) -> None:
    for activity in activities:
        activity_id = activity.get("id")
        if not activity_id:
            stats.skip()
            continue
        try:
            row: Dict[str, Any] = {"activity_id": str(activity_id), "raw_response": activity}
            for col, converter, source_key in ACTIVITY_COLUMNS:
                row[col] = converter(activity.get(source_key))
            supabase_upsert("activities", row, on_conflict="activity_id")
            stats.ok()
        except Exception as exc:  # noqa: BLE001
            stats.fail(str(activity_id), exc)


def sync_wellness(wellness_records: List[dict], stats: Stats) -> None:
    for record in wellness_records:
        record_date = safe_date_str(record.get("id"))
        if record_date is None:
            stats.skip()
            continue
        try:
            row: Dict[str, Any] = {"date": record_date, "raw_response": record}
            for col, converter, source_key in WELLNESS_COLUMNS:
                row[col] = converter(record.get(source_key))
            supabase_upsert("wellness_daily", row, on_conflict="date")
            stats.ok()
        except Exception as exc:  # noqa: BLE001
            stats.fail(str(record.get("id")), exc)


def sync_intervals_for_activity(activity_id: str, intervals: List[dict], stats: Stats) -> None:
    if not intervals:
        stats.skip()
        return
    for idx, interval in enumerate(intervals):
        if not isinstance(interval, dict):
            stats.skip()
            continue
        try:
            row: Dict[str, Any] = {
                "activity_id": activity_id,
                "interval_index": idx,
                "raw_json": interval,
            }
            for col, converter, source_key in INTERVAL_COLUMNS:
                row[col] = converter(interval.get(source_key))
            supabase_upsert("activity_intervals", row, on_conflict="activity_id,interval_index")
            stats.ok()
        except Exception as exc:  # noqa: BLE001
            stats.fail(f"{activity_id}[{idx}]", exc)


def sync_streams_for_activity(activity_id: str, streams_data: Any, stats: Stats) -> None:
    if streams_data is None:
        stats.skip()
        return
    normalized = normalize_streams(streams_data)
    if not normalized:
        stats.skip()
        return
    stream_types = sorted(normalized.keys())
    point_count = max((len(v) for v in normalized.values()), default=0)
    try:
        row = {
            "activity_id": activity_id,
            "streams": normalized,
            "stream_types": stream_types,
            "point_count": point_count,
        }
        supabase_upsert("activity_streams", row, on_conflict="activity_id")
        stats.ok()
    except Exception as exc:  # noqa: BLE001
        stats.fail(activity_id, exc)


def sync_detail_for_new_activities(
    session: requests.Session,
    activities: List[dict],
    already_synced_ids: Set[str],
    interval_stats: Stats,
    stream_stats: Stats,
) -> None:
    targets = [
        a for a in activities
        if a.get("type") in DETAIL_REQUIRED_TYPES and str(a.get("id")) not in already_synced_ids
    ]
    log(f"\n[상세 동기화 대상] Run 계열이면서 아직 streams가 없는 activity: {len(targets)}건")

    for activity in targets:
        activity_id = str(activity["id"])
        log(f"  - {activity_id} ({activity.get('type')}, {activity.get('start_date_local')})")

        intervals = fetch_activity_intervals(session, activity_id)
        sync_intervals_for_activity(activity_id, intervals, interval_stats)
        time.sleep(0.3)

        streams_data = fetch_activity_streams(session, activity_id)
        sync_streams_for_activity(activity_id, streams_data, stream_stats)
        time.sleep(0.3)


# ---------------------------------------------------------------------------
# (선택) 로컬 JSON 백업 - 기본 비활성화
# ---------------------------------------------------------------------------

def backup_json(activities: List[dict], wellness: List[dict]) -> None:
    raw_dir = Path("data/raw")
    raw_dir.mkdir(parents=True, exist_ok=True)

    def merge_and_save(path: Path, new_records: List[dict]) -> None:
        existing: Dict[str, dict] = {}
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    existing = {r["id"]: r for r in json.load(f) if "id" in r}
            except (json.JSONDecodeError, OSError):
                pass
        for r in new_records:
            if r.get("id") is not None:
                existing[r["id"]] = r
        with open(path, "w", encoding="utf-8") as f:
            json.dump(list(existing.values()), f, ensure_ascii=False, indent=2)

    merge_and_save(raw_dir / "activities.json", activities)
    merge_and_save(raw_dir / "wellness.json", wellness)
    log(f"\n[백업] {raw_dir}/activities.json, wellness.json 갱신 완료")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Intervals.icu -> Supabase 자동 동기화")
    parser.add_argument("--full", action="store_true", help="최근 365일 전체를 강제로 다시 동기화")
    parser.add_argument("--json-backup", action="store_true", help="data/raw/*.json 로컬 백업도 함께 남김")
    args = parser.parse_args()

    check_config()
    check_supabase_connection()  # 시작 시 1회만 수행, 실패하면 여기서 즉시 종료

    oldest, newest, is_first_run = determine_sync_window(force_full=args.full)
    log("=" * 60)
    log(f"동기화 범위: {oldest} ~ {newest}  ({'최초 실행 - 365일' if is_first_run else f'증분 - {INCREMENTAL_SYNC_DAYS}일'})")
    log("=" * 60)

    session = make_intervals_session()

    activities = fetch_activities(session, oldest, newest)
    wellness = fetch_wellness(session, oldest, newest)

    if args.json_backup:
        backup_json(activities, wellness)

    activity_stats = Stats("activities")
    wellness_stats = Stats("wellness_daily")
    interval_stats = Stats("activity_intervals")
    stream_stats = Stats("activity_streams")

    log("\n" + "=" * 60)
    log("1. activities 업서트")
    log("=" * 60)
    sync_activities(activities, activity_stats)

    log("\n" + "=" * 60)
    log("2. wellness_daily 업서트")
    log("=" * 60)
    sync_wellness(wellness, wellness_stats)

    log("\n" + "=" * 60)
    log("3. 새로 발견된 Run 계열 activity의 intervals / streams 동기화")
    log("=" * 60)
    already_synced_ids = supabase_get_existing_activity_ids_with_streams()
    sync_detail_for_new_activities(session, activities, already_synced_ids, interval_stats, stream_stats)

    log("\n" + "=" * 60)
    log("결과 요약")
    log("=" * 60)
    activity_stats.report()
    wellness_stats.report()
    interval_stats.report()
    stream_stats.report()

    # Intervals.icu 조회 자체(activities/wellness fetch)까지는 도달했으므로 상태 갱신.
    # (개별 upsert 일부 실패는 위 통계에 남고, 다음 실행 때 같은 최근 구간을 다시 덮어쓰며 자연 복구됨)
    save_sync_state(datetime.now(timezone.utc))
    log(f"\n동기화 상태 저장 완료: {STATE_FILE}")


if __name__ == "__main__":
    main()
