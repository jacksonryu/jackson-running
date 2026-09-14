#!/usr/bin/env python3
"""
One-time full-history backfill for Jackson Running Engine.

Fetches Intervals.icu activities + wellness from a user-specified oldest date
through today (KST), then bulk-upserts them into Supabase.

Historical intervals/streams are intentionally NOT fetched here. The daily
workflow continues to fetch detailed data for new/recent running activities.
This keeps the one-time backfill fast and avoids thousands of detail API calls.
"""

import argparse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List

import requests

import sync_to_supabase as core

BATCH_SIZE = 200
KST = timezone(timedelta(hours=9))


def chunks(items: List[dict], size: int) -> Iterable[List[dict]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def bulk_upsert(table: str, rows: List[dict], on_conflict: str) -> None:
    if not rows:
        return
    url = core.supabase_table_url(table)
    headers = core.supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"})
    params = {"on_conflict": on_conflict}
    resp = requests.post(url, headers=headers, params=params, json=rows, timeout=120)
    if resp.status_code >= 400:
        raise RuntimeError(f"{table} bulk upsert failed: HTTP {resp.status_code} - {resp.text[:500]}")


def activity_row(activity: dict) -> Dict[str, Any] | None:
    activity_id = activity.get("id")
    if activity_id is None:
        return None
    row: Dict[str, Any] = {"activity_id": str(activity_id), "raw_response": activity}
    for col, converter, source_key in core.ACTIVITY_COLUMNS:
        row[col] = converter(activity.get(source_key))
    return row


def wellness_row(record: dict) -> Dict[str, Any] | None:
    record_date = core.safe_date_str(record.get("id"))
    if record_date is None:
        return None
    row: Dict[str, Any] = {"date": record_date, "raw_response": record}
    for col, converter, source_key in core.WELLNESS_COLUMNS:
        row[col] = converter(record.get(source_key))
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill all historical Intervals.icu activity/wellness data")
    parser.add_argument("--oldest", default="2000-01-01", help="Oldest date to import, YYYY-MM-DD")
    args = parser.parse_args()

    try:
        oldest = datetime.strptime(args.oldest, "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit("--oldest must be YYYY-MM-DD") from exc

    newest = datetime.now(KST).date()
    if oldest > newest:
        raise SystemExit("--oldest cannot be in the future")

    core.check_config()
    core.check_supabase_connection()
    session = core.make_intervals_session()

    print("=" * 60)
    print(f"FULL HISTORY BACKFILL: {oldest} ~ {newest}")
    print("Activities + wellness only; historical streams/intervals are skipped.")
    print("=" * 60)

    activities = core.fetch_activities(session, oldest, newest)
    wellness = core.fetch_wellness(session, oldest, newest)

    activity_rows = [row for item in activities if (row := activity_row(item)) is not None]
    wellness_rows = [row for item in wellness if (row := wellness_row(item)) is not None]

    print(f"\nActivities to upsert: {len(activity_rows)}")
    done = 0
    for batch_no, batch in enumerate(chunks(activity_rows, BATCH_SIZE), start=1):
        bulk_upsert("activities", batch, "activity_id")
        done += len(batch)
        print(f"  activities batch {batch_no}: {done}/{len(activity_rows)}")

    print(f"\nWellness rows to upsert: {len(wellness_rows)}")
    done = 0
    for batch_no, batch in enumerate(chunks(wellness_rows, BATCH_SIZE), start=1):
        bulk_upsert("wellness_daily", batch, "date")
        done += len(batch)
        print(f"  wellness batch {batch_no}: {done}/{len(wellness_rows)}")

    print("\nBackfill complete.")
    print("Old historical streams/intervals were intentionally skipped; daily sync handles new detailed data.")


if __name__ == "__main__":
    main()
