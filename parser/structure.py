"""Sections and entries, derived from font tiers rather than regexes.

A résumé has three visual tiers: the section header ("Experience"), the entry
header ("Software Developer  ...  January 2025 - Current"), and body text.  Once
`layout` has attached a font size to every line those tiers are directly
measurable, so entry boundaries no longer have to be guessed from where a date
range happens to appear -- which is what made a bullet from one job get read as
the next job's employer.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass

from .layout import Line, body_size

# Canonical names for the sections we know how to parse.  Anything else is kept
# under a slug of its own heading text so a custom section is preserved rather
# than silently swallowed into its predecessor.
SECTION_ALIASES: dict[str, re.Pattern[str]] = {
    "experience": re.compile(
        r"^(work|professional|relevant|employment)?\s*experience$|^employment( history)?$",
        re.IGNORECASE,
    ),
    "education": re.compile(r"^education( (and|&) training)?$", re.IGNORECASE),
    "skills": re.compile(
        r"^(technical |core |key )?(skills|competencies|skills (and|&) \w+)$", re.IGNORECASE
    ),
    "projects": re.compile(r"^(personal |technical |side )?projects$", re.IGNORECASE),
    "contact": re.compile(
        r"^(contact|contact\s+info(rmation)?|personal\s+info(rmation)?)$", re.IGNORECASE
    ),
    "leadership": re.compile(r"^(leadership|activities|involvement|extracurriculars?)\b.*$", re.IGNORECASE),
    "awards": re.compile(r"^(awards|honors|achievements)\b.*$", re.IGNORECASE),
    "certifications": re.compile(r"^certifications?( (and|&) licenses)?$", re.IGNORECASE),
    "publications": re.compile(r"^(publications|research)$", re.IGNORECASE),
    "summary": re.compile(r"^(summary|objective|profile|about( me)?)$", re.IGNORECASE),
}


class Entry:
    """One item within a section: a header line, its sub-header lines, and bullets."""

    def __init__(self, head: Line):
        self.head = head
        self.subs: list[Line] = []
        self.bullets: list[str] = []

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Entry(head={self.head.columns!r}, subs={[s.columns for s in self.subs]!r}, bullets={len(self.bullets)})"


class Section:
    def __init__(self, name: str, heading: str):
        self.name = name
        self.heading = heading
        self.lines: list[Line] = []
        self.entries: list[Entry] = []

    @property
    def text(self) -> str:
        return "\n".join(l.text for l in self.lines)


def _canonical(text: str) -> str | None:
    for name, pattern in SECTION_ALIASES.items():
        if pattern.match(text.strip()):
            return name
    return None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_") or "section"


@dataclass
class HeadingStyle:
    """How this document happens to typeset its section headers."""

    size: float
    bold: bool
    upper: bool


def _heading_style(lines: list[Line], body: float) -> HeadingStyle | None:
    """Learn the section-header style from lines whose text is a *known* section
    name, so an unusually prominent job title can't be mistaken for one.

    Size alone is not enough: plenty of templates set headers at body size and
    separate them with bold and ALL CAPS instead, which is why those résumés
    previously came back as one undifferentiated blob.
    """
    anchors = [
        l for l in lines
        if len(l.columns) == 1 and not l.bullet and _canonical(l.left)
        and (l.size > body + 0.3 or l.bold or l.left.isupper())
    ]
    if not anchors:
        return None
    return HeadingStyle(
        size=statistics.median(l.size for l in anchors),
        bold=all(l.bold for l in anchors),
        upper=all(l.left.isupper() for l in anchors),
    )


def _is_heading(line: Line, style: HeadingStyle | None, body: float) -> bool:
    if line.bullet or len(line.columns) != 1 or not line.left.strip():
        return False
    if style is None:
        # No anchor found: fall back to name matching alone.
        return line.size > body + 0.3 and _canonical(line.left) is not None
    if abs(line.size - style.size) >= 0.4 or len(line.left.split()) > 5:
        return False
    # Only apply the weight/case discriminators the anchors actually agreed on;
    # a header set larger than the body needs no further evidence.
    if style.size <= body + 0.3:
        if style.bold and not line.bold:
            return False
        if style.upper and not line.left.isupper():
            return False
        if not style.bold and not style.upper:
            return False
    return True


def parse_document(lines: list[Line]) -> tuple[list[Line], list[Section]]:
    """Split lines into (header lines, sections).

    Header lines are everything above the first section heading -- name and
    contact details in every résumé layout we care about.
    """
    body = body_size(lines)
    style = _heading_style(lines, body)

    header: list[Line] = []
    sections: list[Section] = []
    for line in lines:
        if _is_heading(line, style, body):
            text = line.left.strip()
            sections.append(Section(_canonical(text) or _slug(text), text))
        elif sections:
            sections[-1].lines.append(line)
        else:
            header.append(line)

    entry_size = _entry_size(sections, body, style)
    for section in sections:
        section.entries = _split_entries(section.lines, entry_size, body)
    return header, sections


def _entry_size(sections: list[Section], body: float, style: HeadingStyle | None) -> float | None:
    """Font size used by entry headers: the tier between body and section heading.

    Returns None when the document has no such tier (every line one size), which
    sends `_split_entries` to its date-range fallback.
    """
    sizes = [
        l.size
        for s in sections
        for l in s.lines
        if not l.bullet and l.size > body + 0.3 and (style is None or l.size < style.size - 0.3)
    ]
    return statistics.median(sizes) if sizes else None


def _split_entries(lines: list[Line], entry_size: float | None, body: float) -> list[Entry]:
    """Group a section's lines into entries.

    Preferred signal is the entry-header font tier.  Résumés that set every line
    at one size have no such tier, so those fall back to "a non-bullet line with
    a date range in it starts an entry".
    """
    entries: list[Entry] = []
    current: Entry | None = None
    last_bullet_x: float | None = None

    for line in lines:
        starts_entry = (
            not line.bullet
            and (
                abs(line.size - entry_size) < 0.4
                if entry_size is not None
                else bool(_DATE_RANGE.search(line.text))
            )
        )
        if starts_entry:
            current = Entry(line)
            entries.append(current)
            last_bullet_x = None
            continue
        if current is None:
            continue

        if line.bullet:
            current.bullets.append(line.text)
            last_bullet_x = line.x0
        elif last_bullet_x is not None and abs(line.x0 - last_bullet_x) < 3.0:
            # Wrapped continuation of the previous bullet: same left edge, no glyph.
            current.bullets[-1] += " " + line.text
        elif current.bullets:
            current.bullets.append(line.text)
        else:
            current.subs.append(line)

    return entries


_DATE_RANGE = re.compile(
    r"(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2}"
    r"\s*(?:[-–—]|to)\s*"
    r"(?:Present|Current|Now|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?(?:19|20)\d{2})",
    re.IGNORECASE,
)
