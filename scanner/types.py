"""Core data shapes shared by every provider and the runner.

Ported from career-ops `providers/_types.js` + `scrapers/base.py:JobPosting`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol


@dataclass
class Salary:
    """Annualized compensation. Providers that expose an interval (hourly, weekly)
    must annualize before constructing this — the salary filter assumes annual."""

    min: Optional[float] = None
    max: Optional[float] = None
    currency: str = ""


@dataclass
class Posting:
    """One job posting as returned by a provider, before any filtering.

    `posted_at` is epoch milliseconds (matching career-ops) rather than a datetime,
    because several providers derive it arithmetically from relative labels
    ("Posted 5 Days Ago") and the date filters compare against a millisecond cutoff.
    The runner converts to a datetime at persistence time.
    """

    title: str
    url: str
    company: str
    location: str = ""
    description: str = ""
    posted_at: Optional[int] = None
    salary: Optional[Salary] = None

    # Populated by the runner, not by providers.
    provider_id: str = ""
    source_id: str = "tracked"
    tier: str = "mid"
    trust_score: Optional[int] = None
    trust_flags: list[str] = field(default_factory=list)
    fingerprint: str = ""
    note: str = ""
    blacklisted: bool = False


class PostingList(list):
    """A list of Postings that can carry per-fetch annotations.

    Workday needs to tell the runner "this tenant exposes no posting dates, so I
    stopped after page 0" without logging once per company — a directory sweep hits
    that case on thousands of tenants. A plain list can't hold attributes, hence this.
    """

    workday_no_date_skip: bool = False
    workday_truncated: bool = False


@dataclass
class PortalEntry:
    """A scan target. `careers_url` is the identifying field — providers derive their
    API endpoint from it via detect(), so there is no separate 'which ATS' key."""

    name: str
    careers_url: str = ""
    # Pins the ATS board when careers_url is a branded corporate page.
    api: Optional[str] = None
    # Bypasses detect() entirely.
    provider: Optional[str] = None
    enabled: bool = True
    # Workday-only pagination override.
    max_pages: Optional[int] = None


@dataclass
class ScanContext:
    """Per-run context handed to every provider.

    `since_ms` and `include_undated` are not merely informational: workday.py reads
    them to early-stop pagination and to skip tenants that expose no posting dates
    at all. Omitting them makes every large tenant paginate to its page cap.
    """

    fetch_json: Callable[..., Any]
    fetch_text: Callable[..., Any]
    since_ms: Optional[int] = None
    include_undated: bool = False
    max_pages: Optional[int] = None
    sleep: Optional[Callable[[float], Any]] = None


class Provider(Protocol):
    """Every provider module exposes a module-level `PROVIDER` object of this shape."""

    id: str

    def detect(self, entry: PortalEntry) -> Optional[str]:
        """Return the resolved API URL if this provider handles the entry, else None.
        Must never raise — the registry catches, but a throwing detect() masks bugs."""
        ...

    async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
        """Fetch all current postings for the entry."""
        ...
