"""Workday — public CXS jobs endpoint (POST, paginated).

The most intricate provider, and every constant below is scar tissue from a live
failure in career-ops. Port faithfully; "simplifying" any of it reintroduces a
silent-truncation bug.

Workday exposes only a *relative* posting label ("Posted Today", "Posted 5 Days Ago",
"Posted 30+ Days Ago"). `_parse_posted_on` derives a date from the bounded forms and
deliberately returns None for "30+", which is unbounded — treating it as exactly 30
days would fabricate freshness the API never claimed.
"""
from __future__ import annotations

import json
import random
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import unquote

from scanner.http import BROWSER_LIKE_USER_AGENT
from scanner.types import PortalEntry, Posting, PostingList, ScanContext

PAGE_SIZE = 20

# Safety cap on pagination, applied regardless of the upstream `total`, so a
# misbehaving API cannot drive this into unbounded fetching.
DEFAULT_MAX_PAGES = 100
# Hard ceiling even for an explicit per-entry override. 1500 pages (30,000 postings)
# covers known large tenants with headroom.
MAX_PAGES_CAP = 1500

# Workday's CXS API sits behind a WAF that rate-limits in bursts. Without retry a
# single 429 silently truncates an entire tenant.
MAX_RETRIES = 3
RETRY_BASE_DELAY_S = 0.5
RETRY_MAX_DELAY_S = 8.0

# Delay between successive pages within one tenant's pagination loop (not between
# tenants — that's the runner's concurrency, a separate knob).
INTER_PAGE_DELAY_S = 0.15

# Workday returns newest-first, so pagination can stop once a page's oldest *dated*
# posting is well past the freshness window. Some tenants return day-labels ~1 day out
# of order, so the margin is 2 days — double the observed jitter.
EARLY_STOP_MARGIN_MS = 2 * 86_400_000

_TENANT_RE = re.compile(
    r"^https://([\w-]+)\.(wd[\w-]*)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?([^/?#]+)"
)
_JOB_PATH_RE = re.compile(r"/job/([^/]+)/")
_DAYS_RE = re.compile(r"posted\s+(\d+)(\+?)\s*day", re.I)


def _now_ms() -> int:
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def _resolve_endpoint(entry: PortalEntry) -> Optional[dict[str, str]]:
    """Try `api` then `careers_url`, returning the first that matches the tenant
    pattern. Falling through on a non-match means a non-Workday `api` value cannot
    shadow a valid `careers_url`."""
    for url in (entry.api, entry.careers_url):
        if not isinstance(url, str) or not url:
            continue
        match = _TENANT_RE.match(url)
        if not match:
            continue
        tenant, instance, site = match.groups()
        origin = f"https://{tenant}.{instance}.myworkdayjobs.com"
        return {
            "api": f"{origin}/wday/cxs/{tenant}/{site}/jobs",
            # externalPath is relative to the site, not the host root — without the
            # site segment the resulting URL 404s.
            "job_base": f"{origin}/{site}",
            "origin": origin,
        }
    return None


def _parse_posted_on(label: object) -> Optional[int]:
    if not isinstance(label, str) or not label:
        return None
    if re.search(r"posted\s+today", label, re.I):
        return _now_ms()
    if re.search(r"posted\s+yesterday", label, re.I):
        return _now_ms() - 86_400_000
    match = _DAYS_RE.search(label)
    if not match or match.group(2) == "+":
        return None  # "30+ Days Ago" — unbounded, no usable date
    return _now_ms() - int(match.group(1)) * 86_400_000


def _location_from_path(external_path: object) -> str:
    """Workday encodes location in the URL path as /job/{Location-Slug}/{title-slug}.
    Used as a fallback when `locationsText` is absent, which is common."""
    match = _JOB_PATH_RE.search(str(external_path or ""))
    if not match:
        return ""
    try:
        segment = unquote(match.group(1))
    except Exception:  # noqa: BLE001 — malformed percent-encoding, use the raw segment
        segment = match.group(1)
    return segment.replace("-", " ")


def _resolve_max_pages(entry: PortalEntry) -> int:
    value = entry.max_pages
    if isinstance(value, int) and value > 0:
        return min(value, MAX_PAGES_CAP)
    return DEFAULT_MAX_PAGES


def _parse_retry_after(value: object) -> Optional[float]:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        pass
    try:
        from email.utils import parsedate_to_datetime

        target = parsedate_to_datetime(str(value))
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        return max(0.0, target.timestamp() - datetime.now(tz=timezone.utc).timestamp())
    except Exception:  # noqa: BLE001 — unparseable header, fall back to our backoff
        return None


def _is_retryable(exc: BaseException) -> bool:
    status = getattr(exc, "status", None)
    if status == 429:
        return True
    if isinstance(status, int) and status >= 500:
        return True
    return status is None  # network error / timeout / abort


def parse_response(payload: object, entry: PortalEntry, job_base: str) -> PostingList:
    postings = PostingList()
    raw = payload.get("jobPostings") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return postings
    for job in raw:
        if not isinstance(job, dict):
            continue
        external_path = job.get("externalPath")
        title = str(job.get("title") or "").strip()
        if not external_path or not title:
            continue
        postings.append(
            Posting(
                title=title,
                url=job_base + external_path,
                company=entry.name,
                location=job.get("locationsText") or _location_from_path(external_path),
                posted_at=_parse_posted_on(job.get("postedOn")),
            )
        )
    return postings


def _page_is_past_window(page: list[Posting], since_ms: Optional[int]) -> bool:
    """True once a page's oldest unambiguously-dated posting clears the window."""
    if since_ms is None:
        return False
    dated = [p.posted_at for p in page if isinstance(p.posted_at, int)]
    if not dated:
        return False
    return min(dated) < since_ms - EARLY_STOP_MARGIN_MS


class WorkdayProvider:
    id = "workday"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        endpoint = _resolve_endpoint(entry)
        return endpoint["api"] if endpoint else None

    async def _fetch_page(self, ctx: ScanContext, api: str, opts: dict) -> object:
        last_error: Optional[BaseException] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                return await ctx.fetch_json(api, **opts)
            except Exception as exc:  # noqa: BLE001 — classified below
                last_error = exc
                if attempt == MAX_RETRIES or not _is_retryable(exc):
                    raise
                backoff = min(RETRY_BASE_DELAY_S * 2**attempt, RETRY_MAX_DELAY_S)
                # A server-supplied Retry-After is honored but clamped — an unbounded
                # value (hostile or just misconfigured) would otherwise stall this
                # tenant for as long as the server asks, defeating a bounded backoff.
                retry_after = _parse_retry_after(getattr(exc, "retry_after", None))
                delay = (
                    min(retry_after, RETRY_MAX_DELAY_S * 4)
                    if retry_after is not None
                    else backoff + random.random() * 0.25
                )
                if ctx.sleep:
                    await ctx.sleep(delay)
        raise last_error if last_error else ValueError("workday: fetch failed")

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> PostingList:
        endpoint = _resolve_endpoint(entry)
        if not endpoint:
            raise ValueError(f"workday: cannot derive CXS endpoint for {entry.name}")

        # Some tenants front CXS with Cloudflare bot management that 500s requests
        # missing ordinary browser headers. A real Chrome UA + accept-language +
        # matching origin/referer clears it without per-tenant config.
        opts = {
            "method": "POST",
            "headers": {
                "content-type": "application/json",
                "accept": "application/json",
                "user-agent": BROWSER_LIKE_USER_AGENT,
                "accept-language": "en-US,en;q=0.9",
                "origin": endpoint["origin"],
                "referer": f"{endpoint['job_base']}/",
            },
        }

        def body(offset: int) -> str:
            return json.dumps(
                {"limit": PAGE_SIZE, "offset": offset, "searchText": "", "appliedFacets": {}}
            )

        since_ms = ctx.since_ms
        first = await self._fetch_page(ctx, endpoint["api"], {**opts, "content": body(0)})
        postings = parse_response(first, entry, endpoint["job_base"])

        total = first.get("total") if isinstance(first, dict) else None
        total = total if isinstance(total, int) else None
        first_batch = first.get("jobPostings") if isinstance(first, dict) else []
        max_pages = _resolve_max_pages(entry)

        # How many pages in total, including the one already fetched. When `total` is
        # absent, only probe further if the first page was full — a short first page
        # already means there is nothing more.
        if total is not None:
            pages_to_fetch = min(-(-total // PAGE_SIZE), max_pages)
        else:
            pages_to_fetch = max_pages if len(first_batch or []) >= PAGE_SIZE else 1

        # A context cap lets a health probe stop after one page rather than tripping
        # the retry loop on a deliberately aborted second request.
        if isinstance(ctx.max_pages, int) and ctx.max_pages > 0:
            pages_to_fetch = min(pages_to_fetch, ctx.max_pages)

        stop_reason = "complete"
        if _page_is_past_window(postings, since_ms):
            stop_reason = "early-stop"

        saw_dated = any(isinstance(p.posted_at, int) for p in postings)
        # Zero dated postings on page 0 with a bounded window and undated postings
        # being dropped anyway: further pagination is pure waste, since newest-first
        # ordering means older pages will not be dated either.
        if (
            stop_reason == "complete"
            and since_ms is not None
            and not ctx.include_undated
            and not saw_dated
            and postings
        ):
            stop_reason = "no-date-skip"

        truncated = False
        if stop_reason == "complete":
            page = 1
            while page < pages_to_fetch:
                if ctx.sleep:
                    await ctx.sleep(INTER_PAGE_DELAY_S)
                try:
                    payload = await self._fetch_page(
                        ctx, endpoint["api"], {**opts, "content": body(page * PAGE_SIZE)}
                    )
                except Exception:  # noqa: BLE001 — keep the pages already gathered
                    stop_reason = "fetch-error"
                    truncated = True
                    break
                page_postings = parse_response(payload, entry, endpoint["job_base"])
                postings.extend(page_postings)
                if total is None:
                    batch = payload.get("jobPostings") if isinstance(payload, dict) else []
                    if len(batch or []) < PAGE_SIZE:
                        break  # short page → last page reached
                if _page_is_past_window(page_postings, since_ms):
                    stop_reason = "early-stop"
                    break
                page += 1
            if stop_reason == "complete" and page >= pages_to_fetch and pages_to_fetch == max_pages:
                stop_reason = "cap"
                truncated = True

        # Tags consumed by the runner for the scan summary. `no-date-skip` fires on
        # many tenants during a directory sweep, so it is aggregated into one counter
        # rather than logged per company.
        postings.workday_no_date_skip = stop_reason == "no-date-skip"
        postings.workday_truncated = truncated
        return postings


PROVIDER = WorkdayProvider()
