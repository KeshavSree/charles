"""Content filter — matches on the job DESCRIPTION body.

Separates same-titled roles with different stacks: a "Software Engineer" posting that
mentions PHP versus one that mentions Rust.

An empty description always passes. The scanner only sees descriptions a provider
already returns in its list payload (fetching each posting individually would be
enormously more expensive), so providers without one must never be silently dropped.
"""
from __future__ import annotations

from typing import Callable, Optional

from scanner.filters.keywords import normalize_keyword_list


def build_content_filter(config: Optional[dict]) -> Callable[[str, list[str]], bool]:
    """Returns (description, matched_title_keywords) -> bool.

    Global rules: any `negative` rejects; empty `positive` passes; otherwise at least
    one `positive` must appear.

    `by_title_keyword` scopes a stricter pair to only the jobs whose title matched a
    specific `title_filter.positive` keyword — so an "AI Engineer" match can be
    required to name a concrete AI tool without that requirement leaking onto
    unrelated categories. When any matched keyword has an override, the overrides
    govern (any one passing is enough) and the global pair is skipped entirely.
    """
    if not config:
        return lambda description, matched=(): True

    positive = normalize_keyword_list(config.get("positive"))
    negative = normalize_keyword_list(config.get("negative"))

    by_keyword: dict[str, dict[str, list[str]]] = {}
    raw_overrides = config.get("by_title_keyword")
    if isinstance(raw_overrides, dict):
        for keyword, rule in raw_overrides.items():
            if not isinstance(keyword, str) or not keyword.strip():
                continue
            rule = rule if isinstance(rule, dict) else {}
            by_keyword[keyword.strip().lower()] = {
                "positive": normalize_keyword_list(rule.get("positive")),
                "negative": normalize_keyword_list(rule.get("negative")),
            }

    def matches(description: str, matched_keywords: list[str] = ()) -> bool:
        if not isinstance(description, str) or not description.strip():
            return True
        lower = description.lower()

        overrides = [
            by_keyword[k.strip().lower()]
            for k in (matched_keywords or ())
            if isinstance(k, str) and k.strip().lower() in by_keyword
        ]
        if overrides:
            for rule in overrides:
                if rule["negative"] and any(k in lower for k in rule["negative"]):
                    continue
                if not rule["positive"] or any(k in lower for k in rule["positive"]):
                    return True
            return False

        if negative and any(k in lower for k in negative):
            return False
        if not positive:
            return True
        return any(k in lower for k in positive)

    return matches
