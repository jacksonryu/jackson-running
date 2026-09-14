from __future__ import annotations

import html as html_lib
import json
import math
import os
import random
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse, urlencode

import requests


PROFILE_URL = os.getenv(
    "UTMB_PROFILE_URL",
    "https://utmb.world/en/runner/5913759.jesun.ryu",
).strip()
RUNNER_SEARCH_URL = "https://utmb.world/utmb-index/runner-search"
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""

# User-specific fallbacks. The public profile parser normally fills these itself,
# but keeping these here makes the integration resilient to small UTMB layout changes.
DEFAULT_NATIONALITY = os.getenv("UTMB_NATIONALITY", "South Korea")
DEFAULT_GENDER = os.getenv("UTMB_GENDER", "Men")
DEFAULT_AGE_GROUP = os.getenv("UTMB_AGE_GROUP", "35-39")

REQUEST_TIMEOUT = 25
MAX_CUTOFF_PAGE = int(os.getenv("UTMB_MAX_CUTOFF_PAGE", "4096"))
RANK_SAMPLE_PAGES = int(os.getenv("UTMB_RANK_SAMPLE_PAGES", "36"))
KST = timezone(timedelta(hours=9))

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0 Safari/537.36 JacksonRunning/1.0"
)



class BrowserRenderer:
    """Small Playwright wrapper used when UTMB serves client-rendered HTML.

    The requests parser stays as the fast path. GitHub Actions installs Chromium for
    this workflow, and the browser is only used when needed for profile/ranking pages.
    """

    def __init__(self) -> None:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:  # pragma: no cover - environment-dependent
            raise RuntimeError(
                "Playwright is required for UTMB's client-rendered pages but is not installed."
            ) from exc
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox"],
        )
        self._context = self._browser.new_context(
            user_agent=USER_AGENT,
            locale="en-US",
        )
        self._page = self._context.new_page()

    def get_html(self, url: str, params: Optional[dict] = None) -> str:
        if params:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}{urlencode(params)}"
        log(f"browser render: {url}")
        self._page.goto(url, wait_until="domcontentloaded", timeout=60_000)
        try:
            self._page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass
        self._page.wait_for_timeout(2_500)
        return self._page.content()

    def close(self) -> None:
        try:
            self._context.close()
        finally:
            try:
                self._browser.close()
            finally:
                self._pw.stop()


def log(msg: str) -> None:
    print(f"[UTMB] {msg}", flush=True)


def require_config() -> None:
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_ROLE_KEY:
        missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if missing:
        raise RuntimeError(f"Missing environment variable(s): {', '.join(missing)}")


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
        }
    )
    return s


def get_text(session: requests.Session, url: str, params: Optional[dict] = None) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(4):
        try:
            r = session.get(url, params=params, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            if r.status_code == 429:
                wait = min(20, 2 ** attempt + random.random())
                log(f"rate limited, waiting {wait:.1f}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.text
        except requests.RequestException as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"GET failed: {url}: {last_error}")


def strip_html(raw: str) -> str:
    """Convert UTMB HTML to searchable text while preserving accessibility labels.

    UTMB renders the category names (Index / 20K / 50K / 100K / 100M) mostly
    as image alt/aria labels.  A normal tag-stripper throws those labels away,
    which is exactly why the previous parser could see the numbers but not know
    which number belonged to which category.
    """
    raw = re.sub(r"<script\b[^>]*>.*?</script>", " ", raw, flags=re.I | re.S)
    raw = re.sub(r"<style\b[^>]*>.*?</style>", " ", raw, flags=re.I | re.S)
    raw = re.sub(r"<noscript\b[^>]*>.*?</noscript>", " ", raw, flags=re.I | re.S)

    def labelled_tag(match: re.Match[str]) -> str:
        tag = match.group(0)
        labels = []
        for attr in ("alt", "aria-label", "title"):
            m = re.search(rf"\b{attr}\s*=\s*([\"'])(.*?)\1", tag, flags=re.I | re.S)
            if m and m.group(2).strip():
                labels.append(html_lib.unescape(m.group(2).strip()))
        return " " + " ".join(labels) + " " if labels else " "

    # Preserve image/button accessibility text before removing all tags.
    raw = re.sub(r"<(?:img|svg|button|a)\b[^>]*>", labelled_tag, raw, flags=re.I | re.S)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = html_lib.unescape(raw)
    return re.sub(r"\s+", " ", raw).strip()


def parse_json_scripts(raw_html: str) -> List[Any]:
    out: List[Any] = []
    for match in re.finditer(r"<script\b[^>]*>(.*?)</script>", raw_html, flags=re.I | re.S):
        body = html_lib.unescape(match.group(1)).strip()
        if not body:
            continue
        # Standard Next/application-json scripts.
        if body.startswith("{") or body.startswith("["):
            try:
                out.append(json.loads(body))
            except Exception:
                pass
        # Next.js occasionally embeds a JSON object in an assignment.
        for candidate in re.findall(r"(?:__NEXT_DATA__\s*=\s*|self\.__next_f\.push\(\[.*?,)(\{.*\})", body, flags=re.S):
            try:
                out.append(json.loads(candidate))
            except Exception:
                pass
    return out


def walk_json(obj: Any) -> Iterable[dict]:
    if isinstance(obj, dict):
        yield obj
        for value in obj.values():
            yield from walk_json(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from walk_json(value)


def numeric(v: Any) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and math.isfinite(float(v)):
        n = int(round(float(v)))
        return n if 0 <= n <= 1500 else None
    if isinstance(v, str):
        m = re.fullmatch(r"\s*(\d{1,4})\s*", v)
        if m:
            n = int(m.group(1))
            return n if 0 <= n <= 1500 else None
    return None


def first_value(d: dict, names: Iterable[str]) -> Any:
    lowered = {str(k).lower().replace("_", "").replace("-", ""): v for k, v in d.items()}
    for name in names:
        key = name.lower().replace("_", "").replace("-", "")
        if key in lowered and lowered[key] not in (None, ""):
            return lowered[key]
    return None


def extract_index_from_dict(d: dict, category: str = "general") -> Optional[int]:
    candidates: Dict[str, List[str]] = {
        "general": ["generalIndex", "overallIndex", "utmbIndex", "performanceIndex", "indexValue"],
        "20k": ["20kIndex", "index20k", "pi20k"],
        "50k": ["50kIndex", "index50k", "pi50k"],
        "100k": ["100kIndex", "index100k", "pi100k"],
        "100m": ["100mIndex", "index100m", "pi100m"],
    }
    val = first_value(d, candidates.get(category, []))
    n = numeric(val)
    if n is not None:
        return n

    # Sometimes indexes are nested by category.
    for key, value in d.items():
        if isinstance(value, dict) and any(word in str(key).lower() for word in ("index", "performance", "pi")):
            nested = {str(k).lower().replace("_", "").replace("-", ""): v for k, v in value.items()}
            category_keys = {
                "general": ["general", "overall", "index"],
                "20k": ["20k"],
                "50k": ["50k"],
                "100k": ["100k"],
                "100m": ["100m"],
            }[category]
            for ck in category_keys:
                if ck in nested:
                    n = numeric(nested[ck])
                    if n is not None:
                        return n
    return None


def metric_after_label(text: str, label: str) -> Optional[int]:
    m = re.search(re.escape(label), text, flags=re.I)
    if not m:
        return None
    chunk = text[m.end() : m.end() + 140]
    unavailable_pos = re.search(r"Unavailable\s+UTMB\s+Index", chunk, flags=re.I)
    num = re.search(r"\b(\d{2,4})\b", chunk)
    if unavailable_pos and (not num or unavailable_pos.start() < num.start()):
        return None
    return int(num.group(1)) if num else None


def parse_profile(raw_html: str) -> dict:
    text = strip_html(raw_html)
    profile: Dict[str, Any] = {
        "name": None,
        "nationality": None,
        "gender": None,
        "age_group": None,
        "overall_index": None,
        "index_20k": None,
        "index_50k": None,
        "index_100k": None,
        "index_100m": None,
        "best_score": None,
        "finished_races": None,
        "top10": None,
    }

    # Prefer structured JSON when UTMB exposes it in the Next page payload.
    for payload in parse_json_scripts(raw_html):
        for d in walk_json(payload):
            name = first_value(d, ["fullname", "fullName", "name", "displayName"])
            uri = first_value(d, ["uri", "runnerUri", "slug"])
            runner_id = first_value(d, ["runnerId", "id", "runner_id"])
            marker = f"{name or ''} {uri or ''} {runner_id or ''}".lower()
            if "jesun" not in marker and "5913759" not in marker:
                continue
            profile["name"] = profile["name"] or name
            profile["nationality"] = profile["nationality"] or first_value(d, ["nationality", "countryName", "country"])
            profile["gender"] = profile["gender"] or first_value(d, ["gender", "sex"])
            profile["age_group"] = profile["age_group"] or first_value(d, ["ageGroup", "ageCategory", "categoryAge"])
            for cat, field in [
                ("general", "overall_index"),
                ("20k", "index_20k"),
                ("50k", "index_50k"),
                ("100k", "index_100k"),
                ("100m", "index_100m"),
            ]:
                profile[field] = profile[field] if profile[field] is not None else extract_index_from_dict(d, cat)

    h1 = re.search(r"<h1\b[^>]*>(.*?)</h1>", raw_html, flags=re.I | re.S)
    if h1 and not profile["name"]:
        profile["name"] = strip_html(h1.group(1))

    profile["overall_index"] = profile["overall_index"] or metric_after_label(text, "UTMB Index Race")
    if profile["overall_index"] is None:
        profile["overall_index"] = metric_after_label(text, "UTMB Index")

    # UTMB's profile header currently has the stable sequence:
    # South Korea -> 35-39 Men -> ... -> <overall> -> Details -> 20K -> <value> ...
    # This fallback does not depend on class names or JS bundle internals.
    if profile["overall_index"] is None:
        header = re.search(
            r"South\s+Korea.{0,600}?\b(?:U20|20-34|35-39|40-44|45-49|50-54|55-59|60-64|65-69|70-74|75-79|80-84|85\+)\s+(?:Men|Women)\b(?P<tail>.{0,900}?)\bDetails\b",
            text,
            flags=re.I | re.S,
        )
        if header:
            nums = [int(x) for x in re.findall(r"\b(\d{3})\b", header.group("tail"))]
            nums = [x for x in nums if 100 <= x <= 999]
            if nums:
                profile["overall_index"] = nums[-1]

    profile["index_20k"] = profile["index_20k"] or metric_after_label(text, "20K")
    profile["index_50k"] = profile["index_50k"] or metric_after_label(text, "50K")
    profile["index_100k"] = profile["index_100k"] or metric_after_label(text, "100K")
    profile["index_100m"] = profile["index_100m"] or metric_after_label(text, "100M")

    best = re.search(r"Best\s+UTMB\s+Score\s+(\d{2,4})", text, flags=re.I)
    finished = re.search(r"Finished\s+race\(s\)\s+(\d+)", text, flags=re.I)
    top10 = re.search(r"Top\s*10\s+(\d+)", text, flags=re.I)
    if best:
        profile["best_score"] = int(best.group(1))
    if finished:
        profile["finished_races"] = int(finished.group(1))
    if top10:
        profile["top10"] = int(top10.group(1))

    if not profile["nationality"] and re.search(r"South\s+Korea", text, flags=re.I):
        profile["nationality"] = "South Korea"
    if not profile["gender"]:
        g = re.search(r"\b(Men|Women)\b", text)
        if g:
            profile["gender"] = g.group(1)
    if not profile["age_group"]:
        ag = re.search(r"\b(U20|20-34|35-39|40-44|45-49|50-54|55-59|60-64|65-69|70-74|75-79|80-84|85\+)\b", text)
        if ag:
            profile["age_group"] = ag.group(1)

    profile["nationality"] = profile["nationality"] or DEFAULT_NATIONALITY
    profile["gender"] = profile["gender"] or DEFAULT_GENDER
    profile["age_group"] = profile["age_group"] or DEFAULT_AGE_GROUP

    if profile["overall_index"] is None:
        has_name = bool(re.search(r"Jesun\s+RYU", text, flags=re.I))
        has_country = bool(re.search(r"South\s+Korea", text, flags=re.I))
        has_details = bool(re.search(r"\bDetails\b", text, flags=re.I))
        raise RuntimeError(
            "Could not parse the current UTMB Index from the public profile page "
            f"(name={has_name}, country={has_country}, details={has_details}, text_len={len(text)})."
        )
    return profile


def normalize_country(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    low = s.lower().replace("_", "-")
    if low in {"kr", "kor", "korea", "south korea", "republic of korea", "korea, republic of"}:
        return "KR"
    if "south korea" in low or "republic of korea" in low:
        return "KR"
    # Common values from public profile JSON.
    if re.fullmatch(r"[A-Za-z]{2,3}", s):
        return s.upper()
    return s


def normalize_gender(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in {"m", "male", "men", "man"}:
        return "Men"
    if s in {"f", "female", "women", "woman"}:
        return "Women"
    return str(value).strip()


def runner_identity(d: dict) -> Tuple[Optional[str], Optional[str]]:
    name = first_value(d, ["fullname", "fullName", "displayName", "name"])
    uri = first_value(d, ["uri", "runnerUri", "slug", "profileUrl", "url"])
    rid = first_value(d, ["runnerId", "athleteId", "id"])
    ident = str(uri or rid or name or "").strip() or None
    return (str(name).strip() if name else None, ident)


def collect_runner_dicts(raw_html: str) -> List[dict]:
    rows: List[dict] = []
    seen: set[Tuple[str, int]] = set()
    for payload in parse_json_scripts(raw_html):
        for d in walk_json(payload):
            name, ident = runner_identity(d)
            if not name or not ident:
                continue
            score = extract_index_from_dict(d, "general")
            if score is None or score < 50 or score > 1100:
                continue
            nationality = first_value(d, ["nationalityCode", "countryCode", "nationality", "country"])
            gender = first_value(d, ["gender", "sex"])
            age_group = first_value(d, ["ageGroup", "ageCategory", "categoryAge"])
            # A ranking runner record normally has at least one demographic field.
            if nationality is None and gender is None and age_group is None:
                continue
            key = (ident, score)
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "name": name,
                    "id": ident,
                    "score": score,
                    "country": normalize_country(nationality),
                    "gender": normalize_gender(gender),
                    "age_group": str(age_group).strip() if age_group else None,
                }
            )
    return rows


def fallback_runner_rows(raw_html: str) -> List[dict]:
    # The public ranking page contains runner profile links even if Next's JSON shape changes.
    matches = list(
        re.finditer(
            r'href=["\'](?P<href>[^"\']*(?:/en)?/runner/(?P<slug>[^"\'#?]+))[^"\']*["\'][^>]*>(?P<body>.*?)</a>',
            raw_html,
            flags=re.I | re.S,
        )
    )
    rows: List[dict] = []
    seen: set[str] = set()
    for i, m in enumerate(matches):
        slug = m.group("slug")
        if slug in seen:
            continue
        seen.add(slug)
        name = strip_html(m.group("body"))
        start = max(0, m.start() - 1800)
        end = matches[i + 1].start() if i + 1 < len(matches) else min(len(raw_html), m.end() + 2200)
        segment = raw_html[start:end]
        before = strip_html(raw_html[start:m.start()])
        nums = [int(x) for x in re.findall(r"\b(\d{3})\b", before)]
        nums = [x for x in nums if 50 <= x <= 1100]
        score = nums[-1] if nums else None
        if score is None:
            continue
        seg_text = strip_html(segment)
        country: Optional[str] = None
        if re.search(r"South\s+Korea|Korea,\s*Republic\s+of|Republic\s+of\s+Korea", segment, flags=re.I):
            country = "KR"
        elif re.search(r"(?:country|nationality|flag)[^>\n]{0,180}(?:KR|KOR)", segment, flags=re.I):
            country = "KR"
        elif re.search(r"(?:/|[-_])(?:kr|kor)(?:[./_\-\"'])", segment, flags=re.I):
            country = "KR"
        else:
            # Generic country code/alt if available. This mainly helps estimate how many rows
            # have recognizable nationality metadata.
            cm = re.search(r'(?:nationality|country)[^>]{0,120}(?:code)?[=:"\'\s]+([A-Z]{2,3})\b', segment)
            if cm:
                country = cm.group(1)

        gender = "Men" if re.search(r"\bMen\b", seg_text) else "Women" if re.search(r"\bWomen\b", seg_text) else None
        ag = re.search(r"\b(U20|20-34|35-39|40-44|45-49|50-54|55-59|60-64|65-69|70-74|75-79|80-84|85\+)\b", seg_text)
        rows.append(
            {
                "name": name,
                "id": slug,
                "score": score,
                "country": country,
                "gender": gender,
                "age_group": ag.group(1) if ag else None,
            }
        )
    return rows


def extract_rank_rows(raw_html: str) -> List[dict]:
    rows = collect_runner_dicts(raw_html)
    if len(rows) >= 5:
        # Remove duplicates that may come from the page's separate "top 3" widget.
        unique: Dict[str, dict] = {}
        for r in rows:
            unique[str(r["id"])] = r
        rows = list(unique.values())
        rows.sort(key=lambda r: r["score"], reverse=True)
        return rows
    rows = fallback_runner_rows(raw_html)
    unique: Dict[str, dict] = {}
    for r in rows:
        unique[str(r["id"])] = r
    rows = list(unique.values())
    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows


def wilson_interval(success: int, total: int, z: float = 1.96) -> Tuple[float, float]:
    if total <= 0:
        return (0.0, 0.0)
    p = success / total
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    margin = z * math.sqrt((p * (1 - p) / total) + z * z / (4 * total * total)) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


def even_sample_pages(last_page: int, count: int) -> List[int]:
    if last_page <= 1:
        return [1]
    count = max(2, min(count, last_page))
    pages = {1, last_page}
    for i in range(count):
        x = 1 + round((last_page - 1) * i / max(1, count - 1))
        pages.add(int(x))
    return sorted(pages)


def estimate_korea_rank(session: requests.Session, target_score: int, age_group: str, renderer: Optional[BrowserRenderer] = None) -> dict:
    """Estimate Korea men's rank from the public UTMB ranking table.

    UTMB does not document a public country-ranking API. Instead of hammering every ranking
    page, this function finds the score cutoff page and takes an evenly spaced sample of the
    public ranking. The UI explicitly labels the result as an estimate and stores a 95% range.
    """

    cache: Dict[int, List[dict]] = {}
    force_browser = False

    def page_rows(page: int) -> List[dict]:
        nonlocal force_browser
        if page in cache:
            return cache[page]
        if force_browser and renderer is not None:
            raw = renderer.get_html(RUNNER_SEARCH_URL, params={"page": page})
            rows = extract_rank_rows(raw)
        else:
            raw = get_text(session, RUNNER_SEARCH_URL, params={"page": page})
            rows = extract_rank_rows(raw)
            # UTMB currently renders runner-search client-side. If the server HTML has too
            # few rows, fall back to a real Chromium render.
            if renderer is not None and len(rows) < 5:
                raw = renderer.get_html(RUNNER_SEARCH_URL, params={"page": page})
                rows = extract_rank_rows(raw)
        cache[page] = rows
        time.sleep(0.08 + random.random() * 0.06)
        return rows

    first = page_rows(1)
    second = page_rows(2)
    if len(first) < 5 or len(second) < 5:
        return {"status": "unavailable", "reason": "ranking_rows_not_detected"}

    sig1 = tuple((r["id"], r["score"]) for r in first[:5])
    sig2 = tuple((r["id"], r["score"]) for r in second[:5])
    if sig1 == sig2 and renderer is not None:
        # The raw HTML often ignores ?page= while the browser app respects it.
        force_browser = True
        cache.clear()
        raw1 = renderer.get_html(RUNNER_SEARCH_URL, params={"page": 1})
        raw2 = renderer.get_html(RUNNER_SEARCH_URL, params={"page": 2})
        first = extract_rank_rows(raw1)
        second = extract_rank_rows(raw2)
        cache[1] = first
        cache[2] = second
        sig1 = tuple((r["id"], r["score"]) for r in first[:5])
        sig2 = tuple((r["id"], r["score"]) for r in second[:5])
    if sig1 == sig2:
        return {"status": "unavailable", "reason": "pagination_not_observable_even_in_browser"}

    page_size = int(round((len(first) + len(second)) / 2))

    def page_min_score(page: int) -> Optional[int]:
        rows = page_rows(page)
        scores = [r["score"] for r in rows if isinstance(r.get("score"), int)]
        return min(scores) if scores else None

    # Exponential search to find a page that reaches the user's score.
    low_page = 1
    high_page = 2
    while high_page <= MAX_CUTOFF_PAGE:
        mn = page_min_score(high_page)
        if mn is None:
            return {"status": "unavailable", "reason": f"score_parse_failed_page_{high_page}"}
        if mn <= target_score:
            break
        low_page = high_page
        high_page *= 2
    else:
        return {"status": "unavailable", "reason": "cutoff_not_found_within_cap"}

    high_page = min(high_page, MAX_CUTOFF_PAGE)
    # Binary search the first page whose minimum score is <= target.
    lo, hi = low_page, high_page
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        mn = page_min_score(mid)
        if mn is None:
            return {"status": "unavailable", "reason": f"score_parse_failed_page_{mid}"}
        if mn <= target_score:
            hi = mid
        else:
            lo = mid
    cutoff_page = hi
    cutoff_rows = page_rows(cutoff_page)
    greater_on_cutoff = sum(1 for r in cutoff_rows if r.get("score", 0) > target_score)
    total_above = max(0, (cutoff_page - 1) * page_size + greater_on_cutoff)

    pages = even_sample_pages(cutoff_page, RANK_SAMPLE_PAGES)
    sampled_rows: List[dict] = []
    for page in pages:
        rows = page_rows(page)
        for row in rows:
            if page < cutoff_page or row.get("score", 0) > target_score:
                sampled_rows.append(row)

    if not sampled_rows:
        return {"status": "unavailable", "reason": "empty_rank_sample"}

    country_known = sum(1 for r in sampled_rows if r.get("country"))
    known_ratio = country_known / len(sampled_rows)
    if known_ratio < 0.70:
        return {
            "status": "unavailable",
            "reason": "nationality_metadata_not_reliable",
            "sample_rows": len(sampled_rows),
            "country_known_ratio": round(known_ratio, 3),
            "cutoff_page": cutoff_page,
        }

    # Unknown countries are excluded from the denominator so missing flag metadata does not
    # dilute Korea's proportion. This is still an estimate, which is why we keep a range.
    known = [r for r in sampled_rows if r.get("country")]
    korea_men = [r for r in known if r.get("country") == "KR" and normalize_gender(r.get("gender")) == "Men"]
    korea_age = [r for r in korea_men if str(r.get("age_group") or "") == age_group]

    def make_rank(success: int) -> Tuple[int, int, int]:
        p = success / len(known)
        low_p, high_p = wilson_interval(success, len(known))
        est = 1 + int(round(p * total_above))
        low = 1 + int(math.floor(low_p * total_above))
        high = 1 + int(math.ceil(high_p * total_above))
        return (max(1, est), max(1, low), max(1, high))

    men_est, men_low, men_high = make_rank(len(korea_men))
    age_est, age_low, age_high = make_rank(len(korea_age))

    return {
        "status": "estimated_from_public_ranking_sample",
        "korea_men_rank_est": men_est,
        "korea_men_rank_low": men_low,
        "korea_men_rank_high": men_high,
        "korea_age_rank_est": age_est,
        "korea_age_rank_low": age_low,
        "korea_age_rank_high": age_high,
        "global_runners_above_score_est": total_above,
        "cutoff_page": cutoff_page,
        "page_size": page_size,
        "sample_pages": len(pages),
        "sample_rows": len(sampled_rows),
        "country_known_ratio": round(known_ratio, 3),
        "korea_men_hits": len(korea_men),
        "korea_age_hits": len(korea_age),
    }


def runner_id_from_url(url: str) -> str:
    path = urlparse(url).path
    m = re.search(r"/runner/([^/?#]+)", path)
    if not m:
        raise RuntimeError(f"Could not derive runner id from profile URL: {url}")
    return m.group(1).split(".", 1)[0]


def supabase_headers(extra: Optional[dict] = None) -> dict:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def upsert_snapshot(row: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/utmb_snapshots"
    headers = supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"})
    resp = requests.post(
        url,
        params={"on_conflict": "snapshot_date,runner_id"},
        headers=headers,
        json=row,
        timeout=REQUEST_TIMEOUT,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Supabase upsert failed HTTP {resp.status_code}: {resp.text[:500]}")


def main() -> None:
    require_config()
    session = make_session()
    renderer: Optional[BrowserRenderer] = None

    log(f"fetching public profile: {PROFILE_URL}")
    profile_html = get_text(session, PROFILE_URL)
    try:
        profile = parse_profile(profile_html)
    except RuntimeError:
        log("static HTML did not contain the index; retrying with a rendered Chromium page")
        renderer = BrowserRenderer()
        profile_html = renderer.get_html(PROFILE_URL)
        profile = parse_profile(profile_html)

    log(
        "profile parsed: "
        f"overall={profile['overall_index']} 20K={profile['index_20k']} "
        f"50K={profile['index_50k']} 100K={profile['index_100k']} 100M={profile['index_100m']}"
    )

    try:
        if renderer is None:
            renderer = BrowserRenderer()
        rank = estimate_korea_rank(
            session,
            int(profile["overall_index"]),
            str(profile.get("age_group") or DEFAULT_AGE_GROUP),
            renderer=renderer,
        )
    except Exception as exc:  # rank should never block the index snapshot itself
        rank = {"status": "unavailable", "reason": f"rank_estimation_error: {type(exc).__name__}: {exc}"}

    if rank.get("status") == "estimated_from_public_ranking_sample":
        log(
            "Korea rank estimate: "
            f"Men #{rank['korea_men_rank_est']} "
            f"({rank['korea_men_rank_low']}-{rank['korea_men_rank_high']}), "
            f"{profile.get('age_group')} #{rank['korea_age_rank_est']}"
        )
    else:
        log(f"Korea rank unavailable: {rank.get('reason')}")

    now_utc = datetime.now(timezone.utc)
    today_kst = now_utc.astimezone(KST).date().isoformat()
    runner_id = runner_id_from_url(PROFILE_URL)

    row = {
        "snapshot_date": today_kst,
        "captured_at": now_utc.isoformat(),
        "runner_id": runner_id,
        "profile_url": PROFILE_URL,
        "runner_name": profile.get("name") or "Jesun RYU",
        "nationality": profile.get("nationality"),
        "gender": profile.get("gender"),
        "age_group": profile.get("age_group"),
        "overall_index": profile.get("overall_index"),
        "index_20k": profile.get("index_20k"),
        "index_50k": profile.get("index_50k"),
        "index_100k": profile.get("index_100k"),
        "index_100m": profile.get("index_100m"),
        "best_score": profile.get("best_score"),
        "finished_races": profile.get("finished_races"),
        "top10": profile.get("top10"),
        "korea_men_rank_est": rank.get("korea_men_rank_est"),
        "korea_men_rank_low": rank.get("korea_men_rank_low"),
        "korea_men_rank_high": rank.get("korea_men_rank_high"),
        "korea_age_rank_est": rank.get("korea_age_rank_est"),
        "korea_age_rank_low": rank.get("korea_age_rank_low"),
        "korea_age_rank_high": rank.get("korea_age_rank_high"),
        "rank_status": rank.get("status"),
        "rank_sample_size": rank.get("sample_rows"),
        "source": "utmb_public_profile_and_public_runner_search",
        "raw_json": {"profile": profile, "rank": rank},
    }

    upsert_snapshot(row)
    log(f"Supabase snapshot saved for {today_kst}")
    if renderer is not None:
        renderer.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[UTMB][ERROR] {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
