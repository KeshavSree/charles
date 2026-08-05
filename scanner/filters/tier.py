"""Seniority-tier classifier. Ported from `classify-tier.mjs`.

Weighted regex matching, highest weight wins — so "Senior Engineering Intern" reads
senior rather than intern.

**Unmatched titles fall back to 'mid'.** A plain "Software Engineer" carries no level
indicator and lands in mid. Since `seniority_tiers` is inclusive, leaving mid unselected
therefore excludes most ordinary listings, not just explicitly mid-level ones. The UI
warns about this.
"""
from __future__ import annotations

import re

# Acronym normalization, so "A.I." can't be read as a roman numeral I (entry level)
# and "I.T." can't either.
_PREPROCESS = [
    (re.compile(r"\bA\.I\.", re.I), "AI"),
    (re.compile(r"\bA\.I\b", re.I), "AI"),
    (re.compile(r"\bA\.\s+I\b", re.I), "AI"),
    (re.compile(r"\bI\.T\.", re.I), "IT"),
    (re.compile(r"\bI\.T\b", re.I), "IT"),
    (re.compile(r"\bI\.\s+T\b", re.I), "IT"),
    (re.compile(r"\bi/o\b", re.I), "IO"),
]

_MATCHERS: list[tuple[re.Pattern, str, int]] = [
    # Senior (weight 4)
    (re.compile(r"\bchief\b", re.I), "senior", 4),
    (re.compile(r"\bvp\b", re.I), "senior", 4),
    (re.compile(r"\bvice\s+president\b", re.I), "senior", 4),
    (re.compile(r"\bdirector\b", re.I), "senior", 4),
    (re.compile(r"\bprincipal\b", re.I), "senior", 4),
    (re.compile(r"\bstaff\b", re.I), "senior", 4),
    (re.compile(r"\blead\b", re.I), "senior", 4),
    (re.compile(r"\bsenior\b", re.I), "senior", 4),
    (re.compile(r"\bsr\b", re.I), "senior", 4),
    (re.compile(r"\bsr\.", re.I), "senior", 4),
    (re.compile(r"\bhead\s+of\b", re.I), "senior", 4),
    (re.compile(r"\b[a-z]{2,}[\s-](iii|iv|v)\b", re.I), "senior", 4),
    # Mid (weight 3)
    (re.compile(r"\bmid-level\b", re.I), "mid", 3),
    (re.compile(r"\bmid\b", re.I), "mid", 3),
    (re.compile(r"\b[a-z]{2,}[\s-](ii)\b", re.I), "mid", 3),
    (re.compile(r"\b(l4|l5)\b", re.I), "mid", 3),
    # Entry (weight 2)
    (re.compile(r"\bentry-level\b", re.I), "entry", 2),
    (re.compile(r"\bentry\b", re.I), "entry", 2),
    (re.compile(r"\bassociate\b", re.I), "entry", 2),
    (re.compile(r"\bjunior\b", re.I), "entry", 2),
    (re.compile(r"\b[a-z]{2,}[\s-](i)\b", re.I), "entry", 2),
    (re.compile(r"\b(l1|l2)\b", re.I), "entry", 2),
    # Intern (weight 1)
    (re.compile(r"\binternship\b", re.I), "intern", 1),
    (re.compile(r"\bintern\b", re.I), "intern", 1),
    (re.compile(r"\btrainee\b", re.I), "intern", 1),
    (re.compile(r"\bco-op\b", re.I), "intern", 1),
    (re.compile(r"\bcoop\b", re.I), "intern", 1),
    (re.compile(r"\bnew\s+grad\b", re.I), "entry", 2),
    (re.compile(r"\bgraduate\b", re.I), "entry", 2),
]

TIERS = ("intern", "entry", "mid", "senior")


def classify_tier(title: str) -> str:
    if not isinstance(title, str):
        return "mid"
    clean = title
    for pattern, replacement in _PREPROCESS:
        clean = pattern.sub(replacement, clean)

    best_tier = "mid"
    best_weight = 0
    for pattern, tier, weight in _MATCHERS:
        if weight > best_weight and pattern.search(clean):
            best_tier = tier
            best_weight = weight
    return best_tier
