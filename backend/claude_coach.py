#!/usr/bin/env python3
"""
Jackson Running Engine - Claude Coach: claude_coach.py

data/context/daily_context.json (Analytics V1.1이 계산한 결과)을 읽어
Claude API에게 "해석과 훈련 의사결정"만 맡긴다. 숫자 계산은 이미 Python이 끝낸 것이므로
Claude는 절대 숫자를 새로 만들거나 다시 계산하지 않고, 주어진 숫자를 근거로만 코칭한다.

출력:
    - data/coach/coach_report.json (최신)
    - data/coach/coach_report_YYYY-MM-DD.json (날짜별 백업)
    - 콘솔에 한국어 코칭 리포트
    - Supabase coach_reports 테이블에 동일 결과 저장 (report_date+report_type 기준 upsert 방식)

중요:
    - Claude API 호출이 실패하면 아무 파일도 쓰지 않고, Supabase에도 아무것도 저장하지 않는다.
      즉 daily_context.json은 물론이고 기존 coach_report.json도 건드리지 않는다.
    - ANTHROPIC_API_KEY / SUPABASE_SERVICE_ROLE_KEY는 .env에서만 읽고 어디에도 출력하지 않는다.

실행:
    python claude_coach.py
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")

SUPABASE_URL_RAW = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

REQUEST_TIMEOUT_SEC = 60

CONTEXT_FILE = Path("data/context/daily_context.json")
COACH_DIR = Path("data/coach")

# ---------------------------------------------------------------------------
# Timezone: Analytics V1.1과 동일하게 Asia/Seoul
# ---------------------------------------------------------------------------

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:  # noqa: BLE001
    KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    return datetime.now(KST)


# ---------------------------------------------------------------------------
# 설정 확인
# ---------------------------------------------------------------------------

def check_config() -> None:
    missing = [
        name for name, val in [
            ("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY),
            ("SUPABASE_URL", SUPABASE_URL_RAW),
            ("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY),
        ] if not val
    ]
    if missing:
        print(f"[오류] .env 파일에 다음 값이 없습니다: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Supabase REST 헬퍼 (다른 스크립트와 동일한 패턴)
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


def supabase_select(table: str, params: dict) -> list:
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
# daily_context.json 로드
# ---------------------------------------------------------------------------

def load_daily_context() -> dict:
    if not CONTEXT_FILE.exists():
        print(
            f"[오류] {CONTEXT_FILE} 파일이 없습니다. 먼저 build_daily_context.py를 실행하세요.",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        with open(CONTEXT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[오류] {CONTEXT_FILE}을(를) 읽지 못했습니다: {exc}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Claude API: 구조화된 코칭 리포트 요청
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
너는 "Jackson"이라는 한 명의 러너/트레일 러너를 위한 개인 전용 코치, Claude Coach다.

가장 중요한 원칙:
- 너에게 주어지는 daily_context.json은 Python Analytics Engine이 이미 모든 정량 계산
  (rolling mileage/elevation/load, HRV/RHR baseline, easy efficiency, long-run decoupling/durability,
  interval 분석 등)을 끝낸 결과다.
- 너는 절대 숫자를 새로 계산하거나, 다시 추정하거나, 수정하지 않는다.
  오직 주어진 숫자를 근거로 "해석"과 "오늘/향후 훈련에 대한 의사결정"만 한다.
- data_quality나 warnings에 표시된 불확실성(예: 표본 부족, ambiguous, low_confidence_terrain_affected,
  sleep stale 등)이 있으면 반드시 그 사실을 인지하고, 해당 부분은 낮은 확신으로 표시해라.
  없는 데이터를 있는 것처럼 단정하지 마라.
- Jackson은 로드와 트레일을 모두 훈련한다. mileage만 보지 말고 elevation(고도),
  long-run durability(후반 효율 저하), interval quality(반복 운동 품질), recovery(회복 지표)를
  종합적으로 판단해서 훈련을 추천해라.
- 안전이 최우선이다. 회복 지표가 나쁘거나 데이터가 불확실하면 무리한 훈련을 권하지 않는다.
- 반드시 제공된 도구(submit_coaching_report)를 호출해서 구조화된 형태로만 응답해라.
  자유 텍스트로 답하지 마라.
- 모든 텍스트 필드는 한국어로 작성한다.
- submit_coaching_report의 8개 필수 필드(recovery_today, recent_load_interpretation,
  recent_key_workout_review, today_recommendation, plan_b, avoid_today, next_3_days_plan,
  low_confidence_areas)를 하나도 빠짐없이 채워라. 특히 아래 3개는 자주 누락되니 반드시 채워라:
  * recent_load_interpretation: training_volume(distance_7d_km/28d_km 등)과 load(training_load_7d/28d)를
    반드시 인용해서 최근 부하 추이를 해석해라. 최근에 있었던 큰 세션(long_run, interval_analysis)도
    함께 언급해라.
  * recent_key_workout_review: interval_analysis와 long_run 섹션에서 가장 최근의 핵심 훈련을 평가해라.
    interval_analysis.status가 "insufficient_or_ambiguous"이거나 long_run.status가
    "no_long_run_found"/"low_confidence_terrain_affected"이면, "최근 명확한 interval/long run이 없었다"는
    사실 자체를 평가 내용으로 적어라 - 없는 운동을 지어내지 마라.
  * avoid_today: 오늘 피하는 게 나은 훈련·자극을 짧은 문자열의 배열로 적어라. 특별히 피할 게 없다고
    판단되면 필드를 생략하지 말고 빈 배열 []을 반환해라.
- low_confidence_areas와 avoid_today는 둘 다 반드시 문자열의 배열(JSON array)이다. 항목이 하나도
  없더라도 필드 자체를 생략하지 말고 빈 배열 []을 반환해라. 절대 문자열 하나로 뭉쳐서 반환하지 마라.
"""

COACHING_TOOL = {
    "name": "submit_coaching_report",
    "description": "daily_context.json을 근거로 한 오늘의 코칭 리포트를 구조화된 형태로 제출한다.",
    "input_schema": {
        "type": "object",
        "properties": {
            "recovery_today": {
                "type": "string",
                "description": "오늘 회복 상태에 대한 해석 (HRV/RHR/수면/ATL/CTL/ramp rate 등 근거 포함)",
            },
            "recent_load_interpretation": {
                "type": "string",
                "description": (
                    "최근 훈련 부하에 대한 해석. training_volume(distance_7d_km, distance_28d_km 등)과 "
                    "load(training_load_7d, training_load_28d)를 반드시 인용하고, 최근의 큰 세션"
                    "(long run, interval workout 등)이 있었다면 함께 언급해라. 이 필드는 절대 생략하지 마라."
                ),
            },
            "recent_key_workout_review": {
                "type": "string",
                "description": (
                    "최근 핵심 운동(interval_analysis, long_run)에 대한 평가. decoupling/durability/"
                    "interval quality 근거를 포함해라. 최근 명확한 interval이나 long run이 없었다면"
                    "(status가 insufficient_or_ambiguous / no_long_run_found 등) 그 사실을 그대로 적어라. "
                    "이 필드는 절대 생략하지 마라."
                ),
            },
            "today_recommendation": {
                "type": "object",
                "description": "오늘 권장 훈련",
                "properties": {
                    "training_type": {"type": "string", "description": "예: easy run, hill repeats, rest 등"},
                    "distance_km": {"type": ["number", "null"], "description": "권장 거리(km), 해당 없으면 null"},
                    "duration_minutes": {"type": ["number", "null"], "description": "권장 시간(분), 해당 없으면 null"},
                    "intensity_or_pace": {
                        "type": "string",
                        "description": "구체적인 강도 또는 페이스 지시 (예: '5:30-5:45/km', 'Zone 2 HR<149bpm')",
                    },
                    "target_rpe": {"type": ["number", "null"], "description": "목표 RPE(1-10), 해당 없으면 null"},
                    "reasoning": {"type": "string", "description": "이 훈련을 추천하는 근거"},
                },
                "required": [
                    "training_type", "distance_km", "duration_minutes",
                    "intensity_or_pace", "target_rpe", "reasoning",
                ],
            },
            "plan_b": {
                "type": "string",
                "description": "컨디션이 예상보다 안 좋을 때의 대체 훈련",
            },
            "avoid_today": {
                "type": "array",
                "description": (
                    "오늘 피해야 할 훈련/자극의 목록. 각 항목은 한 줄짜리 한국어 문자열이다"
                    "(예: '고강도 인터벌 - HRV 저하로 인해', '장거리 - 회복 부족'). "
                    "피할 게 특별히 없으면 빈 배열 []을 반환한다. 절대 이 필드를 생략하지 말고, "
                    "문자열 하나로 뭉쳐서 반환하지도 말 것 - 반드시 문자열의 배열(array)이어야 한다."
                ),
                "items": {"type": "string"},
            },
            "next_3_days_plan": {
                "type": "array",
                "description": "향후 3일 간단 계획 (오늘 다음날부터 3일)",
                "items": {
                    "type": "object",
                    "properties": {
                        "day_offset": {"type": "integer", "description": "오늘로부터 며칠 뒤 (1, 2, 3)"},
                        "summary": {"type": "string", "description": "그날의 훈련 방향 요약"},
                    },
                    "required": ["day_offset", "summary"],
                },
                "minItems": 3,
                "maxItems": 3,
            },
            "low_confidence_areas": {
                "type": "array",
                "description": (
                    "데이터 품질상 확신이 낮은 부분들의 목록 (data_quality/warnings 근거로). "
                    "각 항목은 한 줄짜리 한국어 문자열이다. 신뢰도가 낮은 항목이 전혀 없으면 "
                    "빈 배열 []을 반환한다. 절대 이 필드를 생략하지 말고, 문자열 하나로 뭉쳐서 "
                    "반환하지도 말 것 - 반드시 문자열의 배열(array)이어야 한다."
                ),
                "items": {"type": "string"},
            },
        },
        "required": [
            "recovery_today",
            "recent_load_interpretation",
            "recent_key_workout_review",
            "today_recommendation",
            "plan_b",
            "avoid_today",
            "next_3_days_plan",
            "low_confidence_areas",
        ],
    },
}


def call_claude_coach(context: dict) -> Dict[str, Any]:
    """
    Claude API를 호출해 구조화된 코칭 리포트를 받는다.
    실패하면 예외를 던진다 (호출부에서 잡아서 '아무 파일도 쓰지 않고 종료' 처리).
    """
    user_content = (
        "다음은 오늘자 daily_context.json이다. 이 데이터에 있는 숫자만 근거로 삼아 "
        "코칭 리포트를 작성해라. 숫자를 새로 계산하지 마라.\n\n"
        "필수 필드 8개(recovery_today, recent_load_interpretation, recent_key_workout_review, "
        "today_recommendation, plan_b, avoid_today, next_3_days_plan, low_confidence_areas)를 "
        "빠짐없이 전부 채워라. 특히 다음 3개는 절대 생략하지 마라:\n"
        "- recent_load_interpretation: training_volume/load의 7일·28일 수치를 인용해서 해석\n"
        "- recent_key_workout_review: interval_analysis/long_run 중 가장 최근 핵심 훈련 평가 "
        "(없으면 '없음'을 사실대로 적을 것)\n"
        "- avoid_today: 문자열 배열. 피할 게 없으면 빈 배열 []\n"
        "low_confidence_areas도 avoid_today와 마찬가지로 항상 문자열 배열이며, 없으면 빈 배열 []이다.\n"
        "예: \"avoid_today\": [\"장거리 - 아직 회복 중\"], \"low_confidence_areas\": "
        "[\"최근 수면 데이터가 1일 전 값임\"]\n\n"
        f"{json.dumps(context, ensure_ascii=False)}"
    )

    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 3000,
        "system": SYSTEM_PROMPT,
        "tools": [COACHING_TOOL],
        "tool_choice": {"type": "tool", "name": "submit_coaching_report"},
        "messages": [{"role": "user", "content": user_content}],
    }
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers=headers,
        json=payload,
        timeout=REQUEST_TIMEOUT_SEC,
    )
    if resp.status_code >= 400:
        # 에러 본문에 우리 키가 포함될 일은 없지만, 혹시 몰라 앞부분만 노출한다.
        raise RuntimeError(f"Claude API 호출 실패: HTTP {resp.status_code} - {resp.text[:300]}")

    data = resp.json()
    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "submit_coaching_report":
            output = block.get("input", {})
            return normalize_coaching_output(output)

    raise RuntimeError("Claude 응답에서 submit_coaching_report tool_use 블록을 찾지 못했습니다.")


def normalize_coaching_output(output: Dict[str, Any]) -> Dict[str, Any]:
    """
    Claude가 스키마를 완벽히 지키지 못했을 때(필드 누락, 타입 불일치)를 대비한 방어 로직.
    프로그램 전체가 죽지 않도록 여기서 안전한 기본값으로 보정한다.
    이 함수를 거친 뒤에도 validate_coaching_output()의 최종 검증은 그대로 수행한다.
    """

    def normalize_string_array(value: Any) -> List[str]:
        """None -> [], 문자열 -> 1개짜리 리스트, 리스트 -> 원소를 문자열로 강제."""
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, list):
            return [str(item) for item in value if item is not None]
        return [str(value)]

    # low_confidence_areas / avoid_today: 둘 다 문자열 배열이어야 한다.
    output["low_confidence_areas"] = normalize_string_array(output.get("low_confidence_areas"))
    output["avoid_today"] = normalize_string_array(output.get("avoid_today"))

    # recent_load_interpretation / recent_key_workout_review: 누락되면 빈 문자열로 보정한다
    # (전체 리포트 생성을 막지 않기 위함 - 값을 지어내지는 않는다).
    output.setdefault("recent_load_interpretation", "")
    if output["recent_load_interpretation"] is None:
        output["recent_load_interpretation"] = ""
    output.setdefault("recent_key_workout_review", "")
    if output["recent_key_workout_review"] is None:
        output["recent_key_workout_review"] = ""

    # next_3_days_plan도 같은 이유로 방어 (누락 시 빈 리스트)
    output.setdefault("next_3_days_plan", [])
    if not isinstance(output["next_3_days_plan"], list):
        output["next_3_days_plan"] = []

    # today_recommendation이 통째로 없으면 최소 구조라도 만들어서 이후 검증에서 명확히 실패하게 한다
    # (여기서 값을 조작해 통과시키지 않고, validate_coaching_output이 필수 하위 필드 누락을 잡아낸다)
    if not isinstance(output.get("today_recommendation"), dict):
        output["today_recommendation"] = {}
    else:
        # nullable 필드는 없으면 None으로 채워 KeyError/타입 오류를 방지한다 (값 자체를 만들어내지 않음)
        for key in ("distance_km", "duration_minutes", "target_rpe"):
            output["today_recommendation"].setdefault(key, None)

    return output


def validate_coaching_output(output: Dict[str, Any]) -> None:
    required_top = [
        "recovery_today", "recent_load_interpretation", "recent_key_workout_review",
        "today_recommendation", "plan_b", "avoid_today", "next_3_days_plan", "low_confidence_areas",
    ]
    missing = [k for k in required_top if k not in output]
    if missing:
        raise RuntimeError(f"Claude 응답에 필수 필드가 없습니다: {missing}")

    if not isinstance(output["low_confidence_areas"], list):
        raise RuntimeError("low_confidence_areas는 배열이어야 합니다 (normalize 이후에도 배열이 아님).")

    if not isinstance(output["avoid_today"], list):
        raise RuntimeError("avoid_today는 배열이어야 합니다 (normalize 이후에도 배열이 아님).")

    if not isinstance(output["recent_load_interpretation"], str):
        raise RuntimeError("recent_load_interpretation은 문자열이어야 합니다.")

    if not isinstance(output["recent_key_workout_review"], str):
        raise RuntimeError("recent_key_workout_review는 문자열이어야 합니다.")

    rec = output.get("today_recommendation")
    if not isinstance(rec, dict) or not all(k in rec for k in ("training_type", "intensity_or_pace", "reasoning")):
        raise RuntimeError("today_recommendation 구조가 올바르지 않습니다 (필수 하위 필드 누락).")

    plan = output.get("next_3_days_plan")
    if not isinstance(plan, list) or len(plan) < 1:
        raise RuntimeError("next_3_days_plan이 올바르지 않습니다 (빈 배열이거나 배열이 아님).")


# ---------------------------------------------------------------------------
# 저장: 로컬 JSON
# ---------------------------------------------------------------------------

def save_coach_report(report: dict) -> None:
    COACH_DIR.mkdir(parents=True, exist_ok=True)
    main_path = COACH_DIR / "coach_report.json"
    dated_path = COACH_DIR / f"coach_report_{now_kst().date().isoformat()}.json"

    with open(main_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(dated_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\n저장 완료: {main_path}")
    print(f"저장 완료: {dated_path}")


# ---------------------------------------------------------------------------
# 저장: Supabase coach_reports (같은 날짜+타입이면 갱신, 아니면 새로 추가)
# ---------------------------------------------------------------------------

def save_to_supabase(report_date_str: str, context: dict, output: Dict[str, Any]) -> None:
    try:
        existing = supabase_select(
            "coach_reports",
            {
                "report_date": f"eq.{report_date_str}",
                "report_type": "eq.daily",
                "activity_id": "is.null",
                "select": "id",
                "limit": "1",
            },
        )
        row = {
            "report_date": report_date_str,
            "report_type": "daily",
            "input_context": context,
            "output": output,
            "model_used": ANTHROPIC_MODEL,
        }
        if existing:
            supabase_patch_by_id("coach_reports", existing[0]["id"], row)
            print(f"Supabase coach_reports 갱신 완료 (id={existing[0]['id']})")
        else:
            supabase_insert("coach_reports", row)
            print("Supabase coach_reports 신규 저장 완료")
    except Exception as exc:  # noqa: BLE001
        # Supabase 저장 실패는 로컬 JSON(이미 저장됨)에 영향을 주지 않는다. 경고만 남기고 계속 진행.
        print(f"[경고] Supabase coach_reports 저장 실패 (로컬 파일은 정상 저장됨): {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------
# 콘솔 출력 (한국어 코칭 리포트)
# ---------------------------------------------------------------------------

def print_console_report(context: dict, output: Dict[str, Any]) -> None:
    rec = output["today_recommendation"]

    print("\n" + "=" * 60)
    print("JACKSON RUNNING ENGINE - 오늘의 코칭 리포트")
    print("=" * 60)

    print("\n■ 오늘 회복 상태")
    print(f"  {output['recovery_today']}")

    print("\n■ 최근 훈련 부하 해석")
    print(f"  {output['recent_load_interpretation']}")

    print("\n■ 최근 핵심 운동 평가")
    print(f"  {output['recent_key_workout_review']}")

    print("\n■ 오늘 권장 훈련")
    print(f"  종목       : {rec.get('training_type')}")
    if rec.get("distance_km") is not None:
        print(f"  거리       : {rec.get('distance_km')} km")
    if rec.get("duration_minutes") is not None:
        print(f"  시간       : {rec.get('duration_minutes')} 분")
    print(f"  강도/페이스 : {rec.get('intensity_or_pace')}")
    if rec.get("target_rpe") is not None:
        print(f"  목표 RPE   : {rec.get('target_rpe')}")
    print(f"  근거       : {rec.get('reasoning')}")

    print("\n■ Plan B (컨디션이 안 좋을 때)")
    print(f"  {output['plan_b']}")

    print("\n■ 오늘 피해야 할 훈련")
    avoid_list = output.get("avoid_today") or []
    if avoid_list:
        for item in avoid_list:
            print(f"  - {item}")
    else:
        print("  (특별히 피해야 할 훈련 없음)")

    print("\n■ 향후 3일 계획")
    for item in sorted(output["next_3_days_plan"], key=lambda x: x.get("day_offset", 0)):
        print(f"  D+{item.get('day_offset')}: {item.get('summary')}")

    print("\n■ 데이터 품질상 확신이 낮은 부분")
    low_conf = output.get("low_confidence_areas") or []
    if low_conf:
        for item in low_conf:
            print(f"  - {item}")
    else:
        print("  (특별히 확신이 낮은 항목 없음)")

    print("\n" + "=" * 60)


def main() -> None:
    check_config()
    context = load_daily_context()

    print(f"daily_context.json 로드 완료 (generated_at_local={context.get('generated_at_local')})")
    if context.get("warnings"):
        print(f"참고: daily_context.json에 warnings {len(context['warnings'])}건이 있습니다 "
              "(Claude에게 low_confidence_areas 판단 근거로 전달됩니다).")

    print(f"\nClaude API 호출 중... (model={ANTHROPIC_MODEL})")
    try:
        output = call_claude_coach(context)
        validate_coaching_output(output)
    except Exception as exc:  # noqa: BLE001
        print(f"\n[오류] Claude Coach 리포트 생성 실패: {exc}", file=sys.stderr)
        print("[오류] 기존 daily_context.json과 이전 coach_report.json은 변경하지 않았습니다.", file=sys.stderr)
        sys.exit(1)

    now_local = now_kst()
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_at_local": now_local.isoformat(),
        "timezone": "Asia/Seoul",
        "model_used": ANTHROPIC_MODEL,
        "source_context_generated_at_local": context.get("generated_at_local"),
        "coaching": output,
    }

    # Claude 호출이 성공한 뒤에만 파일을 쓴다 (실패 시에는 위에서 이미 종료됨).
    save_coach_report(report)
    save_to_supabase(now_local.date().isoformat(), context, output)
    print_console_report(context, output)


if __name__ == "__main__":
    main()
