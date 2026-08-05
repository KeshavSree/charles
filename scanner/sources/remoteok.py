"""RemoteOK — board-wide remote-jobs feed.

The first array element is a legal/attribution notice rather than a posting, which is
why rows without a `position` are skipped instead of assumed valid.
"""
from __future__ import annotations

from scanner.sources._board import make_json_board
from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import https_url, pick
from scanner.text import strip_html
from scanner.types import Posting


def _to_posting(row: dict, default: str) -> Posting:
    return Posting(
        title=pick(row, "position", "title"),
        url=https_url(row.get("url") or row.get("apply_url")),
        company=pick(row, "company") or default,
        location=pick(row, "location"),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(row.get("date")),
    )


SOURCE = make_json_board(
    "remoteok", url="https://remoteok.com/api",
    row_key=None, to_posting=_to_posting, label="RemoteOK",
)
