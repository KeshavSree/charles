"""JD-content fingerprinting. Ported from `fingerprint-core.mjs`.

Catches a pairing that URL and company+role dedup both miss: the same job entering the
pipeline twice, once as a direct company listing and once as an agency re-post with
the employer name stripped. Agencies rarely rewrite the requirements text, so a
content fingerprint of the body catches it.

64-bit SimHash over 3-token shingles. Near-duplicate texts land within a few bits of
each other, so one 16-hex-char column per row is enough to compare any pair later
without storing the body.

Coverage is deliberately partial: only providers whose list API already ships a
description produce a fingerprint. No body, no signal, no false positives.
"""
from __future__ import annotations

import hashlib
import re
from typing import Iterable, Optional

# Below this length a description is mostly boilerplate and carries too little signal
# to distinguish a real match from a generic "About us" section.
FINGERPRINT_MIN_TEXT = 200

# 0.92 means at most 5 of 64 bits differ — near-verbatim bodies only.
CROSSLIST_THRESHOLD = 0.92
CROSSLIST_WINDOW_DAYS = 90

_TAG_RE = re.compile(r"<[^>]*>")
_ENTITY_RE = re.compile(r"&[a-z#0-9]+;", re.I)
_URL_RE = re.compile(r"https?://\S+")
_NON_ALNUM_RE = re.compile(r"[^\w]+", re.UNICODE)


def normalize_jd_text(text: object) -> str:
    lowered = str(text or "").lower()
    lowered = _TAG_RE.sub(" ", lowered)
    lowered = _ENTITY_RE.sub(" ", lowered)
    lowered = _URL_RE.sub(" ", lowered)
    lowered = _NON_ALNUM_RE.sub(" ", lowered)
    return re.sub(r"\s{2,}", " ", lowered).strip()


def fingerprint_text(text: object) -> str:
    """16 hex chars, or '' when the body is too short to fingerprint."""
    normalized = normalize_jd_text(text)
    if len(normalized) < FINGERPRINT_MIN_TEXT:
        return ""
    tokens = normalized.split(" ")
    # Length alone can pass on very few tokens (an unspaced CJK body normalizes to one
    # giant token). No shingle would ever be hashed, leaving an all-zero hash that
    # scores 1.0 against every other degenerate body — treat it as unfingerprintable.
    if len(tokens) < 3:
        return ""

    weights = [0] * 64
    for i in range(len(tokens) - 2):
        shingle = f"{tokens[i]} {tokens[i + 1]} {tokens[i + 2]}"
        digest = hashlib.sha1(shingle.encode("utf-8")).digest()
        for bit in range(64):
            byte = digest[bit >> 3]
            weights[bit] += 1 if (byte >> (7 - (bit & 7))) & 1 else -1

    value = 0
    for bit in range(64):
        if weights[bit] > 0:
            value |= 1 << (63 - bit)
    return f"{value:016x}"


_HEX16_RE = re.compile(r"^[0-9a-f]{16}$")


def similarity(a: str, b: str) -> float:
    """1 - hamming/64. Empty or malformed fingerprints never match."""
    if not _HEX16_RE.match(a or "") or not _HEX16_RE.match(b or ""):
        return 0.0
    distance = bin(int(a, 16) ^ int(b, 16)).count("1")
    return 1 - distance / 64


def _company_key(name: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def find_cross_listings(
    postings: Iterable,
    history_rows: Iterable,
    threshold: float = CROSSLIST_THRESHOLD,
) -> list[dict]:
    """Postings whose fingerprint nearly matches a recent row from a DIFFERENT company.

    Same-company matches are re-posts, not cross-listings, and are skipped.
    """
    recent = [r for r in history_rows if getattr(r, "fingerprint", None)]
    matches = []
    for posting in postings:
        fingerprint = getattr(posting, "fingerprint", "")
        if not fingerprint:
            continue
        key = _company_key(getattr(posting, "company", ""))
        for row in recent:
            if _company_key(getattr(row, "company", "")) == key:
                continue
            if getattr(row, "url", None) == getattr(posting, "url", None):
                continue
            score = similarity(fingerprint, row.fingerprint)
            if score >= threshold:
                matches.append({"posting": posting, "row": row, "score": score})
    return sorted(matches, key=lambda m: m["score"], reverse=True)
