from __future__ import annotations

POSITIVE_KEYWORDS = frozenset({
    "software", "engineer", "engineering", "developer", "data",
    "scientist", "science", "ml", "ai", "machine learning",
    "deep learning", "research", "infrastructure", "platform",
    "backend", "frontend", "fullstack", "full stack", "full-stack",
    "algorithm", "systems", "devops", "sre", "security",
    "architect", "database", "cloud", "intelligence", "neural",
    "model", "computer", "technical",
})

NEGATIVE_KEYWORDS = frozenset({
    # Non-CS engineering disciplines
    "business", "mechanical", "electrical", "civil", "chemical", "structural",
    "aerospace", "industrial", "optical", "manufacturing",
    # Non-technical roles that can match positive keywords
    "guard", "recruiter", "recruiting", "coordinator", "administrative",
    "facilities", "hvac", "sales", "marketing", "legal", "counsel",
    "finance", "accounting",
})

# Exact title matches (case-insensitive) that are always excluded regardless of score.
FULL_EXCLUSIONS = frozenset({
    "data analyst",
})


def relevance_score(title: str) -> int:
    t = title.lower()
    return (
        sum(1 for kw in POSITIVE_KEYWORDS if kw in t)
        - sum(1 for kw in NEGATIVE_KEYWORDS if kw in t)
    )


def is_technical(title: str) -> bool:
    t = title.lower()
    if any(excl in t for excl in FULL_EXCLUSIONS):
        return False
    return relevance_score(t) >= 1
