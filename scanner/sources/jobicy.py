"""Jobicy — board-wide remote-jobs feed."""
from __future__ import annotations

from scanner.sources._board import make_json_board
from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import _parse_rfc822, https_url, pick
from scanner.text import strip_html
from scanner.types import Posting, Salary


def _salary(row: dict) -> Salary | None:
    low, high = row.get("salaryMin"), row.get("salaryMax")
    if not low and not high:
        return None
    period = (row.get("salaryPeriod") or "yearly").lower()
    factor = {"hourly": 2080, "daily": 260, "weekly": 52, "monthly": 12}.get(period, 1)
    try:
        low = float(low) * factor if low else None
        high = float(high) * factor if high else None
    except (TypeError, ValueError):
        return None
    return Salary(min=low, max=high, currency=(row.get("salaryCurrency") or "").upper())


def _to_posting(row: dict, default: str) -> Posting:
    published = row.get("pubDate")
    return Posting(
        title=pick(row, "jobTitle"),
        url=https_url(row.get("url")),
        company=pick(row, "companyName") or default,
        location=pick(row, "jobGeo"),
        description=strip_html(row.get("jobDescription") or row.get("jobExcerpt")),
        posted_at=to_epoch_ms(published) or _parse_rfc822(str(published or "")),
        salary=_salary(row),
    )


SOURCE = make_json_board(
    "jobicy", url="https://jobicy.com/api/v2/remote-jobs?count=100",
    row_key="jobs", to_posting=_to_posting, label="Jobicy",
)
