"""Remotive — board-wide remote-jobs feed."""
from __future__ import annotations

from scanner.sources._board import make_json_board
from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import https_url, pick
from scanner.text import strip_html
from scanner.types import Posting


def _to_posting(row: dict, default: str) -> Posting:
    return Posting(
        title=pick(row, "title"),
        url=https_url(row.get("url")),
        company=pick(row, "company_name") or default,
        location=pick(row, "candidate_required_location"),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(row.get("publication_date")),
    )


SOURCE = make_json_board(
    "remotive", url="https://remotive.com/api/remote-jobs",
    row_key="jobs", to_posting=_to_posting, label="Remotive",
)
