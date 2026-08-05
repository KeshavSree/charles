"""Trust / legitimacy scoring. Ported from `providers/_trust-validator.mjs`.

**Never drops a posting** — it only annotates. Scam and ghost-job signals are
heuristics with real false-positive rates, so the decision stays with the user; the
score and flags are stored and surfaced in the UI.
"""
from __future__ import annotations

from typing import Callable, Optional
from urllib.parse import urlsplit

from scanner.types import Posting

DEFAULT_SUSPICIOUS_DOMAINS = [
    "bit.ly", "tinyurl.com", "t.co", "forms.gle", "goo.gl",
    "shorturl.at", "rebrand.ly", "cutt.ly",
]

# Company-vs-domain mismatch is meaningless for ATS-hosted URLs — a Greenhouse link
# never contains the employer's name — so these hosts skip that check.
DEFAULT_ATS_ALLOWLIST = [
    "greenhouse.io", "ashbyhq.com", "lever.co", "workday.com", "smartrecruiters.com",
    "jobvite.com", "myworkdayjobs.com", "recruitee.com", "workable.com", "icims.com",
    "taleo.net", "applytojob.com", "breezy.hr", "jazz.co", "bamboohr.com",
    "teamtailor.com",
]

PENALTIES = {
    "invalid_url": 50,
    "missing_apply_url": 40,
    "suspicious_domain": 25,
    "company_domain_mismatch": 15,
}


def classify_trust_level(score: int) -> str:
    if score >= 90:
        return "high"
    if score >= 60:
        return "medium"
    return "low"


def matches_domain_list(hostname: str, domains: list[str]) -> bool:
    """True when hostname equals or is a subdomain of any entry."""
    return any(hostname == d or hostname.endswith("." + d) for d in domains)


def company_matches_hostname(company: str, hostname: str) -> bool:
    """Heuristic: does the company name plausibly appear in the hostname?

    Returns True when it can't be evaluated, so an unparseable name never produces a
    flag.
    """
    if not company or not hostname:
        return True
    normalized = "".join(c for c in company.lower() if c.isalnum() or c == " ").strip()
    if not normalized:
        return True
    if normalized.replace(" ", "") in hostname:
        return True
    return any(word in hostname for word in normalized.split() if len(word) >= 3)


def build_trust_validator(config: Optional[dict]) -> Callable[[Posting], tuple[int, list[str], str]]:
    """Returns posting -> (score, flags, level). Disabled config scores everything 100."""
    if not config or config.get("enabled") is False:
        return lambda posting: (100, [], "high")

    suspicious = [
        str(d).lower().strip()
        for d in (config.get("suspicious_domains") or DEFAULT_SUSPICIOUS_DOMAINS)
        if str(d).strip()
    ]
    ats_allowlist = [
        str(d).lower().strip()
        for d in (config.get("ats_allowlist") or DEFAULT_ATS_ALLOWLIST)
        if str(d).strip()
    ]

    def validate(posting: Posting) -> tuple[int, list[str], str]:
        flags: list[str] = []
        score = 100

        url = (posting.url or "").strip()
        if not url:
            flags.append("missing_apply_url")
            score -= PENALTIES["missing_apply_url"]
            score = max(0, score)
            return score, flags, classify_trust_level(score)

        try:
            parts = urlsplit(url)
            hostname = (parts.hostname or "").lower()
            if parts.scheme not in ("http", "https") or not hostname:
                raise ValueError
        except (ValueError, UnicodeError):
            flags.append("invalid_url")
            score = max(0, score - PENALTIES["invalid_url"])
            return score, flags, classify_trust_level(score)

        if matches_domain_list(hostname, suspicious):
            flags.append("suspicious_domain")
            score -= PENALTIES["suspicious_domain"]

        company = (posting.company or "").strip()
        if company and not matches_domain_list(hostname, ats_allowlist):
            if not company_matches_hostname(company, hostname):
                flags.append("company_domain_mismatch")
                score -= PENALTIES["company_domain_mismatch"]

        score = max(0, min(100, score))
        return score, flags, classify_trust_level(score)

    return validate
