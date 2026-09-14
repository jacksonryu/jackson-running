# Full History Backfill

Copy the contents of this ZIP into the root of the `jackson-running` repository.

It adds:
- `backend/backfill_history.py`
- `.github/workflows/full-history-backfill.yml`

Then commit and push with GitHub Desktop.

In GitHub:
Actions → Full History Backfill → Run workflow

Leave `oldest_date` as `2000-01-01` unless you deliberately want a later starting date.

This one-time job imports all Intervals.icu activities and wellness into Supabase in batches.
It deliberately skips old streams/intervals to keep the job fast and safe. The existing daily workflow continues to fetch detailed data for new/recent runs.
