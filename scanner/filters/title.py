"""Title filter. Ported from `scan.mjs:buildTitleFilter` + `compileKeyword`.

Keyword matching semantics -- including the acronym rule that stops "COO" from
matching "Coordinator" -- live in `keywords.py`, shared with the location filter.
"""
from __future__ import annotations

from typing import Callable, Optional

from scanner.filters.keywords import compile_keyword, normalize_keyword_list as _normalize


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
