"""The Muse. Board-wide public jobs API, paginated."""
from __future__ import annotations

from typing import Optional

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import https_url, pick
from scanner.runner import SourceContext
from scanner.text import strip_html
from scanner.types import Posting

FEED_BASE = "https://www.themuse.com/api/public/jobs"
MAX_PAGES = 20


def _to_posting(row: dict, default: str) -> Optional[Posting]:
    refs = row.get("refs") or {}
    locations = row.get("locations") or []
    company = row.get("company") or {}
    return Posting(
        title=pick(row, "name"),
        url=https_url(refs.get("landing_page") if isinstance(refs, dict) else ""),
        company=(company.get("name") if isinstance(company, dict) else "") or default,
        location=", ".join(
            l.get("name", "") for l in locations if isinstance(l, dict) and l.get("name")
        ),
        description=strip_html(row.get("contents")),
        posted_at=to_epoch_ms(row.get("publication_date")),
    )


class TheMuseSource:
    id = "themuse"
    label = "The Muse"
    profile = "reverse"

    async def scan(self, sctx: SourceContext) -> None:
        seen = 0
        for page in range(1, MAX_PAGES + 1):
            payload = await sctx.http.fetch_json(f"{FEED_BASE}?page={page}", timeout=30.0)
            rows = payload.get("results") if isinstance(payload, dict) else None
            if not isinstance(rows, list) or not rows:
                break
            seen += len(rows)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                posting = _to_posting(row, self.label)
                if posting:
                    posting.provider_id = self.id
                    sctx.keep(posting)
        sctx.result.companies_available = seen
        sctx.result.companies_scanned = seen


SOURCE = TheMuseSource()
