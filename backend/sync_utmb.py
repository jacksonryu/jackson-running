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


def _visible_locator(locator):
    """Return the first visible locator item, or None."""
    try:
        count = locator.count()
    except Exception:
        return None
    for i in range(min(count, 30)):
        item = locator.nth(i)
        try:
            if item.is_visible():
                return item
        except Exception:
            continue
    return None


def _choose_custom_filter(page, label: str, value: str) -> None:
    """Set one UTMB Runner Search filter by finding the dropdown that actually contains `value`.

    UTMB's current runner-search DOM does not expose the Nationality trigger with a stable
    accessible label in headless Chromium.  So label-only lookup is unreliable.  This routine
    first uses normal labelled/native controls, then *discovers* the correct control by opening
    visible filter controls and checking which popup contains the exact requested option.
    """
    value_re = re.compile(rf"^\s*{re.escape(value)}\s*$", re.I)
    label_re = re.compile(rf"^\s*{re.escape(label)}\s*$", re.I)

    def _is_visible(loc) -> bool:
        try:
            return loc.is_visible()
        except Exception:
            return False

    def _selected_text(control) -> str:
        parts: List[str] = []
        try:
            tag = control.evaluate("el => el.tagName.toLowerCase()")
            if tag == "select":
                parts.extend(control.locator("option:checked").all_inner_texts())
        except Exception:
            pass
        for getter in (
            lambda: control.input_value(),
            lambda: control.get_attribute("value") or "",
            lambda: control.get_attribute("aria-label") or "",
            lambda: control.get_attribute("placeholder") or "",
            lambda: control.inner_text() or "",
        ):
            try:
                parts.append(str(getter()))
            except Exception:
                pass
        return " ".join(x.strip() for x in parts if x and x.strip())

    def selected(control) -> bool:
        return value.lower() in _selected_text(control).lower()

    def exact_visible_option():
        # Prefer semantic popup roles.
        for loc in (
            page.get_by_role("option", name=value_re),
            page.get_by_role("menuitem", name=value_re),
            page.locator("[role='listbox']").get_by_text(value_re),
            page.locator("[role='menu']").get_by_text(value_re),
        ):
            hit = _visible_locator(loc)
            if hit is not None:
                return hit

        # Headless UI / Radix / custom popups without useful roles.
        popup_candidates = page.locator(
            "[data-radix-popper-content-wrapper], [role='dialog'], "
            "[class*='menu' i], [class*='dropdown' i], [class*='popover' i], "
            "[class*='option' i], [class*='select' i]"
        )
        for k in range(min(popup_candidates.count(), 120)):
            pop = popup_candidates.nth(k)
            if not _is_visible(pop):
                continue
            try:
                hit = _visible_locator(pop.get_by_text(value_re))
                if hit is not None:
                    return hit
            except Exception:
                continue
        return None

    def choose_from_open_control(control, source: str) -> bool:
        """Open one candidate and choose the exact option if this is the right dropdown."""
        try:
            if selected(control):
                log(f"filter already selected: {label}={value} ({source})")
                return True

            tag = ""
            try:
                tag = control.evaluate("el => el.tagName.toLowerCase()")
            except Exception:
                pass

            # Native <select>.
            if tag == "select":
                options = [x.strip() for x in control.locator("option").all_inner_texts()]
                if any(x.lower() == value.lower() for x in options):
                    control.select_option(label=value)
                    page.wait_for_timeout(500)
                    log(f"filter set: {label}={value} ({source}/native)")
                    return True
                return False

            # Open custom dropdown/autocomplete.
            control.click()
            page.wait_for_timeout(300)

            option = exact_visible_option()
            if option is None:
                # Nationality is sometimes a searchable combobox: after opening it, type in
                # the visible popup search field (or the control itself if it is an input).
                search_inputs = page.locator(
                    "[role='listbox'] input, [role='dialog'] input, "
                    "[class*='dropdown' i] input, [class*='popover' i] input"
                )
                typed = False
                for si in range(min(search_inputs.count(), 20)):
                    inp = search_inputs.nth(si)
                    if not _is_visible(inp):
                        continue
                    try:
                        inp.fill(value)
                        page.wait_for_timeout(500)
                        typed = True
                        break
                    except Exception:
                        continue
                if not typed and tag == "input":
                    try:
                        control.fill(value)
                        page.wait_for_timeout(500)
                    except Exception:
                        pass
                option = exact_visible_option()

            if option is None:
                try:
                    page.keyboard.press("Escape")
                except Exception:
                    pass
                return False

            option.click()
            page.wait_for_timeout(700)
            log(f"filter set: {label}={value} ({source}/option-discovery)")
            return True
        except Exception:
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
            return False

    # 1) Native selects anywhere in main content.
    native = page.locator("main select, select")
    for i in range(min(native.count(), 40)):
        c = native.nth(i)
        if _is_visible(c) and choose_from_open_control(c, "select"):
            return

    # 2) Normal label-associated controls (works for Gender/Age Group on many UTMB builds).
    controls = []
    try:
        labelled = page.get_by_label(label_re)
        for i in range(min(labelled.count(), 12)):
            c = labelled.nth(i)
            if _is_visible(c):
                controls.append(c)
    except Exception:
        pass

    try:
        labels = page.get_by_text(label_re)
        for i in range(min(labels.count(), 12)):
            lab = labels.nth(i)
            if not _is_visible(lab):
                continue
            for levels in range(1, 7):
                ancestor = lab.locator("xpath=" + "/.." * levels)
                loc = ancestor.locator("select, [role='combobox'], button, input")
                for j in range(min(loc.count(), 20)):
                    c = loc.nth(j)
                    if _is_visible(c):
                        controls.append(c)
                if controls:
                    break
    except Exception:
        pass

    seen: set[str] = set()
    for c in controls:
        try:
            key = c.evaluate("el => el.outerHTML.slice(0,500)")
        except Exception:
            key = str(id(c))
        if key in seen:
            continue
        seen.add(key)
        if choose_from_open_control(c, "labelled"):
            return

    # 3) UTMB-specific robust fallback: discover the dropdown by the option it contains.
    # Scope to <main> first so header/nav buttons are not touched.
    candidates = page.locator(
        "main [role='combobox'], main input[role='combobox'], main button, main input, "
        "[role='combobox']"
    )
    diagnostics: List[str] = []
    for i in range(min(candidates.count(), 100)):
        c = candidates.nth(i)
        if not _is_visible(c):
            continue
        try:
            txt = _selected_text(c)
            # Avoid obvious unrelated controls / pagination / nav.
            if re.search(r"^(search|filters|general|20k|50k|100k|100m|men|women)?$", txt.strip(), re.I):
                # Men may itself be a valid current value for the Gender control; only skip it
                # when we are not looking for Men.
                if not (value.lower() == "men" and txt.strip().lower() == "men"):
                    continue
            diagnostics.append(txt[:80] or "<blank>")
        except Exception:
            pass
        if choose_from_open_control(c, "discovered"):
            return

    diag = " | ".join(diagnostics[:20])
    raise RuntimeError(
        f"Could not set/verify UTMB filter {label}={value}; visible controls={diag or 'none'}"
    )


def _runner_row_from_anchor(anchor, age_group: Optional[str]) -> Optional[dict]:
    """Parse one visible main-ranking runner row from the rendered DOM.

    The exact UTMB CSS classes are intentionally ignored. We walk upward from the runner
    profile link until we find the compact row containing nationality/gender/age text.
    This also excludes the separate global Top-3 widget, which does not carry the normal
    South Korea demographic row fields.
    """
    try:
        if not anchor.is_visible():
            return None
        href = anchor.get_attribute("href") or ""
        if "/runner/" not in href:
            return None
        name = (anchor.inner_text() or "").strip()
        if not name:
            return None
    except Exception:
        return None

    for levels in range(1, 9):
        try:
            node = anchor.locator("xpath=" + "/.." * levels)
            text = re.sub(r"\s+", " ", node.inner_text()).strip()
        except Exception:
            continue
        if len(text) > 650:
            break
        # IMPORTANT: after UTMB applies Nationality=South Korea, the nationality is
        # often rendered only as a flag/icon, so the row's visible text does NOT contain
        # the literal words "South Korea".  Requiring country text therefore discards every
        # valid filtered row.  Gender + age-group are visible in the main ranking rows and
        # are enough here because the browser filter itself already constrains nationality.
        has_men = bool(re.search(r"\bMen\b", text, re.I))
        age_m = re.search(r"\b(U20|20-34|35-39|40-44|45-49|50-54|55-59|60-64|65-69|70-74|75-79|80-84|85\+)\b", text)
        if not (has_men and age_m):
            continue
        age = age_m.group(1)
        if age_group and age != age_group:
            return None
        return {
            "name": name,
            "id": href,
            "age_group": age,
            "row_text": text,
        }
    return None


def _visible_filtered_runner_rows(page, age_group: Optional[str]) -> List[dict]:
    rows: List[dict] = []
    seen: set[str] = set()
    anchors = page.locator("a[href*='/runner/']")
    for i in range(min(anchors.count(), 120)):
        row = _runner_row_from_anchor(anchors.nth(i), age_group)
        if not row:
            continue
        rid = str(row["id"])
        if rid in seen:
            continue
        seen.add(rid)
        rows.append(row)
    return rows


def _click_next_rank_page(page, next_page_number: int, previous_ids: Tuple[str, ...]) -> bool:
    """Advance UTMB ranking pagination and confirm that visible filtered rows changed."""
    candidates = [
        page.get_by_text(re.compile(rf"^\s*{next_page_number}\s*$")),
        page.locator("button[aria-label*='next' i]"),
        page.locator("a[aria-label*='next' i]"),
        page.locator("button[title*='next' i]"),
        page.locator("a[title*='next' i]"),
    ]
    for loc in candidates:
        for i in range(min(loc.count(), 15)):
            item = loc.nth(i)
            try:
                if not item.is_visible():
                    continue
                if hasattr(item, "is_disabled") and item.is_disabled():
                    continue
                item.click()
                try:
                    page.wait_for_load_state("networkidle", timeout=8_000)
                except Exception:
                    pass
                page.wait_for_timeout(800)
                now = tuple(str(r["id"]) for r in _visible_filtered_runner_rows(page, None)[:8])
                if now and now != previous_ids:
                    return True
            except Exception:
                continue
    return False


def _exact_filtered_rank(renderer: BrowserRenderer, target_score: int, age_group: Optional[str]) -> dict:
    """Get exact position from UTMB's own South Korea / Men filtered table.

    We do not infer the rank from scores. We simply count the visible filtered rows while
    paging until runner 5913759 appears. This avoids the old parser bug where category labels
    such as 100K were mistaken for index scores.
    """
    page = renderer._page
    log("opening filtered ranking: South Korea / Men" + (f" / {age_group}" if age_group else ""))
    page.goto(RUNNER_SEARCH_URL, wait_until="domcontentloaded", timeout=60_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:
        pass
    page.wait_for_timeout(1_500)

    try:
        filters_btn = _visible_locator(page.get_by_role("button", name=re.compile(r"^\s*Filters\s*$", re.I)))
        if filters_btn is None:
            filters_btn = _visible_locator(page.get_by_text(re.compile(r"^\s*Filters\s*$", re.I)))
        if filters_btn is not None:
            filters_btn.click()
            page.wait_for_timeout(700)
    except Exception:
        pass

    _choose_custom_filter(page, "Nationality", "South Korea")
    _choose_custom_filter(page, "Gender", "Men")
    if age_group:
        _choose_custom_filter(page, "Age Group", age_group)

    try:
        search = _visible_locator(page.get_by_role("button", name=re.compile(r"^search$", re.I)))
        if search is None:
            search = _visible_locator(page.get_by_text(re.compile(r"^\s*search\s*$", re.I)))
        if search is not None:
            search.click()
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:
        pass
    page.wait_for_timeout(1_200)

    target_runner = runner_id_from_url(PROFILE_URL)
    page_num = 1
    scanned = 0
    page_size: Optional[int] = None
    max_pages = 100

    while page_num <= max_pages:
        rows = _visible_filtered_runner_rows(page, age_group)
        if not rows:
            # Capture a compact sample of visible runner-link ancestors for diagnostics.
            samples: List[str] = []
            anchors = page.locator("a[href*='/runner/']")
            for si in range(min(anchors.count(), 12)):
                try:
                    a = anchors.nth(si)
                    if not a.is_visible():
                        continue
                    name = re.sub(r"\s+", " ", a.inner_text()).strip()
                    parent_text = re.sub(r"\s+", " ", a.locator("xpath=../..").inner_text()).strip()
                    if name:
                        samples.append(f"{name}: {parent_text[:120]}")
                except Exception:
                    continue
            raise RuntimeError(
                "No visible filtered ranking rows after applying South Korea/Men filters "
                f"(age_group={age_group or 'ALL'}, page={page_num}); "
                f"runner_link_samples={' || '.join(samples[:5]) or 'none'}"
            )
        if page_size is None:
            page_size = len(rows)

        first_names = ", ".join(r["name"] for r in rows[:3])
        log(f"filtered rank page {page_num}: rows={len(rows)} first={first_names}")

        for idx, row in enumerate(rows):
            rid = str(row.get("id") or "")
            name = str(row.get("name") or "")
            if target_runner in rid or re.search(r"\bJesun\s+RYU\b", name, re.I):
                exact_rank = scanned + idx + 1
                return {
                    "status": "exact_from_utmb_filtered_ranking",
                    "rank": exact_rank,
                    "page": page_num,
                    "page_size": page_size,
                    "matched_name": name,
                    "age_group_filter": age_group,
                }

        previous_ids = tuple(str(r["id"]) for r in rows[:8])
        scanned += len(rows)
        if not _click_next_rank_page(page, page_num + 1, previous_ids):
            raise RuntimeError(
                f"Runner {target_runner} was not found and UTMB pagination could not advance "
                f"after filtered page {page_num}."
            )
        page_num += 1

    raise RuntimeError(f"Runner not found in first {max_pages} filtered ranking pages")

def estimate_korea_rank(session: requests.Session, target_score: int, age_group: str, renderer: Optional[BrowserRenderer] = None) -> dict:
    """Get exact Korea male and M35-39 ranks using UTMB's own visible filters.

    This intentionally mirrors the manual workflow that works on utmb.world:
    Nationality=South Korea, Gender=Men, then (for the age rank) Age Group=35-39.
    No statistical sampling is used.
    """
    if renderer is None:
        return {"status": "unavailable", "reason": "browser_renderer_required_for_filtered_rank"}

    try:
        men = _exact_filtered_rank(renderer, target_score, None)
        age = _exact_filtered_rank(renderer, target_score, age_group)
        return {
            "status": "exact_from_utmb_filtered_ranking",
            "korea_men_rank_est": men["rank"],
            "korea_men_rank_low": men["rank"],
            "korea_men_rank_high": men["rank"],
            "korea_age_rank_est": age["rank"],
            "korea_age_rank_low": age["rank"],
            "korea_age_rank_high": age["rank"],
            "sample_rows": None,
            "men_detail": men,
            "age_detail": age,
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "reason": f"filtered_rank_error: {type(exc).__name__}: {exc}",
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

    if rank.get("status") in {"estimated_from_public_ranking_sample", "exact_from_utmb_filtered_ranking"}:
        log(
            "Korea rank: "
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
