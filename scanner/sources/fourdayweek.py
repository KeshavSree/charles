"""4 Day Week — board of 4-day-week roles.

Job URLs are rebuilt on the trusted host from the slug rather than trusting a link
field, so a compromised feed cannot redirect users off-site.
"""
from __future__ import annotations

from scanner.sources._board import make_json_board
from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import pick
from scanner.text import strip_html
from scanner.types import Posting

TRUSTED_HOST = "4dayweek.io"


def _location(row: dict) -> str:
    places = row.get("locations")
    if isinstance(places, list):
        parts = [
            ", ".join(
                str(p.get(k)) for k in ("city", "country") if isinstance(p, dict) and p.get(k)
            )
            for p in places
        ]
        joined = " · ".join(p for p in parts if p)
        if joined:
            return joined
    arrangement = row.get("work_arrangement")
    return "Remote" if arrangement == "remote" else str(arrangement or "")


def _to_posting(row: dict, default: str) -> Posting:
    slug = pick(row, "slug")
    return Posting(
        title=pick(row, "title", "name"),
        url=f"https://{TRUSTED_HOST}/job/{slug}" if slug else "",
        company=pick(row, "company_name", "company") or default,
        location=_location(row),
        description=strip_html(row.get("description")),
        posted_at=to_epoch_ms(row.get("created_at") or row.get("published_at")),
    )


SOURCE = make_json_board(
    "4dayweek", url="https://4dayweek.io/api/jobs",
    row_key="jobs", to_posting=_to_posting, label="4 Day Week",
)
