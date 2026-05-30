from __future__ import annotations

import re
from dataclasses import dataclass

_DATE_RANGE = re.compile(
    r"(?:"
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?"
    r"|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    r"\.?\s+)?"
    r"(?:20|19)\d{2}"
    r"\s*[–\-—]\s*"
    r"(?:Present|Current|Now"
    r"|(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?"
    r"|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    r"\.?\s+)?(?:20|19)\d{2})",
    re.IGNORECASE,
)
_PRESENT = re.compile(r"present|current|now", re.IGNORECASE)


@dataclass
class ExperienceEntry:
    company: str = ""
    title: str = ""
    start_date: str = ""
    end_date: str = ""
    is_current: bool = False
    description: str = ""


def _parse_dates(date_str: str) -> tuple[str, str, bool]:
    """Return (start_date, end_date, is_current) from a date range string."""
    halves = re.split(r"\s*[–\-—]\s*", date_str, maxsplit=1)
    start = halves[0].strip()
    end = ""
    is_current = False
    if len(halves) > 1:
        end_raw = halves[1].strip()
        if _PRESENT.fullmatch(end_raw):
            end = "Present"
            is_current = True
        else:
            end = end_raw
    return start, end, is_current


def extract_experience(section_text: str) -> list[ExperienceEntry]:
    if not section_text.strip():
        return []

    lines = section_text.splitlines()

    # Pass 1: find line indices where date ranges appear
    date_line_indices = [i for i, l in enumerate(lines) if _DATE_RANGE.search(l.strip())]
    if not date_line_indices:
        return []

    # For each date line, scan backwards to find header lines (consecutive non-empty
    # lines immediately preceding the date line).  This cleanly separates the body of
    # the previous entry from the header of the next entry even when they are adjacent.
    header_starts: list[int] = []
    for date_idx in date_line_indices:
        h = date_idx
        while h > 0 and lines[h - 1].strip():
            h -= 1
        header_starts.append(h)

    entries: list[ExperienceEntry] = []

    for idx, date_idx in enumerate(date_line_indices):
        next_date_idx = date_line_indices[idx + 1] if idx + 1 < len(date_line_indices) else len(lines)
        next_header_start = header_starts[idx + 1] if idx + 1 < len(date_line_indices) else len(lines)

        # Header: consecutive non-empty lines immediately before this date line
        header = [lines[i].strip() for i in range(header_starts[idx], date_idx) if lines[i].strip()]
        date_line = lines[date_idx].strip()
        # Body: lines after this date line up to the start of the next entry's header
        body = [l.strip() for l in lines[date_idx + 1:next_header_start] if l.strip()]

        entry = ExperienceEntry()

        # Parse dates from the date line
        m = _DATE_RANGE.search(date_line)
        if m:
            date_str = m.group(0)
            entry.start_date, entry.end_date, entry.is_current = _parse_dates(date_str)
            # Text before the date range on the same line = inline title prefix
            prefix = date_line[: m.start()].strip().rstrip("| -")
            if prefix:
                entry.title = prefix

        # Assign header lines to title/company
        non_empty = [h for h in header if h]
        if non_empty:
            if not entry.title:
                entry.title = non_empty[0]
                if len(non_empty) > 1:
                    entry.company = non_empty[1]
            else:
                entry.company = non_empty[0]

        # Description: body lines, excluding the first one if it looks like a company
        # (company sometimes appears on the line just after the date line)
        desc_start = 0
        if body and not entry.company and not body[0].startswith(("•", "-", "·")):
            entry.company = body[0]
            desc_start = 1
        entry.description = "\n".join(body[desc_start:]).strip()

        entries.append(entry)

    return entries
