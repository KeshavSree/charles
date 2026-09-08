"""Date normalization.

Everything downstream of the parser -- the profile editor's `DateField`, the
extension's `parseDateParts` -- speaks `MM/YYYY`.  Résumés write dates as prose
("January 2025", "Summer 2023", "2024"), so this is where the two meet.  It
lives in its own module because both the layout parser and the flat-text
fallback have to agree on the answer.
"""
from __future__ import annotations

import re

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
# A term names a span, so which end of it we want depends on which end of the
# range we're normalizing: "Summer 2023 - Fall 2023" is 05/2023 - 12/2023.
_TERMS = {
    "spring": (1, 5), "summer": (5, 8), "fall": (8, 12),
    "autumn": (8, 12), "winter": (12, 3),
}

PRESENT = re.compile(r"^(present|current|now|ongoing|today)$", re.IGNORECASE)
_YEAR = re.compile(r"(19|20)\d{2}")


def is_present(text: str) -> bool:
    return bool(PRESENT.match(text.strip().rstrip(".")))


def to_month_year(text: str, *, end: bool = False) -> str:
    """Normalize one endpoint of a résumé date range to `MM/YYYY`.

    `end=True` resolves the ambiguity in dates that name a span rather than a
    month: a bare "2024" as a start means January, as an end means December.
    Returns "" when there is no year to anchor on, since a month alone is not
    something the downstream fields can use.
    """
    if not text:
        return ""
    cleaned = text.strip().rstrip(".")
    year_match = _YEAR.search(cleaned)
    if not year_match:
        return ""
    year = year_match.group(0)

    lowered = cleaned.lower()
    month: int | None = None

    for name, (start_m, end_m) in _TERMS.items():
        if name in lowered:
            month = end_m if end else start_m
            break

    if month is None:
        # Match the month word by prefix so "Sept", "Sep" and "September" agree.
        for abbr, num in _MONTHS.items():
            if re.search(rf"\b{abbr}", lowered):
                month = num
                break

    if month is None:
        month = 12 if end else 1

    return f"{month:02d}/{year}"
