"""Working Nomads — board-wide remote-jobs feed (bare JSON array)."""
from __future__ import annotations

from scanner.sources._board import make_json_board
from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import _parse_rfc822, https_url, pick
from scanner.text import strip_html
from scanner.types import Posting


def _to_posting(row: dict, default: str) -> Posting:
    published = row.get("pub_date")
    return Posting(
        title=pick(row, "title"),
        url=https_url(row.get("url")),
        company=pick(row, "company_name") or default,
        location=pick(row, "location"),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(published) or _parse_rfc822(str(published or "")),
    )


SOURCE = make_json_board(
    "workingnomads", url="https://www.workingnomads.com/api/exposed_jobs/",
    row_key=None, to_posting=_to_posting, label="Working Nomads",
)
