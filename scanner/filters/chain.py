"""The ordered ingest filter chain — the single place that decides what enters the DB.

Two profiles:

  - **tracked** — the full stage list, including the description-based content and visa
    filters and the salary filter.
  - **reverse** — the shorter chain, for sources whose feeds carry no description or
    salary data, so those stages would pass by construction anyway.

The freshness gate is *not* one of the differences. Every source is bounded by the same
age window, so "how old can a posting be" has a single answer regardless of origin.

Every drop increments a named counter. Those counters are the only way to see which
stage is doing the work, which is what makes the filters tunable rather than magic.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from scanner.dedup import normalize_company
from scanner.filters.content import build_content_filter
from scanner.filters.dates import build_posted_date_filter, classify_posting_date
from scanner.filters.location import build_location_filter
from scanner.filters.salary import build_salary_filter
from scanner.filters.tier import classify_tier
from scanner.filters.title import build_title_filter, matched_title_keywords
from scanner.filters.visa import build_visa_filter
from scanner.trust import build_trust_validator
from scanner.types import Posting

# Every counter the UI funnel renders, in pipeline order.
COUNTER_FIELDS = (
    "found",
    "filtered_blacklist",
    "filtered_title",
    "filtered_tier",
    "filtered_location",
    "filtered_posted_date",
    "filtered_salary",
    "filtered_content",
    "filtered_visa",
    "dropped_stale",
    "dropped_no_date",
    "dupes",
)


# Distinct keys retained per stage before new ones stop being recorded.
MAX_DROP_KEYS = 300


def _month_of(posted_at) -> str:
    if not isinstance(posted_at, int):
        return "(no date)"
    from datetime import datetime, timezone

    return datetime.fromtimestamp(posted_at / 1000, tz=timezone.utc).strftime("%Y-%m")


def _salary_of(posting: Posting) -> str:
    salary = posting.salary
    if salary is None:
        return "(no salary)"
    lo = f"{int(salary.min):,}" if salary.min else ""
    hi = f"{int(salary.max):,}" if salary.max else ""
    return f"{lo or '?'}–{hi or '?'} {salary.currency}".strip()


# Each stage groups by the thing it actually filtered on, so the breakdown answers
# "why" rather than just restating the title. A location rejection is only informative
# grouped by location; a level rejection only by level.
_DROP_KEY = {
    "blacklist": lambda p: p.company or "(unknown)",
    "title": lambda p: p.title or "(untitled)",
    "tier": lambda p: p.tier,
    "location": lambda p: p.location or "(no location)",
    "salary": _salary_of,
    "posted_date": lambda p: _month_of(p.posted_at),
    "stale": lambda p: _month_of(p.posted_at),
    "no_date": lambda p: p.company or "(unknown)",
    # Content and visa filter on the description body, which is far too long to group
    # by, so the title is the most useful stand-in.
    "content": lambda p: p.title or "(untitled)",
    "visa": lambda p: p.title or "(untitled)",
}

# What each stage is grouped by, shown in the UI so the list is not ambiguous.
DROP_GROUPING = {
    "blacklist": "company",
    "title": "title",
    "tier": "level",
    "location": "location",
    "salary": "salary",
    "posted_date": "month posted",
    "stale": "month posted",
    "no_date": "company",
    "content": "title",
    "visa": "title",
}


@dataclass
class Counters:
    found: int = 0
    filtered_blacklist: int = 0
    filtered_title: int = 0
    filtered_tier: int = 0
    filtered_location: int = 0
    filtered_posted_date: int = 0
    filtered_salary: int = 0
    filtered_content: int = 0
    filtered_visa: int = 0
    dropped_stale: int = 0
    dropped_no_date: int = 0
    dupes: int = 0
    kept: int = 0
    # stage -> {group key: how many were dropped there}. The key differs per stage:
    # see _DROP_KEY. Aggregated rather than listed per posting, because a feed dropping
    # 72 roles is usually dropping the same handful of values over and over.
    drops: dict[str, dict[str, int]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, int]:
        return {name: getattr(self, name) for name in (*COUNTER_FIELDS, "kept")}

    def drops_as_lists(self, limit: int = 40) -> dict[str, dict]:
        """Per stage, the most common dropped values first, with what they group by."""
        out = {}
        for stage, keys in self.drops.items():
            ranked = sorted(keys.items(), key=lambda kv: (-kv[1], kv[0]))
            out[stage] = {
                "by": DROP_GROUPING.get(stage, "title"),
                "items": [{"label": k, "count": n} for k, n in ranked[:limit]],
            }
        return out


class FilterChain:
    """Compiled ingest filters, built once per run from a ScanConfig dict."""

    def __init__(
        self,
        config: dict,
        *,
        profile: str = "tracked",
        cutoff_ms: Optional[int] = None,
        include_undated: bool = False,
        collect_samples: bool = True,
        sample_limit: int = 8,
    ) -> None:
        self.config = config or {}
        self.profile = profile
        self.cutoff_ms = cutoff_ms
        self.include_undated = include_undated
        self.collect_samples = collect_samples
        self.sample_limit = sample_limit

        self.title_config = self.config.get("title_filter") or {}
        self._title = build_title_filter(self.title_config)
        self._location = build_location_filter(self.config.get("location_filter"))
        self._content = build_content_filter(self.config.get("content_filter"))
        self._visa = build_visa_filter(self.config.get("visa_filter"))
        self._salary = build_salary_filter(self.config.get("salary_filter"))
        self._posted_date = build_posted_date_filter(
            self.config.get("posted_after"), self.config.get("posted_before")
        )
        self._trust = build_trust_validator(self.config.get("trust_filter"))

        # Inclusive: a posting is kept only when its tier is selected. An empty
        # selection disables the stage entirely rather than rejecting everything,
        # which matches how every other filter here treats an empty config.
        tiers = self.config.get("seniority_tiers") or []
        self._seniority_tiers = {str(t).lower() for t in tiers if isinstance(t, str)}

        blocked = self.config.get("blocked_companies") or []
        self._blocked = {normalize_company(c) for c in blocked if str(c or "").strip()}

    def _sample(self, counters: Counters, stage: str, posting: Posting) -> None:
        """Record why a posting was dropped, grouped by whatever that stage filtered on.

        Bounded by MAX_DROP_KEYS distinct keys per stage: a directory sweep can drop six
        figures of postings, and an unbounded dict would be a memory leak. Once the cap
        is hit, already-seen keys keep counting and new ones are ignored, so the common
        cases (the ones worth showing) stay accurate.
        """
        if not self.collect_samples or stage == "kept":
            return
        key_of = _DROP_KEY.get(stage)
        if key_of is None:
            return
        bucket = counters.drops.setdefault(stage, {})
        key = str(key_of(posting) or "(unknown)").strip() or "(unknown)"
        if key in bucket:
            bucket[key] += 1
        elif len(bucket) < MAX_DROP_KEYS:
            bucket[key] = 1

    def apply(self, posting: Posting, counters: Counters) -> bool:
        """Run one posting through the chain. Mutates `posting` with tier and trust
        annotations regardless of outcome, so a preview can show why it was dropped."""
        counters.found += 1

        # Stage 0 — trust enrichment. Scores, never drops.
        score, flags, _level = self._trust(posting)
        posting.trust_score = score
        posting.trust_flags = flags
        posting.tier = classify_tier(posting.title)

        # Freshness gate. Runs for every source, not just sweeps: one age window means
        # "how old can a posting be" has a single answer regardless of origin.
        if self.cutoff_ms is not None:
            date_class = classify_posting_date(posting.posted_at, self.cutoff_ms)
            if date_class == "stale":
                counters.dropped_stale += 1
                self._sample(counters, "stale", posting)
                return False
            if date_class == "undated" and not self.include_undated:
                counters.dropped_no_date += 1
                self._sample(counters, "no_date", posting)
                return False

        # Stage 1 — blocked companies. The user's own decision, checked before any
        # per-posting signal.
        if self._blocked and normalize_company(posting.company) in self._blocked:
            counters.filtered_blacklist += 1
            self._sample(counters, "blacklist", posting)
            return False

        # Stage 2 — title.
        if not self._title(posting.title):
            counters.filtered_title += 1
            self._sample(counters, "title", posting)
            return False

        # Stage 3 — tier.
        if self._seniority_tiers and posting.tier not in self._seniority_tiers:
            counters.filtered_tier += 1
            self._sample(counters, "tier", posting)
            return False

        # Stage 4 — location.
        if not self._location(posting.location):
            counters.filtered_location += 1
            self._sample(counters, "location", posting)
            return False

        # The reverse profile stops after content; the remaining stages need data the
        # directory sweep's providers largely don't return.
        if self.profile == "tracked":
            # Stage 5 — absolute posted-date bounds.
            if not self._posted_date(posting.posted_at):
                counters.filtered_posted_date += 1
                self._sample(counters, "posted_date", posting)
                return False

            # Stage 6 — salary.
            if not self._salary(posting.salary):
                counters.filtered_salary += 1
                self._sample(counters, "salary", posting)
                return False

        # Stage 8 — content.
        matched = matched_title_keywords(posting.title, self.title_config)
        if not self._content(posting.description, matched):
            counters.filtered_content += 1
            self._sample(counters, "content", posting)
            return False

        if self.profile == "tracked":
            # Stage 9 — visa / sponsorship.
            if not self._visa(posting.description):
                counters.filtered_visa += 1
                self._sample(counters, "visa", posting)
                return False

        counters.kept += 1
        self._sample(counters, "kept", posting)
        return True
