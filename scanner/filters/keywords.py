"""How a configured keyword is matched against text.

Shared by the title and location filters. It lives here rather than in either of
them because the two drifting apart is a real bug that shipped: `title.py` had
the acronym rule and `location.py` did not, so an allow list of ["CA", "NC"] let
through every Workday posting labelled "2 Lo-ca-tions", plus Canada, Portugal
and "Annapolis Ju-nc-tion".
"""
from __future__ import annotations

import re
from typing import Any, Callable

# A short all-letter keyword is an acronym -- a state code, "COO", "SDR", "ML".
# Matching those as substrings is almost never what the user meant, because two
# letters occur inside ordinary words constantly. Longer keywords and anything
# with non-letters (".NET", "L&D", "SAP ") keep permissive substring matching,
# which is both faster and what users expect.
_ACRONYM_RE = re.compile(r"^[a-z]{2,3}$")


def compile_keyword(keyword: str) -> Callable[[str], bool]:
    if _ACRONYM_RE.match(keyword):
        pattern = re.compile(rf"\b{re.escape(keyword)}\b")
        return lambda lower: bool(pattern.search(lower))
    return lambda lower: keyword in lower


def normalize_keyword_list(values: Any) -> list[str]:
    """Tolerate a bare string, None, and non-string entries.

    A surviving empty string would match everything via `in`, silently bypassing
    the filter, so it is dropped.
    """
    if values is None:
        return []
    items = values if isinstance(values, (list, tuple)) else [values]
    out = []
    for item in items:
        if not isinstance(item, str):
            continue
        cleaned = item.strip().lower()
        if cleaned:
            out.append(cleaned)
    return out
