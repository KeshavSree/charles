from __future__ import annotations

import re
from dataclasses import dataclass

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[a-z]{2,}", re.IGNORECASE)
_PHONE = re.compile(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}")
_LINKEDIN = re.compile(r"https?://(?:www\.)?linkedin\.com/in/[\w\-]+", re.IGNORECASE)
_LOCATION = re.compile(r"[A-Z][a-z]+(?: [A-Z][a-z]+)?,\s+[A-Z]{2}\b")


@dataclass
class ContactInfo:
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""
    linkedin_url: str = ""
    location: str = ""


def extract_contact(full_text: str, contact_section: str = "") -> ContactInfo:
    search = contact_section if contact_section else full_text
    info = ContactInfo()

    m = _EMAIL.search(search)
    if m:
        info.email = m.group(0)

    m = _PHONE.search(search)
    if m:
        info.phone = m.group(0).strip()

    m = _LINKEDIN.search(search)
    if m:
        info.linkedin_url = m.group(0)

    m = _LOCATION.search(search)
    if m:
        info.location = m.group(0)

    for line in full_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _EMAIL.search(stripped) or _PHONE.search(stripped) or _LINKEDIN.search(stripped):
            continue
        parts = stripped.split()
        if (
            len(parts) >= 2
            and all(p[0].isupper() for p in parts[:2] if p)
            and all(c.isalpha() or c in "-'" for c in parts[0])
        ):
            info.first_name = parts[0]
            info.last_name = parts[-1]
            break

    return info
