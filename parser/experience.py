from __future__ import annotations

import re
from dataclasses import dataclass, field

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


def extract_experience(section_text: str) -> list[ExperienceEntry]:
    if not section_text.strip():
        return []

    lines = section_text.splitlines()
    entries: list[ExperienceEntry] = []
    current: ExperienceEntry | None = None
    desc_lines: list[str] = []
    header_lines: list[str] = []  # lines before the date range in a block

    def flush(entry: ExperienceEntry, desc: list[str]) -> None:
        entry.description = "\n".join(l for l in desc if l.strip()).strip()
        entries.append(entry)

    for line in lines:
        stripped = line.strip()
        m = _DATE_RANGE.search(stripped)

        if m:
            # Save previous
            if current is not None:
                flush(current, desc_lines)

            current = ExperienceEntry()
            desc_lines = []

            date_str = m.group(0)
            halves = re.split(r"\s*[–\-—]\s*", date_str, maxsplit=1)
            current.start_date = halves[0].strip()
            if len(halves) > 1:
                end = halves[1].strip()
                if _PRESENT.match(end):
                    current.end_date = "Present"
                    current.is_current = True
                else:
                    current.end_date = end

            # Text before the date range on the same line → title prefix
            prefix = stripped[: m.start()].strip().rstrip("| -")
            if prefix:
                current.title = prefix

            # Assign queued header lines to title/company
            non_empty = [h for h in header_lines if h.strip()]
            if non_empty:
                if not current.title:
                    current.title = non_empty[0]
                    if len(non_empty) > 1:
                        current.company = non_empty[1]
                else:
                    current.company = non_empty[0]
            header_lines = []

        elif current is None:
            # Before first date range: accumulate as header
            if stripped:
                header_lines.append(stripped)
        else:
            # After date range: first non-empty line with no company yet = company
            if stripped and not current.company and not stripped.startswith(("•", "-", "·")):
                current.company = stripped
            elif stripped:
                desc_lines.append(stripped)

    if current is not None:
        flush(current, desc_lines)

    return entries
