"""Title filter. Ported from `scan.mjs:buildTitleFilter` + `compileKeyword`.

The acronym rule is the subtle part: a 2-3 character all-letter keyword compiles to a
word-boundary regex, so "COO" stops matching "Coordinator" and "SDR" stops matching
mid-word. Longer keywords and anything containing non-letters (".NET", "L&D", "SAP ")
keep permissive substring matching, which is both faster and what users expect.
"""
from __future__ import annotations

import re
from typing import Any, Callable, Optional

_ACRONYM_RE = re.compile(r"^[a-z]{2,3}$")


def compile_keyword(keyword: str) -> Callable[[str], bool]:
    if _ACRONYM_RE.match(keyword):
        pattern = re.compile(rf"\b{re.escape(keyword)}\b")
        return lambda lower: bool(pattern.search(lower))
    return lambda lower: keyword in lower


def _normalize(values: Any) -> list[str]:
    """Tolerate a bare string, None, and non-string entries. A surviving empty string
    would match every title via `in`, silently bypassing the filter, so it is dropped."""
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


def build_title_filter(config: Optional[dict]) -> Callable[[str], bool]:
    """`positive` is OR-matched (empty means everything passes); any `negative` match
    rejects.

    Note `seniority_boost`, if present in config, is deliberately ignored here — it is
    a ranking signal only and does not filter. This is a frequent misreading and the
    reason keyword-matching-but-irrelevant roles survive the pipeline.
    """
    config = config or {}
    positive = [compile_keyword(k) for k in _normalize(config.get("positive"))]
    negative = [compile_keyword(k) for k in _normalize(config.get("negative"))]

    def matches(title: str) -> bool:
        lower = (title or "").lower()
        has_positive = not positive or any(m(lower) for m in positive)
        has_negative = any(m(lower) for m in negative)
        return has_positive and not has_negative

    return matches


def matched_title_keywords(title: str, config: Optional[dict]) -> list[str]:
    """Which `positive` keywords a title matched, in their original spelling.

    Used to scope `content_filter.by_title_keyword` overrides to the categories that
    opted into a stricter content check.
    """
    raw = (config or {}).get("positive")
    raw = raw if isinstance(raw, list) else []
    lower = (title or "").lower()
    out = []
    for keyword in raw:
        if not isinstance(keyword, str) or not keyword.strip():
            continue
        if compile_keyword(keyword.strip().lower())(lower):
            out.append(keyword)
    return out
