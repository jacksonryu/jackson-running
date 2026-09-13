#!/usr/bin/env python3
"""
Jackson Running Engine - Analytics V1.1: build_daily_context.py

V1 대비 변경 사항:
    1. Sleep: latest wellness row의 sleepSecs/sleepScore가 null이면 이전 유효값을 찾아
       사용하되, "오늘 값"인 것처럼 표시하지 않고 latest_sleep_data_date / sleep_data_age_days로
       며칠 지난 데이터인지 명시한다.
    2. Hard session을 subjective_hard_sessions(icu_rpe>=7)와
       objective_high_load_sessions(최근 90일 개인 training_load 분포의 상위 percentile)로 분리한다.
       고정 절대 임계값을 임의로 만들지 않는다.
    3. Easy efficiency 후보 조건을 훨씬 보수적으로 만든다 (RPE<=3 우선, 90분 미만,
       icu_hr_zones 값 자체의 타당성 검증, repeated interval workout으로 판정된 activity 제외).
    4. Long-run decoupling을 Road/VirtualRun(speed/HR)과 TrailRun(가능하면 watts/HR,
       아니면 status=low_confidence_terrain_affected)으로 분리한다.
    5. Interval 반복 세트 탐지를 activity 전체의 median 하나가 아니라, 각 activity 내부에서
       거리 기준 clustering으로 찾고, 최근 90일을 최신순으로 스캔해 가장 최근의 명확한
       반복 세트를 채택한다 (디버그 로그로 전 과정을 출력).
    6. 위 각 상황에 대해 warnings를 남기되 스크립트 전체는 계속 진행한다.
    7. 날짜/시간은 Asia/Seoul 기준으로 계산하고, generated_at_local을 함께 기록한다.

이 스크립트는 Claude API를 호출하지 않는다. Supabase에는 SELECT와 derived_metrics
INSERT/UPDATE(값 갱신)만 수행하며 스키마 변경이나 DELETE는 하지 않는다.
Secret/API key는 출력하지 않는다.

실행:
    python build_daily_context.py
"""

import json
import math
import os
import statistics
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL_RAW = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

REQUEST_TIMEOUT_SEC = 30

# ---------------------------------------------------------------------------
# Timezone: Asia/Seoul 명시 (tzdata가 없는 최소 환경 대비 폴백 포함)
# ---------------------------------------------------------------------------

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:  # noqa: BLE001 - tzdata 미설치 등
    KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    return datetime.now(KST)


# ---------------------------------------------------------------------------
# 설정 값 (config)
# ---------------------------------------------------------------------------

LONG_RUN_MINUTES = 90
ROLLING_WINDOWS_DAYS = [7, 28, 42]
EASY_EFFICIENCY_WINDOW_DAYS = 28
BASELINE_WINDOW_DAYS = 28
VALIDITY_THRESHOLD = 0.7
INTERVAL_DISTANCE_TOLERANCE_PCT = 0.10
MIN_INTERVAL_GROUP = 3
INTERVAL_LOOKBACK_DAYS = 90
RECENT_SESSIONS_COUNT = 10

HARD_SESSION_RPE_THRESHOLD = 7
HARD_SESSION_LOOKBACK_DAYS = 90

# objective_high_load_session: 고정 절대값 대신 최근 90일 개인 training_load 분포의 percentile 사용
OBJECTIVE_LOAD_LOOKBACK_DAYS = 90
OBJECTIVE_LOAD_PERCENTILE = 0.90
OBJECTIVE_LOAD_MIN_SAMPLE = 10

# easy-run 후보로 볼 수 있는 종목. TrailRun/VirtualRun도 허용하되 아래 조건들로 보수적으로 걸러낸다.
EASY_CANDIDATE_TYPES = {"Run", "TrailRun", "VirtualRun"}
EASY_RPE_MAX = 3  # icu_rpe가 존재하면 이 값 이하일 때만 easy로 인정 (있는데 높으면 제외)

# icu_hr_zones[0]을 zone1 상한(bpm)으로 해석하기 위한 타당성 범위.
# 이 범위를 벗어나면(예: 실제로는 zone별 체류시간(초) 등 다른 의미일 가능성) 사용하지 않는다.
HR_ZONE1_PLAUSIBLE_MIN = 80
HR_ZONE1_PLAUSIBLE_MAX = 190

# long-run decoupling에서 '지형 영향이 적어 speed/HR을 그대로 써도 되는' 종목.
# 실제 DB에서 확인되지 않은 type은 넣지 않는다 (Treadmill 등은 확인 후 추가).
ROAD_LIKE_TYPES_FOR_DECOUPLING = {"Run", "VirtualRun"}
TRAIL_TYPES_FOR_DECOUPLING = {"TrailRun"}

CANDIDATE_RUNNING_TYPES = {"Run", "TrailRun", "Treadmill", "VirtualRun"}

CONTEXT_DIR = Path("data/context")


# ---------------------------------------------------------------------------
# Supabase REST 헬퍼
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


def check_config() -> None:
    missing = [
        name for name, val in [
            ("SUPABASE_URL", SUPABASE_URL_RAW),
            ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
        ] if not val
    ]
    if missing:
        print(f"[오류] .env 파일에 다음 값이 없습니다: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)


def check_connection() -> None:
    url = f"{SUPABASE_REST_URL}/"
    print(f"[연결 확인] {url}")
    try:
        resp = requests.get(url, headers=supabase_headers(), timeout=REQUEST_TIMEOUT_SEC)
    except requests.exceptions.RequestException as exc:
        print(f"[오류] Supabase에 연결할 수 없습니다: {exc}", file=sys.stderr)
        sys.exit(1)
    if resp.status_code >= 400:
        print(f"[오류] 연결 확인 실패: HTTP {resp.status_code} - {resp.text[:300]}", file=sys.stderr)
        sys.exit(1)
    print(f"[연결 확인] 성공 (HTTP {resp.status_code})\n")


def supabase_select(table: str, params: dict) -> List[dict]:
    url = supabase_table_url(table)
    resp = requests.get(url, headers=supabase_headers(), params=params, timeout=REQUEST_TIMEOUT_SEC)
    if resp.status_code >= 400:
        raise RuntimeError(f"SELECT {table} 실패: HTTP {resp.status_code} - {resp.text[:200]}")
    data = resp.json()
    return data if isinstance(data, list) else []


def supabase_insert(table: str, row: dict) -> None:
    url = supabase_table_url(table)
    headers = supabase_headers({"Prefer": "return=minimal"})
    resp = requests.post(url, headers=headers, json=row, timeout=REQUEST_TIMEOUT_SEC)
    if resp.status_code >= 400:
        raise RuntimeError(f"INSERT {table} 실패: HTTP {resp.status_code} - {resp.text[:200]}")


def supabase_patch_by_id(table: str, row_id: Any, row: dict) -> None:
    url = supabase_table_url(table)
    headers = supabase_headers({"Prefer": "return=minimal"})
    resp = requests.patch(
        url, headers=headers, params={"id": f"eq.{row_id}"}, json=row, timeout=REQUEST_TIMEOUT_SEC
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"UPDATE {table} 실패: HTTP {resp.status_code} - {resp.text[:200]}")


# ---------------------------------------------------------------------------
# 날짜 파싱 헬퍼
# ---------------------------------------------------------------------------

def parse_date_local(value: Any) -> Optional[date]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value).date()
    except ValueError:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None


def parse_date(value: Any) -> Optional[date]:
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def percentile(sorted_values: List[float], pct: float) -> Optional[float]:
    """선형 보간 방식의 percentile (0.0~1.0). sorted_values는 이미 정렬돼 있어야 한다."""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return sorted_values[0]
    k = (len(sorted_values) - 1) * pct
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_values[int(k)]
    d0 = sorted_values[f] * (c - k)
    d1 = sorted_values[c] * (k - f)
    return d0 + d1


# ---------------------------------------------------------------------------
# 경고 수집기
# ---------------------------------------------------------------------------

class WarningLog:
    def __init__(self):
        self.items: List[str] = []

    def add(self, msg: str) -> None:
        self.items.append(msg)
        print(f"  [경고] {msg}")


WARNINGS = WarningLog()
DATA_QUALITY: Dict[str, Any] = {}


def safe_step(section_name: str, func, *args, default=None, **kwargs):
    try:
        return func(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        WARNINGS.add(f"{section_name} 계산 중 오류 발생, 이 섹션은 비워둡니다: {exc}")
        return default


# ---------------------------------------------------------------------------
# 1. Running activity 분류
# ---------------------------------------------------------------------------

def discover_running_types() -> Tuple[Set[str], Set[str]]:
    print("=" * 60)
    print("1. activities.type 실제 값 조사")
    print("=" * 60)
    rows = supabase_select("activities", {"select": "type", "limit": "20000"})
    all_types = {r.get("type") for r in rows if r.get("type")}
    running_types = all_types & CANDIDATE_RUNNING_TYPES

    print(f"  DB에 실제 존재하는 type 전체: {sorted(all_types)}")
    print(f"  이 중 러닝으로 분류해 사용하는 type: {sorted(running_types)}")
    non_running = all_types - running_types
    if non_running:
        print(f"  러닝 분석에서 제외되는 type: {sorted(non_running)}")

    DATA_QUALITY["running_types_found_in_db"] = sorted(all_types)
    DATA_QUALITY["running_types_used"] = sorted(running_types)
    return all_types, running_types


def fetch_running_activities(running_types: Set[str]) -> List[dict]:
    if not running_types:
        WARNINGS.add("DB에서 러닝으로 분류할 수 있는 activity type을 찾지 못했습니다.")
        return []

    type_filter = ",".join(sorted(running_types))
    params = {
        "select": (
            "activity_id,type,start_date_local,distance,moving_time,elapsed_time,"
            "total_elevation_gain,average_heartrate,max_heartrate,average_cadence,"
            "icu_training_load,icu_atl,icu_ctl,icu_rpe,raw_response"
        ),
        "type": f"in.({type_filter})",
        "order": "start_date_local.desc",
        "limit": "5000",
    }
    activities = supabase_select("activities", params)
    print(f"\n  러닝 계열 activity 총 {len(activities)}건 로드")
    DATA_QUALITY["total_running_activities_loaded"] = len(activities)
    return activities


# ---------------------------------------------------------------------------
# 2. Rolling volume
# ---------------------------------------------------------------------------

def rolling_window_stats(
    activities: List[dict], field: str, days: int, today: date
) -> Tuple[Optional[float], dict]:
    cutoff = today - timedelta(days=days - 1)
    total_in_window = 0
    valid_sum = 0.0
    valid_count = 0

    for a in activities:
        d = parse_date_local(a.get("start_date_local"))
        if d is None or d < cutoff or d > today:
            continue
        total_in_window += 1
        v = a.get(field)
        if v is not None:
            valid_sum += v
            valid_count += 1

    meta = {"activities_in_window": total_in_window, "activities_with_value": valid_count}
    if total_in_window == 0:
        meta["reason"] = "no_running_activities_in_window"
        return None, meta
    if valid_count == 0:
        meta["reason"] = "field_missing_on_all_activities_in_window"
        return None, meta
    return valid_sum, meta


def compute_training_volume_and_load(activities: List[dict], today: date) -> Tuple[dict, dict]:
    print("\n" + "=" * 60)
    print("2. Rolling volume / load")
    print("=" * 60)

    volume: Dict[str, Any] = {}
    load: Dict[str, Any] = {}
    quality: Dict[str, Any] = {}

    for days in ROLLING_WINDOWS_DAYS:
        distance_sum, dq = rolling_window_stats(activities, "distance", days, today)
        volume[f"distance_{days}d_km"] = round(distance_sum / 1000, 1) if distance_sum is not None else None
        quality[f"distance_{days}d"] = dq

        if days != 42:
            duration_sum, dq2 = rolling_window_stats(activities, "moving_time", days, today)
            volume[f"duration_{days}d_hours"] = round(duration_sum / 3600, 2) if duration_sum is not None else None
            quality[f"duration_{days}d"] = dq2

            elevation_sum, dq3 = rolling_window_stats(activities, "total_elevation_gain", days, today)
            volume[f"elevation_{days}d_m"] = round(elevation_sum, 0) if elevation_sum is not None else None
            quality[f"elevation_{days}d"] = dq3

        if days != 42:
            load_sum, dq4 = rolling_window_stats(activities, "icu_training_load", days, today)
            load[f"training_load_{days}d"] = round(load_sum, 1) if load_sum is not None else None
            quality[f"training_load_{days}d"] = dq4

    print(f"  distance_7d_km={volume.get('distance_7d_km')} "
          f"distance_28d_km={volume.get('distance_28d_km')} "
          f"distance_42d_km={volume.get('distance_42d_km')}")
    return {"volume": volume, "load": load}, quality


# ---------------------------------------------------------------------------
# 3. Wellness / Recovery (sleep fallback 포함)
# ---------------------------------------------------------------------------

def compute_recovery(today: date) -> Tuple[dict, dict]:
    print("\n" + "=" * 60)
    print("3. Wellness / Recovery")
    print("=" * 60)

    quality: Dict[str, Any] = {}
    rows = supabase_select(
        "wellness_daily",
        {
            "select": "date,resting_hr,hrv,sleep_secs,sleep_score,atl,ctl,ramp_rate",
            "order": "date.desc",
            "limit": "400",
        },
    )
    if not rows:
        WARNINGS.add("wellness_daily에 데이터가 없습니다.")
        quality["reason"] = "no_wellness_data"
        return {}, quality

    parsed = []
    for r in rows:
        d = parse_date(r.get("date"))
        if d is not None and d <= today:
            parsed.append((d, r))
    if not parsed:
        WARNINGS.add("오늘 이전(또는 오늘)의 wellness 데이터가 없습니다.")
        quality["reason"] = "no_wellness_data_up_to_today"
        return {}, quality

    parsed.sort(key=lambda x: x[0], reverse=True)
    latest_date, latest = parsed[0]
    quality["latest_wellness_date"] = latest_date.isoformat()
    print(f"  최신 wellness 날짜: {latest_date}")

    def baseline_median(field: str) -> Tuple[Optional[float], int]:
        start = latest_date - timedelta(days=BASELINE_WINDOW_DAYS)
        end = latest_date - timedelta(days=1)
        values = [r.get(field) for d, r in parsed if start <= d <= end and r.get(field) is not None]
        if not values:
            return None, 0
        return statistics.median(values), len(values)

    recovery: Dict[str, Any] = {}

    latest_hrv = latest.get("hrv")
    hrv_baseline, hrv_n = baseline_median("hrv")
    recovery["latest_hrv"] = latest_hrv
    recovery["hrv_baseline_28d"] = hrv_baseline
    recovery["hrv_deviation_pct"] = (
        round((latest_hrv - hrv_baseline) / hrv_baseline * 100, 1)
        if latest_hrv is not None and hrv_baseline not in (None, 0)
        else None
    )
    quality["hrv_baseline_days_used"] = hrv_n

    latest_rhr = latest.get("resting_hr")
    rhr_baseline, rhr_n = baseline_median("resting_hr")
    recovery["latest_resting_hr"] = latest_rhr
    recovery["resting_hr_baseline_28d"] = rhr_baseline
    recovery["resting_hr_deviation_pct"] = (
        round((latest_rhr - rhr_baseline) / rhr_baseline * 100, 1)
        if latest_rhr is not None and rhr_baseline not in (None, 0)
        else None
    )
    quality["resting_hr_baseline_days_used"] = rhr_n

    # --- Sleep: latest row에 없으면 이전 유효값을 찾되 '오늘 값'처럼 표시하지 않는다 ---
    sleep_date, latest_sleep_secs = None, None
    for d, r in parsed:  # 날짜 내림차순
        if r.get("sleep_secs") is not None:
            sleep_date, latest_sleep_secs = d, r.get("sleep_secs")
            break

    latest_sleep_score = None
    if sleep_date is not None:
        same_day_row = next((r for d, r in parsed if d == sleep_date), None)
        if same_day_row is not None:
            latest_sleep_score = same_day_row.get("sleep_score")

    recovery["latest_sleep_hours"] = round(latest_sleep_secs / 3600, 2) if latest_sleep_secs is not None else None
    recovery["latest_sleep_score"] = latest_sleep_score
    recovery["latest_sleep_data_date"] = sleep_date.isoformat() if sleep_date else None
    recovery["sleep_data_age_days"] = (today - sleep_date).days if sleep_date else None

    if sleep_date is None:
        WARNINGS.add("wellness_daily 어디에도 유효한 sleepSecs 값이 없습니다 (latest sleep missing).")
        quality["sleep_reason"] = "no_sleep_data_found"
    elif sleep_date != latest_date:
        WARNINGS.add(
            f"최신 wellness({latest_date})에 sleep 데이터가 없어 "
            f"{sleep_date}({(today - sleep_date).days}일 전) 값을 대신 사용했습니다 (latest sleep stale)."
        )
        quality["sleep_reason"] = "used_stale_value"

    sleep7_start = latest_date - timedelta(days=6)
    sleep_values = [
        r.get("sleep_secs") for d, r in parsed if sleep7_start <= d <= latest_date and r.get("sleep_secs") is not None
    ]
    recovery["sleep_7d_avg_hours"] = round(statistics.mean(sleep_values) / 3600, 2) if sleep_values else None
    quality["sleep_7d_days_used"] = len(sleep_values)

    recovery["latest_atl"] = latest.get("atl")
    recovery["latest_ctl"] = latest.get("ctl")
    recovery["latest_ramp_rate"] = latest.get("ramp_rate")

    print(f"  HRV={recovery['latest_hrv']} baseline={recovery['hrv_baseline_28d']} "
          f"dev={recovery['hrv_deviation_pct']}%")
    print(f"  Sleep={recovery['latest_sleep_hours']}h (date={recovery['latest_sleep_data_date']}, "
          f"age={recovery['sleep_data_age_days']}일)")
    return recovery, quality


# ---------------------------------------------------------------------------
# 4. Hard session (subjective / objective 분리)
# ---------------------------------------------------------------------------

def compute_hard_sessions(activities: List[dict], today: date) -> Tuple[dict, dict]:
    print("\n" + "=" * 60)
    print("4. Hard session 탐지 (subjective / objective)")
    print("=" * 60)

    quality: Dict[str, Any] = {}
    cutoff = today - timedelta(days=OBJECTIVE_LOAD_LOOKBACK_DAYS)

    recent = []
    for a in activities:
        d = parse_date_local(a.get("start_date_local"))
        if d is not None and d >= cutoff:
            recent.append((d, a))

    subjective = []
    for d, a in recent:
        rpe = a.get("icu_rpe")
        if rpe is not None and rpe >= HARD_SESSION_RPE_THRESHOLD:
            subjective.append({
                "activity_id": a.get("activity_id"),
                "date": a.get("start_date_local"),
                "icu_rpe": rpe,
                "reason": f"icu_rpe >= {HARD_SESSION_RPE_THRESHOLD}",
            })

    loads = sorted(a.get("icu_training_load") for d, a in recent if a.get("icu_training_load") is not None)
    quality["objective_load_sample_size"] = len(loads)

    threshold = None
    if len(loads) >= OBJECTIVE_LOAD_MIN_SAMPLE:
        threshold = percentile(loads, OBJECTIVE_LOAD_PERCENTILE)
    else:
        WARNINGS.add(
            f"objective_high_load_session 계산용 최근 {OBJECTIVE_LOAD_LOOKBACK_DAYS}일 "
            f"training_load 샘플이 {len(loads)}건으로 부족합니다 (최소 {OBJECTIVE_LOAD_MIN_SAMPLE}건 필요) "
            "- metric sample insufficient."
        )
    quality["objective_load_threshold"] = round(threshold, 1) if threshold is not None else None
    quality["objective_load_percentile_used"] = OBJECTIVE_LOAD_PERCENTILE

    objective = []
    if threshold is not None:
        for d, a in recent:
            load = a.get("icu_training_load")
            if load is not None and load >= threshold:
                objective.append({
                    "activity_id": a.get("activity_id"),
                    "date": a.get("start_date_local"),
                    "icu_training_load": load,
                    "icu_rpe": a.get("icu_rpe"),
                    "reason": (
                        f"icu_training_load({load}) >= 최근 {OBJECTIVE_LOAD_LOOKBACK_DAYS}일 "
                        f"{int(OBJECTIVE_LOAD_PERCENTILE*100)}th percentile({round(threshold, 1)})"
                    ),
                })

    quality["subjective_count"] = len(subjective)
    quality["objective_count"] = len(objective)
    print(f"  subjective_hard_sessions: {len(subjective)}건")
    print(f"  objective_high_load_sessions: {len(objective)}건 "
          f"(threshold={quality['objective_load_threshold']}, sample={len(loads)})")

    return {
        "subjective_hard_sessions": subjective,
        "objective_high_load_sessions": objective,
    }, quality


# ---------------------------------------------------------------------------
# 5. Interval 반복 세트 탐지 (activity별 clustering + 90일 역순 스캔)
# ---------------------------------------------------------------------------

def detect_repeat_group(intervals: List[dict]) -> Optional[List[dict]]:
    """
    interval 리스트에서 distance 기준으로 서로 ±10% 이내인 값들을 클러스터링해서
    가장 큰 그룹(>=3개)을 찾는다. 전체 median 하나에 의존하지 않으므로
    warmup/cooldown/recovery가 섞여 있어도 실제 반복되는 work interval 그룹을 찾을 수 있다.

    주의: 이 함수는 '거리가 비슷한 구간이 3개 이상 있다'는 것만 확인한다.
    그것이 실제 의도된 interval workout인지, 그냥 자동 1km 랩(auto-lap)인지는
    classify_workout_group()에서 별도로, 훨씬 엄격하게 검증한다.
    """
    idx_dist = [(i, iv["distance"]) for i, iv in enumerate(intervals) if iv.get("distance") is not None]
    if len(idx_dist) < MIN_INTERVAL_GROUP:
        return None

    best_idx: List[int] = []
    for _, center in idx_dist:
        tol = center * INTERVAL_DISTANCE_TOLERANCE_PCT
        group = [i for i, dist in idx_dist if abs(dist - center) <= tol]
        if len(group) > len(best_idx):
            best_idx = group

    if len(best_idx) < MIN_INTERVAL_GROUP:
        return None
    return [intervals[i] for i in best_idx]


def interval_field(iv: dict, key: str) -> Any:
    """
    activity_intervals 테이블에 컬럼으로 있는 값(label, zone, intensity 등)을 우선 보고,
    없으면 raw_json(원본 API 응답 전체)에서 같은 키를 찾는다.
    type / group_id처럼 테이블에 컬럼화되지 않은 필드는 raw_json에만 있을 수 있다.
    """
    val = iv.get(key)
    if val is not None:
        return val
    raw = iv.get("raw_json")
    if isinstance(raw, dict):
        return raw.get(key)
    return None


# 절대 hard-reject 기준 (metadata/group_id와 무관하게 적용).
HARD_REJECT_MAX_RPE = 2
HARD_REJECT_LOW_TRAINING_LOAD = 20
# work reps가 activity 전체 baseline보다, 그리고 recovery 구간보다 '유의미하게' 높다고
# 인정하기 위한 최소 기준.
MIN_WORK_RECOVERY_HR_GAP_BPM = 10
MIN_WORK_RECOVERY_PACE_GAP_PCT = 8.0
MIN_WORK_VS_BASELINE_HR_GAP_BPM = 8
MIN_WORK_VS_BASELINE_PACE_GAP_PCT = 6.0
# activity 전체가 '의도된 quality session'이었다고 볼 수 있는 최소 RPE/training_load.
QUALITY_SESSION_MIN_RPE = 4
QUALITY_SESSION_MIN_TRAINING_LOAD = 30


def _median_pace_sec_per_km(ivs: List[dict]) -> Optional[float]:
    paces = [
        iv["moving_time"] / (iv["distance"] / 1000)
        for iv in ivs if iv.get("distance") and iv.get("moving_time")
    ]
    return statistics.median(paces) if paces else None


def _metadata_reference_note(all_intervals: List[dict], group: List[dict]) -> str:
    """
    group_id / type / label / recovery 관련 metadata는 '참고 정보'로만 로그에 남긴다.
    이 note의 내용은 True/False 판정에 절대 사용하지 않는다 - 디버깅/설명용이다.
    """
    group_ids = {interval_field(iv, "group_id") for iv in group}
    group_ids.discard(None)
    types_all = {(interval_field(iv, "type") or interval_field(iv, "label") or "").strip().lower()
                 for iv in all_intervals}
    types_all.discard("")
    return f"metadata_ref(group_ids={sorted(group_ids)},types_seen={sorted(types_all)})"


def classify_workout_group(
    all_intervals: List[dict], group: List[dict], activity: dict
) -> Tuple[Optional[bool], str]:
    """
    distance 클러스터링으로 찾은 group이 '의도된 interval workout'인지 '그냥 반복되는 easy 구간'인지
    activity 전체와 rep 강도를 종합해서 판정한다.

    중요: group_id / type / label / recovery 같은 metadata는 어디에도 판정 근거로 쓰지 않는다.
    _metadata_reference_note()로 로그에만 참고용으로 남긴다.

    판정 순서:
      0. Hard reject (아래 중 하나라도 해당하면 무조건 False):
         a. [복합조건] activity RPE<=2 이고, training_load가 낮고, activity 평균 HR이 easy 수준이고,
            reps(work 후보) HR도 easy 수준이면 -> false
         b. reps(work 후보)의 median HR 자체가 easy zone(zone1)보다 낮으면 -> false
            (진짜 interval이라면 reps는 반드시 easy zone보다 확실히 높아야 한다)
      1. Hard reject를 통과했다면, 아래 4가지를 '전부' 만족해야만 True:
         a. 반복 work reps >= 3 (이미 detect_repeat_group에서 보장됨)
         b. work(group)와 recovery(non_group) 사이에 실측 강도 차이(HR 또는 pace)가 존재
         c. work reps가 activity 전체 baseline(activity 평균 HR/페이스)보다 유의하게 높음
         d. activity 전체의 RPE 또는 training_load가 quality session 수준과 일치
      2. 위 4가지 중 하나라도 확인이 안 되면(정보 부족 포함) 억지로 하나를 고르지 않고
         ambiguous(None)로 남긴다.

    반환: (True/False/None, 사유) - 사유 문자열 끝에 metadata는 참고용으로만 덧붙인다.
    """
    group_id_set = {id(iv) for iv in group}
    non_group = [iv for iv in all_intervals if id(iv) not in group_id_set]
    ref_note = _metadata_reference_note(all_intervals, group)

    activity_rpe = activity.get("icu_rpe")
    activity_load = activity.get("icu_training_load")
    activity_avg_hr = activity.get("average_heartrate")
    activity_distance = activity.get("distance")
    activity_moving_time = activity.get("moving_time")

    zone1, _zone_reason = get_hr_zone1_upper(activity.get("raw_response"), activity.get("max_heartrate"))
    avg_hrs_group = [iv.get("average_heartrate") for iv in group if iv.get("average_heartrate") is not None]
    median_hr_group = statistics.median(avg_hrs_group) if avg_hrs_group else None
    pace_group = _median_pace_sec_per_km(group)

    # --- 0-a. 복합 hard reject: RPE 낮음 + load 낮음 + activity 평균 HR easy + reps HR easy ---
    rpe_easy = activity_rpe is not None and activity_rpe <= HARD_REJECT_MAX_RPE
    load_low = activity_load is not None and activity_load < HARD_REJECT_LOW_TRAINING_LOAD
    activity_hr_easy = (
        zone1 is not None and activity_avg_hr is not None and activity_avg_hr < zone1
    )
    reps_hr_easy = zone1 is not None and median_hr_group is not None and median_hr_group < zone1

    if rpe_easy and load_low and activity_hr_easy and reps_hr_easy:
        return False, (
            f"hard_reject_compound_easy_activity(rpe={activity_rpe},load={activity_load},"
            f"activity_avg_hr={activity_avg_hr},reps_median_hr={median_hr_group},zone1={zone1}); {ref_note}"
        )

    # --- 0-b. reps 강도 자체가 easy zone 이하면 그것만으로 충분한 반증 ---
    if zone1 is not None and median_hr_group is not None and median_hr_group < zone1:
        return False, (
            f"reps_median_hr({median_hr_group})_below_easy_zone1({zone1})_not_a_hard_effort; {ref_note}"
        )

    # --- 1-b. work(group) vs recovery(non_group) 실측 강도 차이 ---
    avg_hrs_rest = [iv.get("average_heartrate") for iv in non_group if iv.get("average_heartrate") is not None]
    median_hr_rest = statistics.median(avg_hrs_rest) if avg_hrs_rest else None
    hr_gap_recovery = (
        (median_hr_group - median_hr_rest)
        if (median_hr_group is not None and median_hr_rest is not None) else None
    )
    pace_rest = _median_pace_sec_per_km(non_group)
    pace_gap_recovery_pct = None
    if pace_group and pace_rest:
        pace_gap_recovery_pct = (pace_rest - pace_group) / pace_rest * 100

    has_gap_vs_recovery = bool(non_group) and (
        (hr_gap_recovery is not None and hr_gap_recovery >= MIN_WORK_RECOVERY_HR_GAP_BPM)
        or (pace_gap_recovery_pct is not None and pace_gap_recovery_pct >= MIN_WORK_RECOVERY_PACE_GAP_PCT)
    )

    # --- 1-c. work reps vs activity 전체 baseline ---
    hr_gap_baseline = (
        (median_hr_group - activity_avg_hr)
        if (median_hr_group is not None and activity_avg_hr is not None) else None
    )
    baseline_pace = (
        activity_moving_time / (activity_distance / 1000)
        if activity_distance and activity_moving_time else None
    )
    pace_gap_baseline_pct = None
    if pace_group and baseline_pace:
        pace_gap_baseline_pct = (baseline_pace - pace_group) / baseline_pace * 100

    has_gap_vs_baseline = (
        (hr_gap_baseline is not None and hr_gap_baseline >= MIN_WORK_VS_BASELINE_HR_GAP_BPM)
        or (pace_gap_baseline_pct is not None and pace_gap_baseline_pct >= MIN_WORK_VS_BASELINE_PACE_GAP_PCT)
    )

    # --- 1-d. activity 전체가 quality session 수준(RPE 또는 training_load)인지 ---
    is_quality_session = (
        (activity_rpe is not None and activity_rpe >= QUALITY_SESSION_MIN_RPE)
        or (activity_load is not None and activity_load >= QUALITY_SESSION_MIN_TRAINING_LOAD)
    )

    detail = (
        f"gap_vs_recovery(hr={hr_gap_recovery},pace_pct="
        f"{round(pace_gap_recovery_pct, 1) if pace_gap_recovery_pct is not None else None}), "
        f"gap_vs_baseline(hr={hr_gap_baseline},pace_pct="
        f"{round(pace_gap_baseline_pct, 1) if pace_gap_baseline_pct is not None else None}), "
        f"quality_session(rpe={activity_rpe},load={activity_load})"
    )

    if has_gap_vs_recovery and has_gap_vs_baseline and is_quality_session:
        return True, f"all_criteria_met: {detail}; {ref_note}"

    return None, (
        f"insufficient_evidence(gap_vs_recovery={has_gap_vs_recovery},"
        f"gap_vs_baseline={has_gap_vs_baseline},quality_session={is_quality_session}) "
        f"[{detail}]; {ref_note}"
    )


def compute_interval_analysis(activities: List[dict], today: date) -> Tuple[dict, dict, Set[str]]:
    print("\n" + "=" * 60)
    print("5. Interval analysis (activity별 distance clustering)")
    print("=" * 60)

    quality: Dict[str, Any] = {}
    repeat_workout_ids: Set[str] = set()

    id_rows = supabase_select("activity_intervals", {"select": "activity_id", "limit": "50000"})
    counts = Counter(r["activity_id"] for r in id_rows if r.get("activity_id"))
    eligible_ids = {aid for aid, c in counts.items() if c >= MIN_INTERVAL_GROUP}
    print(f"  activity_intervals distinct activity_id: {len(counts)}건, "
          f"interval {MIN_INTERVAL_GROUP}개 이상: {len(eligible_ids)}건")
    quality["distinct_activity_ids_with_intervals"] = len(counts)
    quality["eligible_3plus_intervals"] = len(eligible_ids)

    by_id = {a["activity_id"]: a for a in activities}
    cutoff = today - timedelta(days=INTERVAL_LOOKBACK_DAYS)

    scan_list = []
    for aid in eligible_ids:
        info = by_id.get(aid)
        if info is None:
            print(f"    [DEBUG] {aid}: interval {counts[aid]}개 있지만 러닝 activity 목록에 없음 "
                  f"(type이 running 후보에 없거나 activities 테이블에 없음)")
            continue
        d = parse_date_local(info.get("start_date_local"))
        if d is None or d < cutoff:
            continue
        scan_list.append((d, aid, info))
    scan_list.sort(key=lambda x: x[0], reverse=True)

    print(f"  최근 {INTERVAL_LOOKBACK_DAYS}일 내 조사 대상: {len(scan_list)}건 (최신순 스캔, 억지로 최신 것을 채택하지 않음)")
    quality["scanned_in_90d"] = len(scan_list)

    chosen: Optional[Tuple[str, date, List[dict], List[dict], str]] = None
    debug_log = []
    for d, aid, info in scan_list:
        ivs = supabase_select(
            "activity_intervals",
            {"activity_id": f"eq.{aid}", "select": "*", "order": "interval_index.asc"},
        )
        distances = [iv.get("distance") for iv in ivs]
        group = detect_repeat_group(ivs)

        classification, class_reason = (None, "no_distance_cluster_found")
        if group:
            classification, class_reason = classify_workout_group(ivs, group, info)

        if group and classification is True:
            group_desc = (
                f"WORKOUT 확정 - cluster {len(group)}개 "
                f"@ ~{round(statistics.median([g['distance'] for g in group]))}m ({class_reason})"
            )
        elif group and classification is False:
            group_desc = f"거리 클러스터는 있으나 workout 아님으로 판정 ({class_reason})"
        elif group:
            group_desc = f"ambiguous - 판단 근거 부족, 채택하지 않음 ({class_reason})"
        else:
            group_desc = "거리 클러스터 없음"

        print(f"    [DEBUG] {aid} ({d}): interval {len(ivs)}개, distances={distances} -> {group_desc}")
        debug_log.append({
            "activity_id": aid, "date": info.get("start_date_local"), "distances": distances,
            "distance_cluster_found": bool(group), "classification": classification, "reason": class_reason,
        })

        if group and classification in (True, None):
            # True(확정) 또는 None(애매)인 경우 모두 '진짜 easy run이라고 확신할 수 없다'고 보고
            # easy efficiency 후보에서는 제외한다. 다만 interval_analysis의 '채택'은 True인 경우만 한다.
            repeat_workout_ids.add(aid)
        if group and classification is True and chosen is None:
            chosen = (aid, d, ivs, group, class_reason)

    quality["debug_scan"] = debug_log[:30]  # JSON이 너무 커지지 않게 최대 30건만 보존

    if chosen is None:
        quality["reason"] = "no_confirmed_repeated_workout_in_90d"
        WARNINGS.add(f"최근 {INTERVAL_LOOKBACK_DAYS}일 내 확실한 반복 interval workout을 찾지 못했습니다 (interval analysis ambiguous).")
        return {
            "status": "insufficient_or_ambiguous",
            "reason": "no_confirmed_repeated_workout_in_90d",
            "source_activity_id": None,
            "detection_reason": None,
        }, quality, repeat_workout_ids

    aid, d, ivs, group, class_reason = chosen
    group = sorted(group, key=lambda iv: iv.get("interval_index", 0))
    source_date = next((a.get("start_date_local") for a in activities if a.get("activity_id") == aid), None)

    reps = []
    for iv in group:
        distance = iv.get("distance")
        moving_time = iv.get("moving_time")
        pace = moving_time / (distance / 1000) if distance and moving_time and distance > 0 else None
        reps.append({
            "distance": distance,
            "moving_time": moving_time,
            "pace_sec_per_km": round(pace, 1) if pace is not None else None,
            "average_heartrate": iv.get("average_heartrate"),
            "max_heartrate": iv.get("max_heartrate"),
            "cadence": iv.get("average_cadence"),
            "watts": iv.get("average_watts"),
        })

    pace_values = [r["pace_sec_per_km"] for r in reps if r["pace_sec_per_km"] is not None]
    pace_cv = None
    if len(pace_values) >= 2 and statistics.mean(pace_values) != 0:
        pace_cv = round(statistics.stdev(pace_values) / statistics.mean(pace_values) * 100, 2)

    def pct_change(field: str) -> Optional[float]:
        first = reps[0].get(field)
        last = reps[-1].get(field)
        if first in (None, 0) or last is None:
            return None
        return round((last - first) / first * 100, 2)

    result = {
        "status": "ok",
        "source_activity_id": aid,
        "source_date": source_date,
        "detection_reason": class_reason,
        "median_group_distance_m": round(statistics.median([r["distance"] for r in reps if r["distance"]]), 0),
        "rep_count": len(reps),
        "reps": reps,
        "pace_coefficient_of_variation_pct": pace_cv,
        "hr_progression_pct": pct_change("average_heartrate"),
        "cadence_change_pct": pct_change("cadence"),
        "power_change_pct": pct_change("watts"),
    }
    print(f"  선택된 activity: {aid} ({d}), rep {len(reps)}개, pace_cv={pace_cv}%, 근거: {class_reason}")
    return result, quality, repeat_workout_ids


# ---------------------------------------------------------------------------
# 6. Easy-run efficiency (보수적 분류)
# ---------------------------------------------------------------------------

def get_hr_zone1_upper(raw_response: Any, max_heartrate: Optional[float]) -> Tuple[Optional[float], Optional[str]]:
    """
    icu_hr_zones[0]을 zone1 상한(bpm)으로 해석한다. 다만 이 필드의 실제 의미가 검증되지 않았으므로
    (예: bpm 경계값이 아니라 zone별 체류시간(초)일 가능성) 아래 타당성 검사(사람의 실제 HR
    범위인지)를 통과하지 못하면 사용하지 않는다.

    주의: 이 활동의 max_heartrate와 비교하는 검사는 넣지 않는다. zone1은 선수 개인의
    고정된 생리학적 경계값이고, 아주 쉬운 러닝은 max_heartrate 자체가 zone1보다 낮을 수도
    있다 (그게 오히려 정상). 그런 검사를 넣으면 '쉬워서 HR이 낮은' activity를 zone1 자체가
    잘못됐다고 오판해 easy 후보에서 제외시키는 버그가 생긴다 (실제 발생했던 버그).
    """
    if not isinstance(raw_response, dict):
        return None, "no_raw_response"
    zones = raw_response.get("icu_hr_zones")
    if not (isinstance(zones, list) and zones and all(isinstance(z, (int, float)) for z in zones)):
        return None, "icu_hr_zones_missing_or_not_numeric_list"

    z1 = float(zones[0])
    if not (HR_ZONE1_PLAUSIBLE_MIN <= z1 <= HR_ZONE1_PLAUSIBLE_MAX):
        return None, f"implausible_zone1_value({z1})"
    return z1, None


def compute_easy_efficiency(
    activities: List[dict], today: date, repeat_workout_ids: Set[str]
) -> Tuple[dict, dict]:
    print("\n" + "=" * 60)
    print("6. Easy-run efficiency (보수적 분류)")
    print("=" * 60)

    quality: Dict[str, Any] = {
        "excluded_type_not_eligible": 0,
        "excluded_long_run": 0,
        "excluded_repeat_workout": 0,
        "excluded_hr_zone_reason": Counter(),
        "excluded_missing_fields": 0,
        "excluded_rpe_too_high": 0,
        "excluded_not_easy_by_hr": 0,
    }

    print("  icu_hr_zones 샘플 (최대 5건):")
    shown = 0
    for a in activities:
        zones = (a.get("raw_response") or {}).get("icu_hr_zones")
        if zones is not None and shown < 5:
            print(f"    {a.get('activity_id')}: icu_hr_zones={zones}, "
                  f"avg_hr={a.get('average_heartrate')}, max_hr={a.get('max_heartrate')}")
            shown += 1
    if shown == 0:
        print("    (icu_hr_zones가 있는 activity를 찾지 못했습니다)")

    candidates = []
    classification_log = []
    print("  판정 상세 (activity_id / avg_hr / max_hr / zone1 / rpe / duration_min / 결과 / 사유):")
    for a in activities:
        aid = a.get("activity_id")
        avg_hr = a.get("average_heartrate")
        max_hr = a.get("max_heartrate")
        rpe = a.get("icu_rpe")
        moving_time = a.get("moving_time")
        duration_min = round(moving_time / 60, 1) if moving_time else None

        def log_decision(accepted: bool, reason: str, zone1_val=None):
            line = (
                f"{aid} / avg_hr={avg_hr} / max_hr={max_hr} / zone1={zone1_val} / "
                f"rpe={rpe} / duration_min={duration_min} / "
                f"{'ACCEPTED' if accepted else 'REJECTED'} / {reason}"
            )
            print(f"    {line}")
            classification_log.append({
                "activity_id": aid, "date": a.get("start_date_local"),
                "avg_hr": avg_hr, "max_hr": max_hr, "easy_hr_boundary": zone1_val,
                "rpe": rpe, "duration_min": duration_min,
                "result": "accepted" if accepted else "rejected", "reason": reason,
            })

        if a.get("type") not in EASY_CANDIDATE_TYPES:
            quality["excluded_type_not_eligible"] += 1
            log_decision(False, "type_not_eligible")
            continue
        if (moving_time or 0) >= LONG_RUN_MINUTES * 60:
            quality["excluded_long_run"] += 1
            log_decision(False, "long_run_excluded(>=90min)")
            continue
        if aid in repeat_workout_ids:
            quality["excluded_repeat_workout"] += 1
            log_decision(False, "classified_as_repeat_workout_activity")
            continue

        zone1, reason = get_hr_zone1_upper(a.get("raw_response"), max_hr)
        if zone1 is None:
            quality["excluded_hr_zone_reason"][reason] += 1
            log_decision(False, reason)
            continue

        distance = a.get("distance")
        if avg_hr is None or not distance or not moving_time:
            quality["excluded_missing_fields"] += 1
            log_decision(False, "missing_avg_hr_distance_or_moving_time", zone1)
            continue

        if rpe is not None and rpe > EASY_RPE_MAX:
            quality["excluded_rpe_too_high"] += 1
            log_decision(False, f"rpe({rpe})_above_easy_max({EASY_RPE_MAX})", zone1)
            continue

        if avg_hr >= zone1:
            quality["excluded_not_easy_by_hr"] += 1
            log_decision(False, f"avg_hr({avg_hr})_at_or_above_zone1({zone1})", zone1)
            continue

        speed_mps = distance / moving_time
        efficiency = speed_mps / avg_hr
        d = parse_date_local(a.get("start_date_local"))
        candidates.append({
            "activity_id": aid, "date": d, "efficiency": efficiency,
            "rpe_known": rpe is not None,
        })
        log_decision(True, f"avg_hr({avg_hr})_below_zone1({zone1})", zone1)

    quality["excluded_hr_zone_reason"] = dict(quality["excluded_hr_zone_reason"])
    quality["candidates_total"] = len(candidates)
    quality["classification_log"] = classification_log[:50]  # JSON 크기 제한을 위해 최대 50건만 보존
    print(f"  최종 easy candidate: {len(candidates)}건")
    print(f"    제외 - type 부적합: {quality['excluded_type_not_eligible']}, "
          f"장거리(>=90min): {quality['excluded_long_run']}, "
          f"반복워크아웃: {quality['excluded_repeat_workout']}")
    print(f"    제외 - HR zone 사유: {quality['excluded_hr_zone_reason']}")
    print(f"    제외 - RPE 높음: {quality['excluded_rpe_too_high']}, "
          f"HR상 easy 아님: {quality['excluded_not_easy_by_hr']}, "
          f"필드 누락: {quality['excluded_missing_fields']}")

    result: Dict[str, Any] = {
        "latest_easy_efficiency": None,
        "easy_efficiency_28d_median": None,
        "easy_efficiency_vs_baseline_pct": None,
        "easy_sessions_used": 0,
    }
    if not candidates:
        quality["reason"] = "no_easy_candidates_found"
        return result, quality

    candidates_dated = [c for c in candidates if c["date"] is not None]
    candidates_dated.sort(key=lambda c: c["date"], reverse=True)
    latest = candidates_dated[0]

    window_start = today - timedelta(days=EASY_EFFICIENCY_WINDOW_DAYS - 1)
    window = [c for c in candidates_dated if window_start <= c["date"] <= today]
    median_eff = statistics.median([c["efficiency"] for c in window]) if window else None

    result["latest_easy_efficiency"] = round(latest["efficiency"], 4)
    result["easy_efficiency_28d_median"] = round(median_eff, 4) if median_eff is not None else None
    result["easy_efficiency_vs_baseline_pct"] = (
        round((latest["efficiency"] - median_eff) / median_eff * 100, 1)
        if median_eff not in (None, 0)
        else None
    )
    result["easy_sessions_used"] = len(window)
    quality["window28_count"] = len(window)

    if len(window) < 3:
        WARNINGS.add(f"easy efficiency 28일 window 표본이 {len(window)}건으로 적어 신뢰도가 낮습니다 (metric sample insufficient).")

    print(f"  latest_easy_efficiency={result['latest_easy_efficiency']} "
          f"28d_median={result['easy_efficiency_28d_median']}")
    return result, quality


# ---------------------------------------------------------------------------
# 7. Long run (Road/VirtualRun vs TrailRun 분리)
# ---------------------------------------------------------------------------

def valid_ratio(arr: Optional[list], positive_only: bool = False) -> Tuple[List[int], float]:
    if not isinstance(arr, list) or not arr:
        return [], 0.0
    idx = [i for i, v in enumerate(arr) if v is not None and (not positive_only or v > 0)]
    return idx, len(idx) / len(arr)


def derive_speed_from_distance(distance_arr: list, time_arr: list) -> List[Optional[float]]:
    speed = [None] * len(distance_arr)
    for i in range(1, len(distance_arr)):
        d0, d1 = distance_arr[i - 1], distance_arr[i]
        t0, t1 = time_arr[i - 1], time_arr[i]
        if None in (d0, d1, t0, t1) or t1 == t0:
            continue
        speed[i] = (d1 - d0) / (t1 - t0)
    return speed


def segment_mean(arr: list, time_arr: list, idx_pool: List[int], t_start: float, t_end: float) -> Optional[float]:
    vals = [arr[i] for i in idx_pool if t_start <= time_arr[i] <= t_end and arr[i] is not None]
    return statistics.mean(vals) if vals else None


def find_long_run_activity(activities: List[dict]) -> Optional[dict]:
    streams_rows = supabase_select("activity_streams", {"select": "activity_id", "limit": "20000"})
    streams_ids = {r["activity_id"] for r in streams_rows if r.get("activity_id")}

    candidates = [
        a for a in activities
        if (a.get("moving_time") or 0) >= LONG_RUN_MINUTES * 60 and a.get("activity_id") in streams_ids
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda a: a.get("start_date_local") or "", reverse=True)
    return candidates[0]


def compute_long_run(activities: List[dict]) -> Tuple[dict, dict]:
    print("\n" + "=" * 60)
    print(f"7. Long run 분석 (>= {LONG_RUN_MINUTES}분, streams 존재, road/trail 분리)")
    print("=" * 60)

    quality: Dict[str, Any] = {}
    result: Dict[str, Any] = {
        "status": "no_long_run_found",
        "source_activity_id": None,
        "source_date": None,
        "source_activity_type": None,
        "source_distance_km": None,
        "source_elevation_gain_m": None,
        "decoupling_method": None,
        "latest_long_run_decoupling_pct": None,
        "decoupling_definition": (
            "decoupling_pct = (EF_first_half - EF_second_half) / EF_first_half * 100; "
            "EF = mean(metric)/mean(heartrate) within the segment. metric은 road/VirtualRun이면 speed(m/s), "
            "TrailRun이고 watts가 있으면 watts. 양수일수록 후반부 효율 저하가 큼."
        ),
        "latest_durability_decline_pct": None,
        "durability_definition": (
            "durability_decline_pct = (EF_first25 - EF_last25) / EF_first25 * 100 "
            "(첫 25% 대비 마지막 25% 효율 저하율, 양수일수록 저하가 큼)"
        ),
        "durability_extras": {
            "cadence_change_pct": None,
            "stance_time_change_pct": None,
            "vertical_ratio_change_pct": None,
            "step_length_change_pct": None,
        },
    }

    activity = find_long_run_activity(activities)
    if activity is None:
        quality["reason"] = "no_long_run_with_streams_found"
        print("  조건에 맞는 long run(90분 이상 + streams 존재)을 찾지 못했습니다.")
        return result, quality

    activity_id = activity["activity_id"]
    activity_type = activity.get("type")
    result.update({
        "source_activity_id": activity_id,
        "source_date": activity.get("start_date_local"),
        "source_activity_type": activity_type,
        "source_distance_km": round(activity["distance"] / 1000, 2) if activity.get("distance") is not None else None,
        "source_elevation_gain_m": activity.get("total_elevation_gain"),
    })
    print(f"  대상: {activity_id} ({activity_type}, {activity.get('start_date_local')})")

    rows = supabase_select("activity_streams", {"activity_id": f"eq.{activity_id}", "select": "streams,point_count"})
    if not rows:
        result["status"] = "insufficient_data"
        quality["reason"] = "streams_row_missing"
        return result, quality

    streams = rows[0].get("streams") or {}
    time_arr = streams.get("time")
    if not isinstance(time_arr, list) or len(time_arr) < 10:
        result["status"] = "insufficient_data"
        quality["reason"] = "time_stream_missing_or_too_short"
        WARNINGS.add(f"{activity_id}: 유효한 time stream이 없어 decoupling/durability를 계산하지 못했습니다.")
        return result, quality

    n = len(time_arr)
    quality["stream_point_count"] = n
    hr = streams.get("heartrate")

    is_trail = activity_type in TRAIL_TYPES_FOR_DECOUPLING
    is_road_like = activity_type in ROAD_LIKE_TYPES_FOR_DECOUPLING

    metric_arr = None
    method = None

    if is_trail:
        watts = streams.get("watts")
        if isinstance(watts, list) and len(watts) == n:
            metric_arr, method = watts, "watts_hr"
        else:
            result["status"] = "low_confidence_terrain_affected"
            quality["reason"] = "trail_run_without_reliable_power_data"
            WARNINGS.add(
                f"{activity_id}: TrailRun인데 신뢰 가능한 watts 데이터가 없어 "
                "velocity_smooth/HR을 그대로 fitness metric으로 쓰지 않고 low_confidence로 표시했습니다 "
                "(trail decoupling low confidence)."
            )
    else:
        velocity = streams.get("velocity_smooth")
        distance_stream = streams.get("distance")
        if isinstance(velocity, list) and len(velocity) == n:
            metric_arr, method = velocity, "speed_hr(velocity_smooth)"
        elif isinstance(distance_stream, list) and len(distance_stream) == n:
            metric_arr, method = derive_speed_from_distance(distance_stream, time_arr), "speed_hr(derived)"
        else:
            result["status"] = "insufficient_data"
            quality["reason"] = "no_speed_stream_available"
            WARNINGS.add(f"{activity_id}: velocity_smooth/distance stream이 없어 decoupling을 계산하지 못했습니다.")
        if not is_road_like and metric_arr is not None:
            quality.setdefault("note", []).append(
                f"type '{activity_type}'은 road/trail 분류가 명확히 확인되지 않아 speed/HR 방식을 기본 적용함"
            )

    result["decoupling_method"] = method

    t_start, t_end = time_arr[0], time_arr[-1]
    t_mid = (t_start + t_end) / 2
    t_q1 = t_start + (t_end - t_start) * 0.25
    t_q3 = t_start + (t_end - t_start) * 0.75

    if metric_arr is not None and isinstance(hr, list) and len(hr) == n:
        hr_idx, _ = valid_ratio(hr, positive_only=True)
        metric_idx, _ = valid_ratio(metric_arr, positive_only=True)
        combined_idx = sorted(set(hr_idx) & set(metric_idx))
        combined_ratio = len(combined_idx) / n if n else 0.0
        quality["hr_metric_valid_ratio"] = round(combined_ratio, 3)

        if combined_ratio >= VALIDITY_THRESHOLD:
            def ef(t0, t1):
                hr_m = segment_mean(hr, time_arr, combined_idx, t0, t1)
                metric_m = segment_mean(metric_arr, time_arr, combined_idx, t0, t1)
                if hr_m in (None, 0) or metric_m is None:
                    return None
                return metric_m / hr_m

            ef_first_half = ef(t_start, t_mid)
            ef_second_half = ef(t_mid, t_end)
            ef_first_q = ef(t_start, t_q1)
            ef_last_q = ef(t_q3, t_end)

            print(f"  [DEBUG] {activity_id} method={method}")
            print(f"  [DEBUG] EF_first_half={ef_first_half} EF_second_half={ef_second_half}")
            print(f"  [DEBUG] EF_first25%={ef_first_q} EF_last25%={ef_last_q}")

            if ef_first_half not in (None, 0) and ef_second_half is not None:
                result["latest_long_run_decoupling_pct"] = round(
                    (ef_first_half - ef_second_half) / ef_first_half * 100, 2
                )
            if ef_first_q not in (None, 0) and ef_last_q is not None:
                result["latest_durability_decline_pct"] = round(
                    (ef_first_q - ef_last_q) / ef_first_q * 100, 2
                )

            if result["status"] == "no_long_run_found":
                result["status"] = "ok"
        else:
            WARNINGS.add(
                f"{activity_id}: HR/{method} 유효 데이터 비율이 {combined_ratio:.0%}로 "
                f"{VALIDITY_THRESHOLD:.0%} 미만이라 decoupling/durability를 계산하지 않았습니다."
            )
            result["status"] = "low_confidence_terrain_affected" if is_trail else "insufficient_data"
            quality["reason"] = "valid_ratio_below_threshold"
    elif metric_arr is None:
        pass  # 위에서 이미 status/이유를 세팅함
    else:
        result["status"] = "insufficient_data"
        quality["reason"] = "heartrate_stream_missing"
        WARNINGS.add(f"{activity_id}: heartrate stream이 없어 decoupling을 계산하지 못했습니다.")

    extra_streams = {
        "cadence_change_pct": streams.get("cadence"),
        "stance_time_change_pct": streams.get("stance_time"),
        "vertical_ratio_change_pct": streams.get("vertical_ratio"),
        "step_length_change_pct": streams.get("step_length"),
    }
    extras_quality = {}
    for key, arr in extra_streams.items():
        if not isinstance(arr, list) or len(arr) != n:
            extras_quality[key] = "stream_missing"
            continue
        idx, ratio = valid_ratio(arr)
        extras_quality[key] = round(ratio, 3)
        if ratio < VALIDITY_THRESHOLD:
            continue
        first_mean = segment_mean(arr, time_arr, idx, t_start, t_q1)
        last_mean = segment_mean(arr, time_arr, idx, t_q3, t_end)
        if first_mean not in (None, 0) and last_mean is not None:
            result["durability_extras"][key] = round((last_mean - first_mean) / first_mean * 100, 2)
    quality["durability_extras_valid_ratio"] = extras_quality

    print(f"  status={result['status']} decoupling={result['latest_long_run_decoupling_pct']}% "
          f"durability_decline={result['latest_durability_decline_pct']}%")
    return result, quality


# ---------------------------------------------------------------------------
# 8. Recent training context
# ---------------------------------------------------------------------------

def compute_recent_context(activities: List[dict], today: date) -> Tuple[list, dict]:
    print("\n" + "=" * 60)
    print("8. Recent training context")
    print("=" * 60)

    quality: Dict[str, Any] = {}
    dated = [(parse_date_local(a.get("start_date_local")), a) for a in activities]
    dated = [(d, a) for d, a in dated if d is not None]
    dated.sort(key=lambda x: x[0], reverse=True)

    recent = []
    for d, a in dated[:RECENT_SESSIONS_COUNT]:
        recent.append({
            "date": a.get("start_date_local"),
            "type": a.get("type"),
            "distance_km": round(a["distance"] / 1000, 2) if a.get("distance") is not None else None,
            "duration_minutes": round(a["moving_time"] / 60, 1) if a.get("moving_time") is not None else None,
            "elevation_gain_m": a.get("total_elevation_gain"),
            "avg_hr": a.get("average_heartrate"),
            "training_load": a.get("icu_training_load"),
            "rpe": a.get("icu_rpe"),
        })

    long_runs = [(d, a) for d, a in dated if (a.get("moving_time") or 0) >= LONG_RUN_MINUTES * 60]
    last_long_run_date = long_runs[0][0].isoformat() if long_runs else None
    days_since_long_run = (today - long_runs[0][0]).days if long_runs else None

    quality["recent_sessions_count"] = len(recent)
    print(f"  최근 세션 {len(recent)}건, last_long_run_date={last_long_run_date}, "
          f"days_since_long_run={days_since_long_run}")

    return recent, {
        "quality": quality,
        "last_long_run_date": last_long_run_date,
        "days_since_long_run": days_since_long_run,
    }


# ---------------------------------------------------------------------------
# 9. derived_metrics UPSERT
# ---------------------------------------------------------------------------

class UpsertStats:
    def __init__(self):
        self.success = 0
        self.failed = 0
        self.skipped = 0
        self.errors: List[str] = []

    def report(self):
        print(f"\n[derived_metrics] 성공 {self.success} / 실패 {self.failed} / 건너뜀(값 없음) {self.skipped}")
        for e in self.errors[:10]:
            print(f"  - {e}")


def upsert_derived_metric(metric_date: str, metric_name: str, value: Optional[float], stats: UpsertStats) -> None:
    if value is None:
        stats.skipped += 1
        return
    try:
        existing = supabase_select(
            "derived_metrics",
            {
                "metric_date": f"eq.{metric_date}",
                "metric_name": f"eq.{metric_name}",
                "activity_id": "is.null",
                "select": "id",
                "limit": "1",
            },
        )
        if existing:
            supabase_patch_by_id(
                "derived_metrics",
                existing[0]["id"],
                {"metric_value": value, "computed_at": datetime.now(timezone.utc).isoformat()},
            )
        else:
            supabase_insert(
                "derived_metrics",
                {"metric_date": metric_date, "metric_name": metric_name, "metric_value": value, "activity_id": None},
            )
        stats.success += 1
    except Exception as exc:  # noqa: BLE001
        stats.failed += 1
        stats.errors.append(f"{metric_name}: {exc}")


def upsert_all_derived_metrics(context: dict, today: date) -> None:
    print("\n" + "=" * 60)
    print("10. derived_metrics UPSERT")
    print("=" * 60)

    stats = UpsertStats()
    today_str = today.isoformat()

    tv = context["training_volume"]
    ld = context["load"]
    rc = context["recovery"]
    ae = context["aerobic_efficiency"]
    lr = context["long_run"]

    metric_map = {
        "distance_7d": tv.get("distance_7d_km"),
        "distance_28d": tv.get("distance_28d_km"),
        "distance_42d": tv.get("distance_42d_km"),
        "elevation_7d": tv.get("elevation_7d_m"),
        "elevation_28d": tv.get("elevation_28d_m"),
        "duration_7d": tv.get("duration_7d_hours"),
        "duration_28d": tv.get("duration_28d_hours"),
        "hrv_baseline_28d": rc.get("hrv_baseline_28d"),
        "hrv_deviation_pct": rc.get("hrv_deviation_pct"),
        "rhr_baseline_28d": rc.get("resting_hr_baseline_28d"),
        "rhr_deviation_pct": rc.get("resting_hr_deviation_pct"),
        "sleep_7d_avg_hours": rc.get("sleep_7d_avg_hours"),
        "easy_efficiency_28d": ae.get("easy_efficiency_28d_median"),
        "latest_long_run_decoupling_pct": lr.get("latest_long_run_decoupling_pct"),
        "latest_durability_decline_pct": lr.get("latest_durability_decline_pct"),
        "training_load_7d": ld.get("training_load_7d"),
        "training_load_28d": ld.get("training_load_28d"),
    }

    for name, value in metric_map.items():
        upsert_derived_metric(today_str, name, value, stats)

    stats.report()


# ---------------------------------------------------------------------------
# 10. 최종 JSON 조립 및 저장
# ---------------------------------------------------------------------------

def build_context() -> dict:
    now_local = now_kst()
    today = now_local.date()

    all_types, running_types = safe_step("running type 조사", discover_running_types, default=(set(), set()))
    activities = safe_step("running activity 로드", fetch_running_activities, running_types, default=[])

    vol_load, vol_quality = safe_step(
        "rolling volume", compute_training_volume_and_load, activities, today,
        default=({"volume": {}, "load": {}}, {})
    )
    recovery, recovery_quality = safe_step("recovery", compute_recovery, today, default=({}, {}))

    interval_analysis, interval_quality, repeat_workout_ids = safe_step(
        "interval analysis", compute_interval_analysis, activities, today,
        default=({"status": "insufficient_or_ambiguous"}, {}, set())
    )

    aerobic, aerobic_quality = safe_step(
        "easy efficiency", compute_easy_efficiency, activities, today, repeat_workout_ids, default=({}, {})
    )
    long_run, long_run_quality = safe_step("long run", compute_long_run, activities, default=({}, {}))
    hard_sessions, hard_quality = safe_step(
        "hard session", compute_hard_sessions, activities, today, default=({}, {})
    )
    recent_sessions, recent_meta = safe_step(
        "recent context", compute_recent_context, activities, today, default=([], {})
    )

    DATA_QUALITY["rolling_volume"] = vol_quality
    DATA_QUALITY["recovery"] = recovery_quality
    DATA_QUALITY["interval_analysis"] = interval_quality
    DATA_QUALITY["easy_efficiency"] = aerobic_quality
    DATA_QUALITY["long_run"] = long_run_quality
    DATA_QUALITY["hard_sessions"] = hard_quality
    DATA_QUALITY.update(recent_meta.get("quality", {}))

    context = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_at_local": now_local.isoformat(),
        "timezone": "Asia/Seoul",
        "data_quality": DATA_QUALITY,
        "training_volume": vol_load.get("volume", {}),
        "recovery": recovery,
        "load": vol_load.get("load", {}),
        "aerobic_efficiency": aerobic,
        "long_run": long_run,
        "interval_analysis": interval_analysis,
        "recent_sessions": recent_sessions,
        "last_long_run_date": recent_meta.get("last_long_run_date"),
        "days_since_long_run": recent_meta.get("days_since_long_run"),
        "known_hard_sessions": hard_sessions if hard_sessions else {
            "subjective_hard_sessions": [], "objective_high_load_sessions": []
        },
        "warnings": WARNINGS.items,
    }
    return context


def save_context(context: dict) -> None:
    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    main_path = CONTEXT_DIR / "daily_context.json"
    dated_path = CONTEXT_DIR / f"daily_context_{now_kst().date().isoformat()}.json"

    with open(main_path, "w", encoding="utf-8") as f:
        json.dump(context, f, ensure_ascii=False, indent=2)
    with open(dated_path, "w", encoding="utf-8") as f:
        json.dump(context, f, ensure_ascii=False, indent=2)

    print(f"\n저장 완료: {main_path}")
    print(f"저장 완료: {dated_path}")


def print_summary(context: dict) -> None:
    tv = context["training_volume"]
    ld = context["load"]
    rc = context["recovery"]
    ae = context["aerobic_efficiency"]
    lr = context["long_run"]
    hs = context["known_hard_sessions"]

    def fmt(v, unit=""):
        return "N/A" if v is None else f"{v}{unit}"

    print("\n" + "=" * 40)
    print("RUNNING ANALYTICS")
    print("=" * 40)
    print(f"7d distance        {fmt(tv.get('distance_7d_km'), ' km')}")
    print(f"28d distance       {fmt(tv.get('distance_28d_km'), ' km')}")
    print(f"28d elevation      {fmt(tv.get('elevation_28d_m'), ' m')}")
    print(f"7d training load   {fmt(ld.get('training_load_7d'))}")
    print(f"28d training load  {fmt(ld.get('training_load_28d'))}")

    print("\nRECOVERY")
    print(f"HRV                {fmt(rc.get('latest_hrv'))}")
    print(f"HRV vs baseline    {fmt(rc.get('hrv_deviation_pct'), '%')}")
    print(f"RHR                {fmt(rc.get('latest_resting_hr'))}")
    sleep_age = rc.get("sleep_data_age_days")
    age_note = f" ({sleep_age}일 전 데이터)" if sleep_age else ""
    print(f"Sleep              {fmt(rc.get('latest_sleep_hours'), ' h')}{age_note}")

    print("\nPERFORMANCE")
    print(f"Easy efficiency    {fmt(ae.get('easy_efficiency_vs_baseline_pct'), '%')}")
    print(f"Long decoupling    {fmt(lr.get('latest_long_run_decoupling_pct'), '%')} (status={lr.get('status')})")
    print(f"Durability decline {fmt(lr.get('latest_durability_decline_pct'), '%')}")

    print("\nHARD SESSIONS (최근 90일)")
    print(f"Subjective (RPE>=7)     {len(hs.get('subjective_hard_sessions', []))}건")
    print(f"Objective (load 상위)   {len(hs.get('objective_high_load_sessions', []))}건")

    if context["warnings"]:
        print(f"\n경고 {len(context['warnings'])}건 (자세한 내용은 daily_context.json의 warnings 참고)")


def print_validation_report(context: dict) -> None:
    """요청된 검증용 콘솔 출력: INTERVAL VALIDATION / EASY VALIDATION."""
    ia = context["interval_analysis"]
    ae = context["aerobic_efficiency"]
    easy_quality = context["data_quality"].get("easy_efficiency", {})

    print("\n" + "=" * 60)
    print("INTERVAL VALIDATION")
    print("=" * 60)
    if ia.get("status") == "ok":
        print(f"selected activity id : {ia.get('source_activity_id')}")
        print(f"selected date        : {ia.get('source_date')}")
        print(f"rep count            : {ia.get('rep_count')}")
        rep_paces = [r.get("pace_sec_per_km") for r in ia.get("reps", [])]
        print(f"rep paces (sec/km)   : {rep_paces}")
        print(f"detection reason     : {ia.get('detection_reason')}")
    else:
        print(f"status               : {ia.get('status')}")
        print(f"reason               : {ia.get('reason')}")
        print("selected activity id : (없음 - 확실한 workout을 찾지 못해 채택하지 않음)")

    print("\n" + "=" * 60)
    print("EASY VALIDATION")
    print("=" * 60)
    print(f"28d easy session count : {ae.get('easy_sessions_used')}")
    print(f"latest efficiency      : {ae.get('latest_easy_efficiency')}")
    print(f"28d median             : {ae.get('easy_efficiency_28d_median')}")

    log = easy_quality.get("classification_log", [])
    recent10 = sorted(
        [entry for entry in log if entry.get("date")],
        key=lambda e: e["date"],
        reverse=True,
    )[:10]
    print(f"\n최근 {len(recent10)}개 판정 상세 (activity_id / date / avg_hr / max_hr / "
          f"easy_hr_boundary / rpe / duration_min / 결과 / 사유):")
    for e in recent10:
        result_label = "ACCEPTED" if e.get("result") == "accepted" else "REJECTED"
        print(
            f"  {e.get('activity_id')} / {e.get('date')} / avg_hr={e.get('avg_hr')} / "
            f"max_hr={e.get('max_hr')} / easy_hr_boundary={e.get('easy_hr_boundary')} / "
            f"rpe={e.get('rpe')} / duration_min={e.get('duration_min')} / "
            f"{result_label} / {e.get('reason')}"
        )


def main() -> None:
    check_config()
    check_connection()

    context = build_context()
    upsert_all_derived_metrics(context, now_kst().date())
    save_context(context)
    print_summary(context)
    print_validation_report(context)


if __name__ == "__main__":
    main()
