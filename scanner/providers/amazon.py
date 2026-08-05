"""Amazon Jobs — single-employer search API.

The board is enormous, so an entry is expected to narrow it via `careers_url` query
parameters; without one, MAX_PAGES just returns the most recent 2,000 postings.
"""
from __future__ import annotations

from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit

from scanner.providers._common import to_epoch_ms
from scanner.types import PortalEntry, Posting, ScanContext

ORIGIN = "https://www.amazon.jobs"
PAGE_SIZE = 100  # amazon.jobs caps result_limit at 100
MAX_PAGES = 20   # safety cap — at most 2,000 postings per entry


def _matches(entry: PortalEntry) -> bool:
    for raw in (entry.api, entry.careers_url):
        if not isinstance(raw, str) or not raw:
            continue
        try:
            host = (urlsplit(raw).hostname or "").lower()
        except (ValueError, UnicodeError):
            continue
        # Match the host, not a path segment, so a spoofed URL can't claim this.
        if host == "amazon.jobs" or host.endswith(".amazon.jobs"):
            return True
    return False


def _query(entry: PortalEntry, offset: int) -> str:
    params: list[tuple[str, str]] = []
    raw = entry.careers_url or ""
    try:
        params = [
            (k, v) for k, v in parse_qsl(urlsplit(raw).query, keep_blank_values=True)
            if k not in ("offset", "result_limit")
        ]
    except (ValueError, UnicodeError):
        params = []
    keys = {k for k, _ in params}
    if "base_query" not in keys:
        params.append(("base_query", ""))
    if "loc_query" not in keys:
        params.append(("loc_query", ""))
    if "sort" not in keys:
        params.append(("sort", "recent"))
    params.append(("result_limit", str(PAGE_SIZE)))
    params.append(("offset", str(offset)))
    return f"{ORIGIN}/en/search.json?{urlencode(params)}"


class AmazonProvider:
    id = "amazon"

    def detect(self, entry: PortalEntry) -> Optional[str]:
        return _query(entry, 0) if _matches(entry) else None

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        if not _matches(entry):
            raise ValueError(f"amazon: entry is not an amazon.jobs URL: {entry.name}")
        out: list[Posting] = []
        seen: set[str] = set()
        for page in range(MAX_PAGES):
            payload = await ctx.fetch_json(_query(entry, page * PAGE_SIZE), timeout=30.0)
            rows = payload.get("jobs") if isinstance(payload, dict) else None
            if not isinstance(rows, list) or not rows:
                break
            fresh = 0
            for row in rows:
                if not isinstance(row, dict):
                    continue
                path = row.get("job_path")
                if not isinstance(path, str) or not path:
                    continue
                url = path if path.startswith("http") else ORIGIN + (
                    path if path.startswith("/") else "/" + path
                )
                if url in seen:
                    continue
                seen.add(url)
                fresh += 1
                out.append(
                    Posting(
                        title=(row.get("title") or "").strip(),
                        url=url,
                        company=row.get("company_name") or entry.name,
                        location=(row.get("normalized_location") or row.get("location") or "").strip(),
                        description=row.get("description_short") or "",
                        posted_at=to_epoch_ms(row.get("posted_date") or row.get("updated_time")),
                    )
                )
            if fresh == 0:
                break  # API ignored offset / looped
            if len(rows) < PAGE_SIZE:
                break
        return out


PROVIDER = AmazonProvider()
