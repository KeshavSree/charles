"""Field extraction from structured entries.

`structure` decides *where* an entry begins and which text belongs to it; this
module decides *what each run of text means*.  Because the column split already
separated the left-hand run from the right-hand one, the job here is only to
label them -- which side is the employer, which is the role, which is the date
range -- rather than to recover structure from a flattened string.
"""
from __future__ import annotations

import re

from .contact import ContactInfo, _EMAIL, _GITHUB, _LINKEDIN, _PHONE, _WEBSITE
from .dates import is_present, to_month_year
from .education import EducationEntry
from .experience import ExperienceEntry
from .layout import Line
from .structure import Section

_MONTH = (
    r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?"
    r"|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
)
_TERM = r"(?:Spring|Summer|Fall|Autumn|Winter)"
_POINT = rf"(?:(?:{_MONTH}|{_TERM})\.?\s+)?(?:19|20)\d{{2}}|Present|Current|Now|Ongoing"
_DATE_RANGE = re.compile(
    rf"({_POINT})\s*(?:[-–—]|\bto\b)\s*({_POINT})", re.IGNORECASE
)
_SINGLE_DATE = re.compile(rf"(?:{_MONTH}|{_TERM})\.?\s+(?:19|20)\d{{2}}|\b(?:19|20)\d{{2}}\b", re.IGNORECASE)

# "Austin, TX" / "West Lafayette, IN" / "London, United Kingdom" / "Remote".
_LOCATION = re.compile(
    r"^(remote|hybrid|[A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3},\s*(?:[A-Z]{2}|[A-Z][a-z]+(?: [A-Z][a-z]+)*))$"
)

_TITLE_WORDS = re.compile(
    r"\b(engineer|developer|intern|internship|manager|analyst|scientist|consultant|designer"
    r"|researcher|research assistant|lead|director|founder|co-founder|assistant|associate"
    r"|architect|specialist|technician|officer|president|coordinator|administrator|programmer"
    r"|instructor|teaching assistant|ta|fellow|apprentice|volunteer|tutor|ambassador|contractor)\b",
    re.IGNORECASE,
)
_COMPANY_WORDS = re.compile(
    r"\b(inc|llc|l\.l\.c|ltd|corp|corporation|company|co|gmbh|plc|university|college|school"
    r"|institute|lab|labs|laboratory|group|partners|technologies|technology|systems|solutions"
    r"|holdings|foundation|hospital|health|bank|capital|ventures|studios?|media|networks?)\b\.?",
    re.IGNORECASE,
)

_DEGREE = re.compile(
    r"\b(Bachelor(?:'?s)?|Master(?:'?s)?|Ph\.?D|Doctor(?:ate)?|Associate(?:'?s)?|MBA|M\.?Eng"
    r"|B\.?S\.?c?|M\.?S\.?c?|B\.?A|M\.?A|B\.?B\.?A|B\.?E|B\.?Tech|M\.?Tech|High School Diploma)\b\.?",
    re.IGNORECASE,
)
_GPA = re.compile(r"GPA[:\s]*([0-9]\.[0-9]+)(?:\s*/\s*([0-9]\.[0-9]+))?", re.IGNORECASE)
_MAJOR_LEAD = re.compile(r"^\s*(?:in|of|,|-|–|—|:)\s*", re.IGNORECASE)


def _find_dates(candidates: list[str]) -> tuple[str, str, bool, str | None]:
    """Return (start, end, is_current, consumed_text) from the first run holding a range.

    Dates come back as `MM/YYYY` -- the format the profile editor validates and
    the extension's `parseDateParts` splits on. A current role reports no end
    date at all rather than the word "Present", which is not a date.
    """
    for text in candidates:
        m = _DATE_RANGE.search(text)
        if m:
            current = is_present(m.group(2))
            start = to_month_year(m.group(1))
            end = "" if current else to_month_year(m.group(2), end=True)
            return start, end, current, text
    # A lone date ("May 2024") is a graduation / one-off date, not a range.
    for text in candidates:
        m = _SINGLE_DATE.search(text)
        if m:
            return to_month_year(m.group(0)), "", False, text
    return "", "", False, None


def _is_location(text: str) -> bool:
    return bool(_LOCATION.match(text.strip()))


def _role_score(text: str) -> int:
    """How strongly a run reads as a job title rather than an employer."""
    return len(_TITLE_WORDS.findall(text)) - len(_COMPANY_WORDS.findall(text))


def _runs(entry, skip: str | None) -> list[str]:
    """Every text run in an entry's header and sub-header lines, in reading order,
    minus the run the date range was taken from."""
    out = []
    for line in [entry.head, *entry.subs]:
        for col in line.columns:
            if col != skip and col.strip():
                out.append(col.strip())
    return out


def experience_from_section(section: Section) -> list[ExperienceEntry]:
    entries: list[ExperienceEntry] = []
    for e in section.entries:
        cols = [c for line in [e.head, *e.subs] for c in line.columns]
        start, end, is_current, used = _find_dates(cols)

        runs = _runs(e, used)
        location = next((r for r in runs if _is_location(r)), "")
        runs = [r for r in runs if r != location]

        entry = ExperienceEntry(
            start_date=start, end_date=end, is_current=is_current, location=location
        )
        if len(runs) >= 2:
            # Templates disagree on whether the employer or the role comes first,
            # so pick the ordering the vocabulary supports instead of assuming one.
            first, second = runs[0], runs[1]
            if _role_score(first) >= _role_score(second):
                entry.title, entry.company = first, second
            else:
                entry.company, entry.title = first, second
            entry.description = "\n".join(f"• {b}" for b in e.bullets)
            extra = runs[2:]
            if extra:
                entry.description = "\n".join([*extra, entry.description]).strip()
        elif runs:
            # Only one run: call it a title if it reads like one, else the employer.
            if _role_score(runs[0]) > 0:
                entry.title = runs[0]
            else:
                entry.company = runs[0]
            entry.description = "\n".join(f"• {b}" for b in e.bullets)
        else:
            entry.description = "\n".join(f"• {b}" for b in e.bullets)

        if entry.company or entry.title:
            entries.append(entry)
    return entries


def education_from_section(section: Section) -> list[EducationEntry]:
    entries: list[EducationEntry] = []
    for e in section.entries:
        entry = EducationEntry(institution=e.head.left.strip())

        detail_lines = [*e.subs]
        blob = " ".join(
            c for line in [e.head, *detail_lines] for c in line.columns
        )

        m = _GPA.search(blob)
        if m:
            entry.gpa = m.group(1)

        # Graduation date: the last date mentioned, since "2024 - 2028" means the
        # degree completes in 2028.
        dates = _SINGLE_DATE.findall(blob) or []
        matches = list(_SINGLE_DATE.finditer(blob))
        if matches:
            grad = matches[-1].group(0).strip().rstrip(".")
            parts = grad.split()
            if len(parts) == 2:
                entry.grad_month, entry.grad_year = parts[0].title(), parts[1]
            else:
                entry.grad_year = parts[0]

        for line in detail_lines:
            for col in line.columns:
                m = _DEGREE.search(col)
                if not m:
                    continue
                # "B.S." loses its final period to \b, so take it back: the
                # abbreviation is what people expect to see in the profile.
                end = m.end() + (1 if col[m.end():m.end() + 1] == "." else 0)
                entry.degree = col[m.start():end].strip()
                rest = col[end:]
                rest = _GPA.sub("", rest)
                rest = _SINGLE_DATE.sub("", rest)
                rest = _MAJOR_LEAD.sub("", rest).strip(" |,-–—")
                if rest:
                    entry.major = rest.strip()
                break
            if entry.degree:
                break

        if not entry.degree and detail_lines:
            # No recognizable degree token; keep the first detail run as the major
            # rather than dropping the only thing the section said about the study.
            first = detail_lines[0].left.strip()
            first = _GPA.sub("", _SINGLE_DATE.sub("", first)).strip(" |,-–—")
            if first:
                entry.major = first

        if entry.institution:
            entries.append(entry)
    return entries


def contact_from_header(header: list[Line], sections: list[Section]) -> ContactInfo:
    """Read identity out of the header block only.

    Scanning the whole document is what let a job's location become the
    candidate's location; the header is the only place these fields legitimately
    live, with the current role's location as an explicit last resort.
    """
    info = ContactInfo()
    blob = "\n".join(l.text for l in header)

    for attr, pattern in (
        ("email", _EMAIL), ("phone", _PHONE),
        ("linkedin_url", _LINKEDIN), ("github_url", _GITHUB),
    ):
        m = pattern.search(blob)
        if m:
            setattr(info, attr, m.group(0).strip())

    m = _WEBSITE.search(blob)
    if m:
        info.website = m.group(0).strip()

    # The name is the largest text on the page, by construction of every résumé
    # template -- far more reliable than "first line that looks like two words".
    named = [l for l in header if l.left.strip() and not _EMAIL.search(l.text)]
    if named:
        name_line = max(named, key=lambda l: l.size)
        parts = [p for p in re.split(r"[\s,|]+", name_line.left.strip()) if p.isalpha() or "-" in p]
        if parts:
            info.first_name = parts[0]
            if len(parts) > 1:
                info.last_name = parts[-1]

    for line in header:
        for col in line.columns:
            for piece in re.split(r"\s*[|•·]\s*", col):
                if _is_location(piece.strip()):
                    info.location = piece.strip()
                    break
            if info.location:
                break
        if info.location:
            break

    if not info.location:
        exp = next((s for s in sections if s.name == "experience"), None)
        if exp:
            current = [x for x in experience_from_section(exp) if x.is_current and x.location]
            if current:
                info.location = current[0].location

    return info
