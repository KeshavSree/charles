"""Deduplication keys. Ported from the dedup section of `scan.mjs`.

Three independent identities:
  - `normalize_url_for_dedup` — the same posting reached via a tracked link.
  - `normalize_role_for_dedup` + `company_role_dedup_key` — the same role opened once
    per city at different URLs.
  - `build_company_canonicalizer` — the same employer under two names.
"""
from __future__ import annotations

import re
from typing import Callable, Iterable, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# Query params carrying no identity information for a posting — safe to strip.
#
# Deliberately an allowlist rather than "strip everything": several ATSes key the
# posting off a query param (Greenhouse's `gh_jid`), so a blanket strip would collapse
# genuinely distinct roles into one row.
_STRIP_PARAMS = {
    "language", "lang", "locale",
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "ref", "src", "source", "gh_src", "lever-origin", "lever-source",
}


def normalize_url_for_dedup(url: str) -> str:
    """Stable comparison key for a posting URL.

    Strips cosmetic params, drops the fragment and any trailing slash, lowercases
    scheme and host. Only the *comparison* key is normalized — callers keep storing
    the original URL so links stay clickable. Malformed URLs fall back to the raw
    string rather than raising.
    """
    if not isinstance(url, str) or not url:
        return url or ""
    try:
        parts = urlsplit(url)
        if not parts.scheme or not parts.netloc:
            return url
        query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                 if k.lower() not in _STRIP_PARAMS]
        path = re.sub(r"/+$", "", parts.path) or "/"
        return urlunsplit((
            parts.scheme.lower(),
            parts.netloc.lower(),
            path,
            urlencode(query),
            "",
        ))
    except (ValueError, UnicodeError):
        return url


# Trailing role-title tags that are purely locational and safe to strip for dedup.
# Seniority, discipline, team and product qualifiers are deliberately absent — those
# distinguish genuinely different roles and must not collapse.
_ROLE_LOCATION_SUFFIXES = {
    "amer", "americas", "amsterdam", "apac", "austin", "barcelona", "bay area",
    "belgium", "berlin", "boston", "brussels", "budapest", "canada", "chicago",
    "copenhagen", "dublin", "emea", "eu", "europe", "finland", "france", "frankfurt",
    "germany", "hamburg", "helsinki", "india", "ireland", "italy", "la",
    "latin america", "lisbon", "london", "los angeles", "madrid", "melbourne",
    "milan", "montreal", "munich", "netherlands", "new york", "north america", "nyc",
    "on site", "onsite", "oslo", "paris", "poland", "porto", "prague", "remote",
    "rome", "san francisco", "seattle", "sf", "singapore", "spain", "stockholm",
    "sydney", "tokyo", "toronto", "uk", "united kingdom", "united states", "us",
    "usa", "vancouver", "vienna", "warsaw", "zurich",
}

_ROLE_REMOTE_SUFFIXES = {
    "distributed", "hybrid", "on site", "onsite", "remote", "wfh", "work from home",
}

_SUFFIX_RE = re.compile(r"\s*[\[(]([^\[\]()]+)[\])]\s*$")


def _normalize_suffix_tag(tag: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(tag or "").lower()).strip())


def _is_role_location_suffix(tag: str) -> bool:
    normalized = _normalize_suffix_tag(tag)
    if not normalized:
        return False
    if normalized in _ROLE_LOCATION_SUFFIXES:
        return True

    # "Berlin, London" / "EMEA or APAC" — a list of locations is still just a location.
    parts = [
        _normalize_suffix_tag(p)
        for p in re.split(r"[,/|;]+|\s+(?:and|or)\s+", str(tag or "").lower())
    ]
    parts = [p for p in parts if p]
    if len(parts) > 1 and all(p in _ROLE_LOCATION_SUFFIXES for p in parts):
        return True

    # "Remote — Berlin"
    for remote in _ROLE_REMOTE_SUFFIXES:
        prefix = f"{remote} "
        if normalized.startswith(prefix) and normalized[len(prefix):] in _ROLE_LOCATION_SUFFIXES:
            return True
    return False


def normalize_role_for_dedup(role: str) -> str:
    """Collapse per-location variants of one role onto a single key.

    "Software Engineer (Berlin)" and "Software Engineer (NYC)" collapse; "Senior
    Software Engineer" and "Software Engineer" stay distinct.
    """
    title = str(role or "").lower()
    while True:
        match = _SUFFIX_RE.search(title)
        if not match or not _is_role_location_suffix(match.group(1)):
            break
        title = title[: match.start()].rstrip()
    return re.sub(r"[^a-z0-9]+", " ", title).strip()


def default_company_normalizer(name: object) -> str:
    return str(name or "").strip().lower()


def build_company_canonicalizer(
    aliases: Optional[dict[str, Iterable[str]]],
) -> Callable[[object], str]:
    """Map alias company names onto one canonical key.

    Closes the gap where an ATS org name differs from the brand ("Intercom" vs "Fin"),
    which otherwise defeats the company+role dedup key every single run.

    Two safety rules: a canonical name always owns its own identity regardless of dict
    ordering, and an alias claimed by two different canonicals fails open to its raw
    label. Failing open may let a duplicate through; failing closed would silently
    merge two unrelated companies, which is worse.
    """
    mapping: dict[str, str] = {}
    if isinstance(aliases, dict):
        canonical_keys = set()
        for canonical in aliases:
            key = default_company_normalizer(canonical)
            if not key:
                continue
            mapping[key] = key
            canonical_keys.add(key)

        alias_targets: dict[str, set[str]] = {}
        for canonical, alias_list in aliases.items():
            key = default_company_normalizer(canonical)
            if not key:
                continue
            items = alias_list if isinstance(alias_list, (list, tuple, set)) else [alias_list]
            for raw in items:
                alias = default_company_normalizer(raw)
                if not alias or alias in canonical_keys:
                    continue
                alias_targets.setdefault(alias, set()).add(key)

        for alias, targets in alias_targets.items():
            if len(targets) == 1:
                mapping[alias] = next(iter(targets))

    def canonicalize(name: object) -> str:
        key = default_company_normalizer(name)
        return mapping.get(key, key)

    return canonicalize


def company_role_dedup_key(
    company: object,
    role: object,
    canonicalize: Callable[[object], str] = default_company_normalizer,
) -> str:
    return f"{canonicalize(company)}::{normalize_role_for_dedup(str(role or ''))}"


def normalize_company(name: object) -> str:
    """Aggressive company key for blacklist lookups — lowercase alphanumerics only,
    so a blocked "Acme Corp." still catches a feed saying "acme corp"."""
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())
