"""Location filter. Ported from `scan.mjs:buildLocationFilter`.

Evaluation order is `always_allow` -> `block` -> `allow`, and the order is the whole
design:

  - An empty location always passes. Providers vary in whether they populate it, and
    penalizing missing data would silently drop entire boards.
  - `always_allow` beats `block`, which rescues a multi-location posting that names
    your home region: with always_allow ["United States"] and block ["India"], a role
    listed "Remote, US or India" passes while "Remote, India" is still rejected.
  - **`allow: []` makes this a pure blocklist** — anything not explicitly blocked
    passes. This is fail-open and easy to misconfigure; the UI surfaces it explicitly.
"""
from __future__ import annotations

from typing import Any, Callable, Optional


def normalize_keyword_list(value: Any) -> list[str]:
    if value is None:
        return []
    items = value if isinstance(value, (list, tuple)) else [value]
    out = []
    for item in items:
        if not isinstance(item, str):
            continue
        cleaned = item.strip().lower()
        if cleaned:
            out.append(cleaned)
    return out


def build_location_filter(config: Optional[dict]) -> Callable[[str], bool]:
    if not config:
        return lambda location: True

    always_allow = normalize_keyword_list(config.get("always_allow"))
    allow = normalize_keyword_list(config.get("allow"))
    block = normalize_keyword_list(config.get("block"))

    def matches(location: str) -> bool:
        if not isinstance(location, str) or not location.strip():
            return True
        lower = location.lower()
        if always_allow and any(k in lower for k in always_allow):
            return True
        if block and any(k in lower for k in block):
            return False
        if not allow:
            return True
        return any(k in lower for k in allow)

    return matches
