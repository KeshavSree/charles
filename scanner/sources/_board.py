"""Job-board sources: one feed, no company list.

The distinction from a provider matters. Greenhouse is software companies *use*, so
asking it for jobs is meaningless without naming whose board. A job board is a site that
already holds jobs from thousands of companies, so you just ask and get a pile back.

Because they need no curation, the title and location filters are the *only* thing
constraining these. Weak filters plus board sources floods the database, which is why
each one is opt-in per source rather than on by default.
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import _parse_rfc822, https_url, rss_items, xml_text
from scanner.runner import SourceContext
from scanner.text import strip_html
from scanner.types import Posting


def make_json_board(
    source_id: str,
    *,
    label: str,
    url: str,
    row_key: Optional[str],
    to_posting: Callable[[dict, str], Optional[Posting]],
    timeout: float = 30.0,
):
    class JsonBoardSource:
        id = source_id
        profile = "reverse"

        def __init__(self) -> None:
            self.label = label

        async def scan(self, sctx: SourceContext) -> None:
            payload = await sctx.http.fetch_json(url, timeout=timeout)
            if row_key is None:
                rows = payload if isinstance(payload, list) else []
            else:
                rows = payload.get(row_key) if isinstance(payload, dict) else None
                rows = rows if isinstance(rows, list) else []

            sctx.result.companies_available = len(rows)
            sctx.result.companies_scanned = len(rows)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                posting = to_posting(row, label)
                if posting:
                    posting.provider_id = source_id
                    sctx.keep(posting)

    return JsonBoardSource()


def make_rss_board(
    source_id: str,
    *,
    label: str,
    url: str,
    location_tag: Optional[str] = None,
    timeout: float = 30.0,
):
    class RssBoardSource:
        id = source_id
        profile = "reverse"

        def __init__(self) -> None:
            self.label = label

        async def scan(self, sctx: SourceContext) -> None:
            xml = await sctx.http.fetch_text(url, timeout=timeout)
            items = rss_items(xml)
            sctx.result.companies_available = len(items)
            sctx.result.companies_scanned = len(items)

            for item in items:
                title = xml_text(item, "title")
                link = https_url(xml_text(item, "link"))
                if not title or not link:
                    continue
                published = xml_text(item, "pubDate")
                posting = Posting(
                    title=title,
                    # Feed company tags carry markup often enough that an unstripped
                    # value ends up as e.g. "Maverick Trading<b".
                    company=strip_html(
                        xml_text(item, "job_listing:company")
                        or xml_text(item, "job:company")
                        or xml_text(item, "dc:creator")
                    )
                    or label,
                    url=link,
                    location=xml_text(item, location_tag) if location_tag else "",
                    description=strip_html(
                        xml_text(item, "content:encoded") or xml_text(item, "description")
                    ),
                    posted_at=_parse_rfc822(published) or to_epoch_ms(published),
                )
                posting.provider_id = source_id
                sctx.keep(posting)

    return RssBoardSource()
