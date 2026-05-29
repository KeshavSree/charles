# parser/sections.py
from __future__ import annotations

import re

SECTION_PATTERNS: dict[str, re.Pattern[str]] = {
    "experience": re.compile(r"^(work\s+)?experience$", re.IGNORECASE),
    "education": re.compile(r"^education$", re.IGNORECASE),
    "skills": re.compile(r"^(technical\s+)?skills$", re.IGNORECASE),
    "projects": re.compile(r"^projects$", re.IGNORECASE),
    "contact": re.compile(
        r"^(contact|contact\s+info(rmation)?|personal\s+info(rmation)?)$",
        re.IGNORECASE,
    ),
}


def detect_sections(text: str) -> dict[str, str]:
    """Split resume text into named sections.

    Lines are scanned top-to-bottom. A stripped line that matches a known
    section header pattern starts a new section. Text before the first
    header is discarded. Returns only sections that have content.
    """
    lines = text.splitlines()
    sections: dict[str, str] = {}
    current: str | None = None
    buffer: list[str] = []

    for line in lines:
        stripped = line.strip()
        matched: str | None = None
        for name, pattern in SECTION_PATTERNS.items():
            if pattern.match(stripped):
                matched = name
                break

        if matched is not None:
            if current is not None and buffer:
                content = "\n".join(buffer).strip()
                if content:
                    sections[current] = content
            current = matched
            buffer = []
        elif current is not None:
            buffer.append(line)

    if current is not None and buffer:
        content = "\n".join(buffer).strip()
        if content:
            sections[current] = content

    return sections
