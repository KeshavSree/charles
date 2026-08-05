"""Himalayas — board-wide remote-jobs feed."""
from __future__ import annotations

from scanner.sources._board import make_json_board
from scanner.providers._common import to_epoch_ms
from scanner.providers._feed import _parse_rfc822, https_url, pick
from scanner.text import strip_html
from scanner.types import Posting, Salary


def _company(row: dict) -> str:
    """Prefer the slug over `companyName`.

    Himalayas' API returns the literal placeholder string "name" for
    `companyName` on multi-result pages (verified live: correct at limit=1, broken
    at limit=100), so the slug is the only reliable source.
    """
    slug = pick(row, "companySlug")
    if slug:
        return " ".join(part.capitalize() for part in slug.split("-"))
    name = pick(row, "companyName")
    return "" if name == "name" else name


def _to_posting(row: dict, default: str) -> Posting:
    restrictions = row.get("locationRestrictions")
    if isinstance(restrictions, list):
        location = ", ".join(str(r) for r in restrictions if r)
    else:
        location = str(restrictions or "")
    published = row.get("pubDate")
    low, high = row.get("minSalary"), row.get("maxSalary")
    salary = None
    if low or high:
        try:
            salary = Salary(
                min=float(low) if low else None,
                max=float(high) if high else None,
                currency=(row.get("currency") or "").upper(),
            )
        except (TypeError, ValueError):
            salary = None
    return Posting(
        title=pick(row, "title"),
        url=https_url(row.get("applicationLink") or row.get("guid")),
        company=_company(row) or default,
        location=location,
        description=strip_html(row.get("description") or row.get("excerpt")),
        posted_at=to_epoch_ms(published) or _parse_rfc822(str(published or "")),
        salary=salary,
    )


SOURCE = make_json_board(
    "himalayas", url="https://himalayas.app/jobs/api?limit=100",
    row_key="jobs", to_posting=_to_posting, label="Himalayas",
)
