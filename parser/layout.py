"""Layout-aware PDF reading.

`pdf.extract_text` flattens a résumé into lines, which destroys the two things
that carry the most structure in a real résumé: the **column split** (title on
the left, dates on the right) and the **font tier** (section header > entry
header > body).  Flattening is why "KiharaLab" and "West Lafayette, IN" arrive
glued together and why a bullet from one job gets read as the next job's
employer.

This module keeps both.  It reads words with their geometry, groups them into
lines by vertical overlap, splits each line into columns at large horizontal
gaps, and tags each line with its font size / weight so downstream parsers can
reason about tiers instead of guessing from regexes.
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

import pdfplumber

# Any run of whitespace wider than this many points is a column gutter rather
# than a word space.  Normal inter-word spacing in a 12pt résumé is 3-6pt, and
# the narrowest real gutters observed are ~40pt, so 18 sits comfortably between.
_COLUMN_GAP = 18.0

_BULLET_CHARS = "•·▪◦‣∙-–—*"
# Bullet glyphs are frequently typeset in a tiny symbol font on their own
# baseline (LaTeX sets them at 6pt next to 10.9pt body text), so they must not
# drag the line's font size down or count as a column of their own.
_BULLET_RE = re.compile(rf"^[{re.escape(_BULLET_CHARS)}]+$")

_BOLD_RE = re.compile(r"bold|black|heavy|semib|cmbx|-bd\b", re.IGNORECASE)
# Trailing punctuation is often typeset in a different font from the word it
# follows, which makes it a separate "word" with a near-zero gap.  Re-attaching
# it keeps "queries." from coming out as "queries ."
_TIGHT_PUNCT = re.compile(r"^[.,;:!?%)\]}]")
_ITALIC_RE = re.compile(r"italic|oblique|cmti|cmmi|cmbxti", re.IGNORECASE)


@dataclass
class Line:
    """One visual line of the document."""

    columns: list[str]           # text runs, left to right, split at gutters
    size: float                  # dominant font size (bullet glyphs excluded)
    bold: bool
    italic: bool
    bullet: bool                 # line begins with a bullet glyph
    x0: float                    # left edge of the first non-bullet run
    top: float
    page: int
    _col_x0: list[float] = field(default_factory=list, repr=False)

    @property
    def text(self) -> str:
        return "  ".join(self.columns)

    @property
    def left(self) -> str:
        return self.columns[0] if self.columns else ""

    @property
    def right(self) -> str:
        """The rightmost column, or "" when the line is single-column."""
        return self.columns[-1] if len(self.columns) > 1 else ""


def _style(fontnames: list[str]) -> tuple[bool, bool]:
    # Subset-embedded fonts arrive as "ABCDEF+CMBX12"; the prefix is noise.
    names = [n.split("+")[-1] for n in fontnames]
    joined = " ".join(names)
    return bool(_BOLD_RE.search(joined)), bool(_ITALIC_RE.search(joined))


def _join(words: list[dict]) -> str:
    """Concatenate a column's words, suppressing the space before punctuation
    that only became a separate word because of a font switch."""
    out = words[0]["text"]
    for prev, cur in zip(words, words[1:]):
        tight = cur["x0"] - prev["x1"] < 1.0 or (
            _TIGHT_PUNCT.match(cur["text"]) and cur["x0"] - prev["x1"] < 2.5
        )
        out += ("" if tight else " ") + cur["text"]
    return out


def _group_into_lines(words: list[dict], page_no: int) -> list[Line]:
    """Cluster words into lines by vertical overlap, then split into columns."""
    rows: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        placed = False
        for row in rows:
            # Two words share a line when their vertical spans overlap by more
            # than half the shorter one -- tolerant enough for a 6pt bullet
            # glyph sitting beside 11pt text, strict enough for tight leading.
            top = max(row[0]["top"], w["top"])
            bottom = min(row[0]["bottom"], w["bottom"])
            shorter = min(row[0]["bottom"] - row[0]["top"], w["bottom"] - w["top"])
            if shorter > 0 and (bottom - top) > shorter * 0.5:
                row.append(w)
                placed = True
                break
        if not placed:
            rows.append([w])

    lines: list[Line] = []
    for row in rows:
        row.sort(key=lambda w: w["x0"])
        bullet = bool(row) and bool(_BULLET_RE.match(row[0]["text"]))
        body = row[1:] if bullet else row
        if not body:
            continue

        # Split at gutters.
        columns: list[list[dict]] = [[body[0]]]
        for prev, cur in zip(body, body[1:]):
            if cur["x0"] - prev["x1"] > _COLUMN_GAP:
                columns.append([cur])
            else:
                columns[-1].append(cur)

        sizes = [w["size"] for w in body]
        bold, italic = _style([w["fontname"] for w in body])
        lines.append(Line(
            columns=[_join(col) for col in columns],
            size=statistics.median(sizes),
            bold=bold,
            italic=italic,
            bullet=bullet,
            x0=body[0]["x0"],
            top=row[0]["top"],
            page=page_no,
            _col_x0=[col[0]["x0"] for col in columns],
        ))

    lines.sort(key=lambda l: (l.page, l.top))
    return lines


def extract_lines(file_path: str) -> list[Line]:
    """Read a PDF into geometry- and font-aware lines, in reading order."""
    lines: list[Line] = []
    with pdfplumber.open(file_path) as pdf:
        for page_no, page in enumerate(pdf.pages):
            words = page.extract_words(extra_attrs=["fontname", "size"])
            lines.extend(_group_into_lines(words, page_no))
    return lines


def body_size(lines: list[Line]) -> float:
    """The document's baseline font size: the size covering the most text.

    Weighted by characters so a handful of large headings cannot outvote the
    body copy, and rounded to 0.5pt so kerning jitter doesn't split one tier
    into two.
    """
    weights: dict[float, int] = {}
    for line in lines:
        if not line.columns:
            continue
        weights[round(line.size * 2) / 2] = weights.get(round(line.size * 2) / 2, 0) + len(line.text)
    if not weights:
        return 0.0
    return max(weights.items(), key=lambda kv: kv[1])[0]
