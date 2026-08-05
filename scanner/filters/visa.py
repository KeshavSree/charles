"""Work-authorization / sponsorship filter, matched against the description body.

Two very different modes, and picking the wrong one is the usual mistake:

  - `require_mention: false` (default) only weeds out postings that *explicitly*
    refuse sponsorship. Everything unstated — including descriptionless postings —
    passes. This is what most users want.
  - `require_mention: true` keeps only postings that actively advertise sponsorship
    and rejects anything without a description. Far more aggressive; on the ~50 of 63
    providers that ship no description, it rejects everything.
"""
from __future__ import annotations

from typing import Callable, Optional

from scanner.filters.location import normalize_keyword_list

DEFAULT_VISA_POSITIVE = [
    "visa sponsorship", "sponsor a visa", "sponsor visas", "will sponsor",
    "sponsorship available", "sponsorship is available", "eligible for sponsorship",
    "provide sponsorship", "offer sponsorship", "immigration support",
    "h-1b", "h1b", "h-1b1", "h1b1", "o-1 visa",
]

DEFAULT_VISA_NEGATIVE = [
    "no visa sponsorship", "no sponsorship", "without sponsorship",
    "unable to sponsor", "not able to sponsor", "cannot sponsor", "do not sponsor",
    "does not sponsor", "not offer sponsorship", "not provide sponsorship",
    "sponsorship is not available", "sponsorship not available",
    "not offer visa sponsorship",
]


def build_visa_filter(config: Optional[dict]) -> Callable[[str], bool]:
    if not config or config.get("enabled") is False:
        return lambda description: True

    positive = (
        normalize_keyword_list(config.get("positive"))
        if config.get("positive") is not None
        else list(DEFAULT_VISA_POSITIVE)
    )
    negative = (
        normalize_keyword_list(config.get("negative"))
        if config.get("negative") is not None
        else list(DEFAULT_VISA_NEGATIVE)
    )
    require_mention = config.get("require_mention") is True

    def matches(description: str) -> bool:
        has_text = isinstance(description, str) and description.strip()
        if not has_text:
            return not require_mention
        lower = description.lower()
        if negative and any(k in lower for k in negative):
            return False
        if not require_mention:
            return True
        if not positive:
            return True
        return any(k in lower for k in positive)

    return matches
