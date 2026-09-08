"""The résumé parsing entry point.

Prefers the layout-aware path (geometry + font tiers straight from the PDF) and
falls back to the flat-text parsers when there is no file to read -- seeded or
programmatically created résumés that only ever had section text.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .contact import ContactInfo, extract_contact
from .education import EducationEntry, extract_education
from .entries import contact_from_header, education_from_section, experience_from_section
from .experience import ExperienceEntry, extract_experience
from .layout import extract_lines
from .structure import Section, parse_document


@dataclass
class ParsedResume:
    contact: ContactInfo = field(default_factory=ContactInfo)
    experience: list[ExperienceEntry] = field(default_factory=list)
    education: list[EducationEntry] = field(default_factory=list)
    sections: dict[str, str] = field(default_factory=dict)


def parse_pdf(file_path: str) -> ParsedResume:
    lines = extract_lines(file_path)
    header, sections = parse_document(lines)

    by_name: dict[str, Section] = {}
    for s in sections:
        # A résumé occasionally splits one logical section across two headings
        # (a page break, or "Experience" then "Additional Experience").
        if s.name in by_name:
            by_name[s.name].lines.extend(s.lines)
            by_name[s.name].entries.extend(s.entries)
        else:
            by_name[s.name] = s

    exp = by_name.get("experience")
    edu = by_name.get("education")
    return ParsedResume(
        contact=contact_from_header(header, sections),
        experience=experience_from_section(exp) if exp else [],
        education=education_from_section(edu) if edu else [],
        sections={
            "contact": "\n".join(l.text for l in header),
            **{name: s.text for name, s in by_name.items() if s.text.strip()},
        },
    )


def parse_text(sections: dict[str, str], full_text: str) -> ParsedResume:
    """Fallback for résumés with no PDF on disk: the original flat-text parsers."""
    return ParsedResume(
        contact=extract_contact(full_text, sections.get("contact", "")),
        experience=extract_experience(sections.get("experience", "")),
        education=extract_education(sections.get("education", "")),
        sections=sections,
    )
