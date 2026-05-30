from __future__ import annotations

import re
from dataclasses import dataclass

_YEAR = re.compile(r"\b(20\d{2}|19\d{2})\b")
_GPA = re.compile(r"GPA[:\s]+(\d\.\d)", re.IGNORECASE)
_DEGREE_KEYWORDS = re.compile(
    r"\b(Bachelor|Master|PhD|Doctor|Associate|B\.?S\.?|M\.?S\.?|B\.?A\.?|M\.?A\.?|M\.?Eng\.?)\b",
    re.IGNORECASE,
)
_MAJOR_SPLIT = re.compile(r"\bin\b|,\s*", re.IGNORECASE)


@dataclass
class EducationEntry:
    institution: str = ""
    degree: str = ""
    major: str = ""
    gpa: str = ""
    grad_year: str = ""


def extract_education(section_text: str) -> list[EducationEntry]:
    if not section_text.strip():
        return []

    lines = [l.strip() for l in section_text.splitlines()]
    entries: list[EducationEntry] = []
    current: EducationEntry | None = None
    pending: list[str] = []

    def flush(entry: EducationEntry, pending_lines: list[str]) -> None:
        for line in pending_lines:
            if not line:
                continue
            m = _GPA.search(line)
            if m:
                entry.gpa = m.group(1)
            y = _YEAR.search(line)
            if y and not entry.grad_year:
                entry.grad_year = y.group(1)
            if _DEGREE_KEYWORDS.search(line) and not entry.degree:
                # Split on " in " or ", " to separate degree from major
                parts = _MAJOR_SPLIT.split(line, maxsplit=1)
                entry.degree = parts[0].strip().split("|")[0].strip()
                if len(parts) > 1:
                    entry.major = parts[1].strip().split("|")[0].strip()
        entries.append(entry)

    for line in lines:
        if not line:
            # Blank line separates entries — flush whenever we have a current entry
            if current is not None:
                flush(current, pending)
                current = None
                pending = []
            continue

        if current is None:
            # First non-blank line of a new entry = institution
            current = EducationEntry(institution=line)
            pending = []
        else:
            pending.append(line)

    # Flush the last entry (EOF with no trailing blank line)
    if current is not None:
        flush(current, pending)

    return entries
