#!/usr/bin/env python3
"""Jackson Running Engine - Peak / Progress history builder.

Builds personal historical readiness snapshots from Supabase activities + wellness.
The scores are *within-athlete* percentiles, not population rankings.

The historical backfill intentionally did not fetch old streams/interval details, so
this V1 engine uses summary data that exists across the full history. Recent detailed
analytics can still be shown elsewhere on the dashboard.
"""

from __future__ import annotations

import argparse
import math
import os
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""
REST_URL = f"{SUPABASE_URL}/rest/v1" if SUPABASE_URL else ""
KST = timezone(timedelta(hours=9))
PAGE_SIZE = 1000
UPSERT_BATCH = 300

RUN_TYPES = {"Run", "TrailRun", "Treadmill", "VirtualRun"}
ROAD_TYPES = {"Run", "Treadmill", "VirtualRun"}

WEIGHTS = {
    "overall":  {"recovery": .20, "aerobic": .25, "speed": .15, "climbing": .15, "durability": .15, "training": .10},
    "10k":      {"recovery": .15, "aerobic": .25, "speed": .35, "climbing": .03, "durability": .10, "training": .12},
    "half":     {"recovery": .15, "aerobic": .30, "speed": .25, "climbing": .03, "durability": .15, "training": .12},
    "marathon": {"recovery": .15, "aerobic": .35, "speed": .12, "climbing": .03, "durability": .23, "training": .12},
    "trail50":  {"recovery": .15, "aerobic": .24, "speed": .05, "climbing": .26, "durability": .20, "training": .10},
    "trail100": {"recovery": .18, "aerobic": .24, "speed": .03, "climbing": .20, "durability": .25, "training": .10},
}


def headers(extra: Optional[dict] = None) -> dict:
    h = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def check_config() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        raise SystemExit(f"Missing env: {', '.join(missing)}")


def fetch_all(table: str, select: str, order: str) -> List[dict]:
    out: List[dict] = []
    offset = 0
    while True:
        params = {
            "select": select,
            "order": order,
            "limit": str(PAGE_SIZE),
            "offset": str(offset),
        }
        r = requests.get(f"{REST_URL}/{table}", headers=headers(), params=params, timeout=60)
        if r.status_code >= 400:
            raise RuntimeError(f"SELECT {table} failed: HTTP {r.status_code} - {r.text[:500]}")
        batch = r.json()
        if not isinstance(batch, list):
            batch = []
        out.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return out


def safe_float(v: Any) -> Optional[float]:
    try:
        if v is None or v == "":
            return None
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def d10(v: Any) -> Optional[date]:
    if not v:
        return None
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def daterange(start: date, end: date) -> Iterable[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def median(values: List[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def mean(values: List[float]) -> Optional[float]:
    return statistics.mean(values) if values else None


def percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    vals = sorted(values)
    if len(vals) == 1:
        return vals[0]
    k = (len(vals) - 1) * p
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return vals[lo]
    return vals[lo] + (vals[hi] - vals[lo]) * (k - lo)


def percentile_score(value: Optional[float], population: List[float]) -> Optional[float]:
    if value is None or not population:
        return None
    vals = sorted(population)
    if len(vals) == 1:
        return 100.0
    # Mid-rank percentile, then map 0..100 percentile -> 20..100 score.
    below = sum(1 for x in vals if x < value)
    equal = sum(1 for x in vals if x == value)
    pct = (below + 0.5 * equal) / len(vals)
    return round(20.0 + 80.0 * pct, 1)


def weighted_score(scores: Dict[str, Optional[float]], weights: Dict[str, float]) -> Optional[float]:
    usable = [(scores[k], w) for k, w in weights.items() if scores.get(k) is not None]
    if len(usable) < 4:
        return None
    total_w = sum(w for _, w in usable)
    return round(sum(float(v) * w for v, w in usable) / total_w, 1)


def upsert_rows(rows: List[dict]) -> None:
    if not rows:
        return
    url = f"{REST_URL}/peak_history"
    h = headers({"Prefer": "resolution=merge-duplicates,return=minimal"})
    for i in range(0, len(rows), UPSERT_BATCH):
        batch = rows[i:i + UPSERT_BATCH]
        r = requests.post(
            url,
            headers=h,
            params={"on_conflict": "metric_date,race_mode"},
            json=batch,
            timeout=120,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"UPSERT peak_history failed: HTTP {r.status_code} - {r.text[:500]}")
        print(f"  upsert {min(i + len(batch), len(rows))}/{len(rows)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", action="store_true", help="Write the complete history instead of recent rows only")
    parser.add_argument("--write-days", type=int, default=30, help="Recent days to upsert when not --full")
    args = parser.parse_args()

    check_config()
    print("[PEAK] fetching complete activity + wellness history")
    activities = fetch_all(
        "activities",
        "activity_id,type,start_date_local,distance,moving_time,total_elevation_gain,average_speed,pace,icu_training_load,icu_rpe",
        "start_date_local.asc",
    )
    wellness = fetch_all(
        "wellness_daily",
        "date,resting_hr,hrv,sleep_secs,sleep_score,atl,ctl,ramp_rate",
        "date.asc",
    )
    print(f"[PEAK] activities={len(activities)}, wellness={len(wellness)}")

    act_by_day: Dict[date, List[dict]] = defaultdict(list)
    run_dates: List[date] = []
    for a in activities:
        d = d10(a.get("start_date_local"))
        if d is None or a.get("type") not in RUN_TYPES:
            continue
        act_by_day[d].append(a)
        run_dates.append(d)

    wellness_by_day: Dict[date, dict] = {}
    for w in wellness:
        d = d10(w.get("date"))
        if d:
            wellness_by_day[d] = w

    all_dates = run_dates + list(wellness_by_day.keys())
    if not all_dates:
        raise SystemExit("No historical activity/wellness rows available")

    start = min(all_dates)
    today = datetime.now(KST).date()
    first_metric_date = start + timedelta(days=27)
    if first_metric_date > today:
        raise SystemExit("Need at least 28 days of history before Peak Engine can score")

    # Daily activity aggregates.
    daily: Dict[date, dict] = {}
    for d in daterange(start, today):
        acts = act_by_day.get(d, [])
        dist_km = sum((safe_float(a.get("distance")) or 0.0) / 1000.0 for a in acts)
        dur_h = sum((safe_float(a.get("moving_time")) or 0.0) / 3600.0 for a in acts)
        elev_m = sum(safe_float(a.get("total_elevation_gain")) or 0.0 for a in acts)
        load = sum(safe_float(a.get("icu_training_load")) or 0.0 for a in acts)
        trail_h = sum((safe_float(a.get("moving_time")) or 0.0) / 3600.0 for a in acts if a.get("type") == "TrailRun")

        quality_speeds: List[float] = []
        fallback_speeds: List[float] = []
        long_hours = 0.0
        max_long_h = 0.0
        max_long_km = 0.0
        for a in acts:
            distance_m = safe_float(a.get("distance")) or 0.0
            moving_s = safe_float(a.get("moving_time")) or 0.0
            speed = safe_float(a.get("average_speed"))
            if not speed and distance_m > 0 and moving_s > 0:
                speed = distance_m / moving_s
            if a.get("type") in ROAD_TYPES and speed and 3000 <= distance_m <= 30000 and 12 * 60 <= moving_s <= 100 * 60:
                fallback_speeds.append(speed)
                rpe = safe_float(a.get("icu_rpe"))
                tload = safe_float(a.get("icu_training_load"))
                if (rpe is not None and rpe >= 4) or (tload is not None and tload >= 30):
                    quality_speeds.append(speed)
            if moving_s >= 90 * 60:
                h = moving_s / 3600.0
                long_hours += h
                max_long_h = max(max_long_h, h)
                max_long_km = max(max_long_km, distance_m / 1000.0)

        daily[d] = {
            "distance_km": dist_km,
            "duration_h": dur_h,
            "elevation_m": elev_m,
            "load": load,
            "trail_h": trail_h,
            "quality_speeds": quality_speeds,
            "fallback_speeds": fallback_speeds,
            "long_hours": long_hours,
            "max_long_h": max_long_h,
            "max_long_km": max_long_km,
        }

    # Recovery raw values by day using rolling personal baselines.
    wellness_dates = sorted(wellness_by_day)
    recovery_day: Dict[date, Optional[float]] = {}
    for d in wellness_dates:
        w = wellness_by_day[d]
        prev = [wellness_by_day[x] for x in wellness_dates if d - timedelta(days=28) <= x < d]
        parts: List[float] = []

        hrv = safe_float(w.get("hrv"))
        hrv_base = median([x for row in prev if (x := safe_float(row.get("hrv"))) is not None])
        if hrv is not None and hrv_base not in (None, 0):
            parts.append(max(0.65, min(1.35, hrv / hrv_base)))

        rhr = safe_float(w.get("resting_hr"))
        rhr_base = median([x for row in prev if (x := safe_float(row.get("resting_hr"))) is not None])
        if rhr not in (None, 0) and rhr_base not in (None, 0):
            parts.append(max(0.65, min(1.35, rhr_base / rhr)))

        sleep_secs = safe_float(w.get("sleep_secs"))
        if sleep_secs is not None:
            parts.append(max(0.55, min(1.20, (sleep_secs / 3600.0) / 8.0)))

        sleep_score = safe_float(w.get("sleep_score"))
        if sleep_score is not None:
            parts.append(max(0.50, min(1.15, sleep_score / 100.0)))

        recovery_day[d] = mean(parts)

    raw_rows: List[dict] = []
    for d in daterange(first_metric_date, today):
        d28 = [daily[x] for x in daterange(d - timedelta(days=27), d)]
        d42 = [daily[x] for x in daterange(max(start, d - timedelta(days=41)), d)]

        distance_28 = sum(x["distance_km"] for x in d28)
        duration_28 = sum(x["duration_h"] for x in d28)
        elevation_28 = sum(x["elevation_m"] for x in d28)
        trail_h_28 = sum(x["trail_h"] for x in d28)
        load_28 = sum(x["load"] for x in d28)

        # Aerobic: sustainable accumulated volume. Duration matters more for trails.
        aerobic_raw = distance_28 + 3.5 * duration_28

        # Climbing: vertical volume plus a small trail-time signal.
        climbing_raw = elevation_28 + 180.0 * trail_h_28

        speeds = [v for x in d42 for v in x["quality_speeds"]]
        if len(speeds) < 2:
            speeds = [v for x in d42 for v in x["fallback_speeds"]]
        speed_raw = percentile(speeds, 0.80) if speeds else None

        long_h = sum(x["long_hours"] for x in d42)
        max_long_h = max((x["max_long_h"] for x in d42), default=0.0)
        max_long_km = max((x["max_long_km"] for x in d42), default=0.0)
        durability_raw = (1.4 * max_long_h + 0.25 * long_h + 0.015 * max_long_km) if long_h > 0 else None

        rec_vals = [recovery_day.get(x) for x in daterange(d - timedelta(days=6), d)]
        rec_vals = [x for x in rec_vals if x is not None]
        recovery_raw = mean(rec_vals)

        w = wellness_by_day.get(d)
        # If today's wellness is missing, use latest <= d within 3 days for CTL/ATL only.
        if w is None:
            candidates = [x for x in wellness_dates if x <= d and (d - x).days <= 3]
            w = wellness_by_day[candidates[-1]] if candidates else None
        ctl = safe_float(w.get("ctl")) if w else None
        atl = safe_float(w.get("atl")) if w else None
        if ctl is not None and ctl > 0:
            ratio = (atl / ctl) if atl is not None else 1.0
            freshness = max(0.68, min(1.08, 1.08 - max(0.0, ratio - 1.0) * 0.28))
            training_raw = ctl * freshness
        elif load_28 > 0:
            training_raw = load_28 / 28.0
        else:
            training_raw = None

        raw_rows.append({
            "metric_date": d,
            "recovery": recovery_raw,
            "aerobic": aerobic_raw,
            "speed": speed_raw,
            "climbing": climbing_raw,
            "durability": durability_raw,
            "training": training_raw,
            "detail": {
                "distance_28d_km": round(distance_28, 1),
                "duration_28d_h": round(duration_28, 2),
                "elevation_28d_m": round(elevation_28),
                "trail_28d_h": round(trail_h_28, 2),
                "load_28d": round(load_28, 1),
                "speed_samples_42d": len(speeds),
                "long_hours_42d": round(long_h, 2),
                "max_long_hours_42d": round(max_long_h, 2),
                "max_long_km_42d": round(max_long_km, 1),
            },
        })

    populations: Dict[str, List[float]] = {}
    for key in ("recovery", "aerobic", "speed", "climbing", "durability", "training"):
        populations[key] = [float(r[key]) for r in raw_rows if r.get(key) is not None]

    output: List[dict] = []
    write_cutoff = first_metric_date if args.full else today - timedelta(days=max(0, args.write_days - 1))
    for r in raw_rows:
        if r["metric_date"] < write_cutoff:
            continue
        axis = {k: percentile_score(r.get(k), populations[k]) for k in populations}
        for mode, weights in WEIGHTS.items():
            overall = weighted_score(axis, weights)
            output.append({
                "metric_date": r["metric_date"].isoformat(),
                "race_mode": mode,
                "overall_score": overall,
                "recovery_score": axis["recovery"],
                "aerobic_score": axis["aerobic"],
                "speed_score": axis["speed"],
                "climbing_score": axis["climbing"],
                "durability_score": axis["durability"],
                "training_state_score": axis["training"],
                "details": r["detail"],
                "computed_at": datetime.now(timezone.utc).isoformat(),
            })

    if not output:
        raise SystemExit("No Peak rows to write")

    print(f"[PEAK] scoring dates={len(raw_rows)}, rows_to_write={len(output)}, full={args.full}")
    upsert_rows(output)
    print("[PEAK] complete")


if __name__ == "__main__":
    main()
