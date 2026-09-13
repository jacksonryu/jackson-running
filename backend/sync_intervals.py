#!/usr/bin/env python3
"""
Jackson Running Engine - Step 1: Intervals.icu 데이터 수집기

Intervals.icu API에서 최근 365일치 activity(운동 기록)와 wellness(웰니스) 데이터를
가져와 data/raw/activities.json, data/raw/wellness.json 에 저장합니다.

실행:
    python sync_intervals.py

필요한 사전 설정:
    .env 파일에 INTERVALS_API_KEY, INTERVALS_ATHLETE_ID 값이 있어야 합니다.
    (README.md 참고)
"""

import json
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Union

import requests
from requests.auth import HTTPBasicAuth
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------

load_dotenv()

API_KEY = os.getenv("INTERVALS_API_KEY")
ATHLETE_ID = os.getenv("INTERVALS_ATHLETE_ID")

BASE_URL = "https://intervals.icu/api/v1"
DAYS_BACK = 365
CHUNK_DAYS = 90          # 한 번의 요청으로 가져올 기간 (API 부담을 줄이기 위해 분할)
MAX_RETRIES = 5
INITIAL_BACKOFF_SEC = 2

DATA_DIR = Path("data/raw")
ACTIVITIES_FILE = DATA_DIR / "activities.json"
WELLNESS_FILE = DATA_DIR / "wellness.json"


def _fail(msg: str) -> None:
    print(f"[오류] {msg}", file=sys.stderr)
    sys.exit(1)


def check_config() -> None:
    if not API_KEY:
        _fail(
            ".env 파일에 INTERVALS_API_KEY가 설정되어 있지 않습니다. "
            ".env.example을 참고해서 .env 파일을 만들어주세요."
        )
    if not ATHLETE_ID:
        _fail(
            ".env 파일에 INTERVALS_ATHLETE_ID가 설정되어 있지 않습니다. "
            ".env.example을 참고해서 .env 파일을 만들어주세요."
        )


def make_session() -> requests.Session:
    session = requests.Session()
    # Intervals.icu 개인 API key는 HTTP Basic Auth로 사용합니다.
    # 사용자명은 문자 그대로 "API_KEY", 비밀번호는 실제 발급받은 키입니다.
    session.auth = HTTPBasicAuth("API_KEY", API_KEY)
    return session


def _request_with_retry(
    session: requests.Session, url: str, params: dict
) -> Union[list, dict]:
    """레이트 리밋(429)과 일시적 오류를 처리하며 GET 요청을 보낸다."""
    backoff = INITIAL_BACKOFF_SEC
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, params=params, timeout=30)
        except requests.RequestException as exc:
            if attempt == MAX_RETRIES:
                _fail(f"네트워크 오류로 요청에 실패했습니다: {exc}")
            print(f"  네트워크 오류, {backoff}초 후 재시도 ({attempt}/{MAX_RETRIES}): {exc}")
            time.sleep(backoff)
            backoff *= 2
            continue

        if resp.status_code == 200:
            return resp.json()

        if resp.status_code == 401:
            _fail(
                "인증 실패(401). INTERVALS_API_KEY / INTERVALS_ATHLETE_ID 값을 확인하세요. "
                "Intervals.icu > Settings 페이지 하단에서 API Key를 다시 확인해보세요."
            )

        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", backoff))
            print(f"  레이트 리밋(429) 도달, {retry_after}초 대기 후 재시도 ({attempt}/{MAX_RETRIES})")
            time.sleep(retry_after)
            backoff *= 2
            continue

        if 500 <= resp.status_code < 600:
            if attempt == MAX_RETRIES:
                _fail(f"서버 오류({resp.status_code})가 반복되어 중단합니다: {resp.text[:300]}")
            print(f"  서버 오류({resp.status_code}), {backoff}초 후 재시도 ({attempt}/{MAX_RETRIES})")
            time.sleep(backoff)
            backoff *= 2
            continue

        # 그 외 예상하지 못한 상태 코드
        _fail(f"예상하지 못한 응답({resp.status_code}): {resp.text[:300]}")

    _fail("재시도 횟수를 초과했습니다.")
    return []  # 도달하지 않지만 타입 체커를 위해


def date_chunks(days_back: int, chunk_days: int):
    """오늘부터 days_back일 전까지를 chunk_days 단위로 나눠 (oldest, newest) 쌍을 생성."""
    today = date.today()
    start = today - timedelta(days=days_back)
    cursor = start
    while cursor <= today:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), today)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def fetch_activities(session: requests.Session) -> List[dict]:
    print(f"\n[1/2] 최근 {DAYS_BACK}일 activity 수집 중...")
    url = f"{BASE_URL}/athlete/{ATHLETE_ID}/activities"
    all_activities: Dict[str, dict] = {}

    for oldest, newest in date_chunks(DAYS_BACK, CHUNK_DAYS):
        params = {"oldest": oldest.isoformat(), "newest": newest.isoformat()}
        print(f"  요청: {oldest} ~ {newest}")
        result = _request_with_retry(session, url, params)
        if not isinstance(result, list):
            print(f"  경고: 예상하지 못한 응답 형식, 건너뜁니다: {type(result)}")
            continue
        for activity in result:
            activity_id = activity.get("id")
            if activity_id is None:
                continue
            all_activities[activity_id] = activity
        print(f"    -> {len(result)}건 수신 (누적 고유 {len(all_activities)}건)")
        time.sleep(0.5)  # API에 부담을 주지 않기 위한 짧은 대기

    return list(all_activities.values())


def fetch_wellness(session: requests.Session) -> List[dict]:
    print(f"\n[2/2] 최근 {DAYS_BACK}일 wellness 수집 중...")
    url = f"{BASE_URL}/athlete/{ATHLETE_ID}/wellness"
    all_wellness: Dict[str, dict] = {}

    for oldest, newest in date_chunks(DAYS_BACK, CHUNK_DAYS):
        params = {"oldest": oldest.isoformat(), "newest": newest.isoformat()}
        print(f"  요청: {oldest} ~ {newest}")
        result = _request_with_retry(session, url, params)
        if not isinstance(result, list):
            print(f"  경고: 예상하지 못한 응답 형식, 건너뜁니다: {type(result)}")
            continue
        for entry in result:
            entry_id = entry.get("id")  # wellness는 날짜 문자열이 id
            if entry_id is None:
                continue
            all_wellness[entry_id] = entry
        print(f"    -> {len(result)}건 수신 (누적 고유 {len(all_wellness)}건)")
        time.sleep(0.5)

    return list(all_wellness.values())


def load_existing(path: Path) -> Dict[str, dict]:
    """기존에 저장된 파일이 있으면 id를 key로 하는 dict로 읽어온다."""
    if not path.exists():
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            records = json.load(f)
    except (json.JSONDecodeError, OSError):
        print(f"  경고: 기존 파일 {path}을(를) 읽지 못해 새로 만듭니다.")
        return {}
    return {r["id"]: r for r in records if "id" in r}


def merge_and_save(path: Path, new_records: List[dict]) -> List[dict]:
    """기존 데이터와 새 데이터를 id 기준으로 병합(중복 제거)하고 저장한다."""
    existing = load_existing(path)
    for record in new_records:
        record_id = record.get("id")
        if record_id is not None:
            existing[record_id] = record  # 같은 id는 최신 데이터로 덮어씀

    merged = list(existing.values())
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    return merged


def summarize_activities(activities: List[dict]) -> None:
    print("\n" + "=" * 60)
    print("Activity 요약")
    print("=" * 60)
    if not activities:
        print("저장된 activity가 없습니다.")
        return

    print(f"총 activity 수: {len(activities)}")

    dated = [a.get("start_date_local") for a in activities if a.get("start_date_local")]
    if dated:
        print(f"기간: {min(dated)} ~ {max(dated)}")

    type_counts: Dict[str, int] = {}
    for a in activities:
        t = a.get("type", "Unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
    print("\n종목별 개수:")
    for t, c in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"  {t}: {c}")

    # 실제 응답에 존재하는 필드 중 관심 있는 항목만 확인한다 (없는 필드를 추측해서 만들지 않는다)
    fields_of_interest = [
        "distance", "moving_time", "elapsed_time", "total_elevation_gain",
        "average_heartrate", "max_heartrate", "average_speed", "icu_average_watts",
        "icu_weighted_avg_watts", "average_cadence", "icu_training_load",
        "icu_atl", "icu_ctl", "perceived_exertion", "type",
    ]
    present = set()
    for a in activities:
        present |= (set(a.keys()) & set(fields_of_interest))

    print("\n확인된 주요 필드 (이 계정의 실제 응답 기준):")
    for f in fields_of_interest:
        mark = "있음" if f in present else "없음 (이 계정 데이터에는 존재하지 않음)"
        print(f"  - {f}: {mark}")

    all_keys = set()
    for a in activities:
        all_keys |= set(a.keys())
    print(f"\n한 activity 레코드에 존재할 수 있는 전체 필드 수: {len(all_keys)}")
    print("(전체 필드 목록은 data/raw/activities.json 파일을 직접 열어 확인하세요.)")


def summarize_wellness(wellness: List[dict]) -> None:
    print("\n" + "=" * 60)
    print("Wellness 요약")
    print("=" * 60)
    if not wellness:
        print("저장된 wellness 기록이 없습니다.")
        return

    print(f"총 wellness 기록 수: {len(wellness)}")
    dates = [w.get("id") for w in wellness if w.get("id")]
    if dates:
        print(f"기간: {min(dates)} ~ {max(dates)}")

    fields_of_interest = ["restingHR", "hrv", "sleepSecs", "sleepScore", "weight", "readiness"]
    present = set()
    for w in wellness:
        present |= (set(w.keys()) & set(fields_of_interest))
    print("\n확인된 주요 필드 (이 계정의 실제 응답 기준):")
    for f in fields_of_interest:
        mark = "있음" if f in present else "없음 (이 계정 데이터에는 존재하지 않음)"
        print(f"  - {f}: {mark}")


def main() -> None:
    check_config()
    session = make_session()

    activities = fetch_activities(session)
    merged_activities = merge_and_save(ACTIVITIES_FILE, activities)

    wellness = fetch_wellness(session)
    merged_wellness = merge_and_save(WELLNESS_FILE, wellness)

    print("\n저장 완료:")
    print(f"  - {ACTIVITIES_FILE} ({len(merged_activities)}건)")
    print(f"  - {WELLNESS_FILE} ({len(merged_wellness)}건)")

    summarize_activities(merged_activities)
    summarize_wellness(merged_wellness)


if __name__ == "__main__":
    main()
