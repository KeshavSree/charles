"""Location filter. Ported from `scan.mjs:buildLocationFilter`.

Evaluation order is `always_allow` -> `block` -> `allow`, and the order is the whole
design:

  - An unknown location always passes. Providers vary in whether they populate it, and
    penalizing missing data would silently drop entire boards.
  - `always_allow` beats `block`, which rescues a multi-location posting that names
    your home region: with always_allow ["United States"] and block ["India"], a role
    listed "Remote, US or India" passes while "Remote, India" is still rejected.
  - **`allow: []` makes this a pure blocklist** — anything not explicitly blocked
    passes. This is fail-open and easy to misconfigure; the UI surfaces it explicitly.

Keywords are matched by the shared rule in `keywords.py`, so a two-letter state code
is a whole word. Substring-matching them is how "CA" came to match "Lo·ca·tions",
"Toronto, ON, CAN" and "Viana do Ca·stelo, Portugal".
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

from scanner.filters.keywords import compile_keyword, normalize_keyword_list

# Workday renders a posting open in several offices as "2 Locations" / "66 Locations"
# instead of naming any of them. That is a placeholder standing in for absent data,
# not a place, so it is treated as unknown and passes -- the same way a blank location
# does, and for the same reason: the alternative silently drops most of a large board.
_UNSPECIFIED_RE = re.compile(r"^\d+\s+locations?$", re.IGNORECASE)


def is_unspecified(location: str) -> bool:
    """True when the provider gave a placeholder rather than an actual location."""
    if not isinstance(location, str) or not location.strip():
        return True
    return bool(_UNSPECIFIED_RE.match(location.strip()))


def build_location_filter(config: Optional[dict]) -> Callable[[str], bool]:
    if not config:
        return lambda location: True

    always_allow = [compile_keyword(k) for k in normalize_keyword_list(config.get("always_allow"))]
    allow = [compile_keyword(k) for k in normalize_keyword_list(config.get("allow"))]
    block = [compile_keyword(k) for k in normalize_keyword_list(config.get("block"))]

    def matches(location: str) -> bool:
        if is_unspecified(location):
            return True
        lower = location.lower()
        if always_allow and any(m(lower) for m in always_allow):
            return True
        if block and any(m(lower) for m in block):
            return False
        if not allow:
            return True
        return any(m(lower) for m in allow)

    return matches
