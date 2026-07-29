# storage/repository.py
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Optional

_log = logging.getLogger(__name__)

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from storage.models import (
    BoardHealth, Job, Profile, ProfileExperience, ProfileEducation,
    Resume, ResumeSection, ScanConfig, ScanRun, TrackedCompany, UserInfo,
)


def _url_to_id(url: str) -> str:
    """Return first 16 hex chars of SHA256(url)."""
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _to_datetime(epoch_ms: int | None) -> datetime | None:
    if not isinstance(epoch_ms, int):
        return None
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc)


async def persist_postings(
    session: AsyncSession,
    postings: list,
    *,
    discovery: str = "tracked",
) -> tuple[int, int]:
    """Insert new postings and refresh ones already stored.

    Identity is `dedup_url` (tracking params stripped), not the raw URL — the same
    posting reached via a UTM-tagged link must not create a second row.

    `first_seen_at` is written once and never updated: it is the answer to "when did
    this job appear", which is the field a user actually cares about. `last_seen_at`
    refreshes every run and is what the delisting pass reads.

    Returns (added, refreshed).
    """
    if not postings:
        return 0, 0

    from scanner.dedup import normalize_url_for_dedup

    now = datetime.now(tz=timezone.utc)
    added = 0
    refreshed = 0

    for posting in postings:
        dedup_url = normalize_url_for_dedup(posting.url)
        existing = (
            await session.execute(select(Job).where(Job.dedup_url == dedup_url))
        ).scalar_one_or_none()

        salary = getattr(posting, "salary", None)
        values = {
            "provider_id": posting.provider_id,
            "discovery": discovery,
            "company": posting.company,
            "title": posting.title,
            "url": posting.url,
            "location": posting.location or None,
            "description": posting.description or None,
            "posted_at": _to_datetime(posting.posted_at),
            "tier": posting.tier,
            "salary_min": salary.min if salary else None,
            "salary_max": salary.max if salary else None,
            "salary_currency": salary.currency if salary else None,
            "trust_score": posting.trust_score,
            "trust_flags": posting.trust_flags or None,
            "fingerprint": posting.fingerprint or None,
        }

        if existing is None:
            session.add(
                Job(
                    id=_url_to_id(posting.url),
                    dedup_url=dedup_url,
                    status="active",
                    first_seen_at=now,
                    last_seen_at=now,
                    **values,
                )
            )
            added += 1
        else:
            for key, value in values.items():
                setattr(existing, key, value)
            existing.last_seen_at = now
            existing.updated_at = now
            # A posting that reappears after being delisted is live again.
            existing.status = "active"
            refreshed += 1

    await session.commit()
    return added, refreshed


async def mark_delisted(
    session: AsyncSession, companies: list[str], run_started_at: datetime
) -> int:
    """Mark postings that vanished from their board as delisted.

    Only called for companies whose fetch **succeeded**. This is the load-bearing
    detail: a board that 404s or times out returns zero postings, and delisting on
    that basis would wipe the company's entire history on one bad request.
    """
    if not companies:
        return 0
    result = await session.execute(
        select(Job).where(
            Job.company.in_(companies),
            Job.status == "active",
            Job.last_seen_at < run_started_at,
        )
    )
    rows = list(result.scalars().all())
    for row in rows:
        row.status = "delisted"
    await session.commit()
    return len(rows)


# ── Scanner configuration ───────────────────────────────────────────

_SCAN_CONFIG_ID = "default"

# Shipped defaults: a technical-roles title filter roughly matching the old
# filters.py intent, but expressed as config the user can edit rather than code.
DEFAULT_SCAN_CONFIG = {
    "title_filter": {
        "positive": [
            "software", "engineer", "developer", "data scientist", "machine learning",
            "ml", "ai", "research", "infrastructure", "platform", "backend",
            "frontend", "full stack", "fullstack", "systems", "devops", "sre",
            "security", "architect", "cloud",
        ],
        "negative": [
            "mechanical", "electrical", "civil", "chemical", "structural",
            "aerospace", "industrial", "optical", "manufacturing", "recruiter",
            "recruiting", "coordinator", "sales", "marketing", "legal", "counsel",
            "finance", "accounting",
        ],
    },
    "location_filter": {},
    "skip_tiers": [],
    "blocked_companies": [],
    "ats_sources": ["greenhouse", "lever", "ashby"],
    "since_days": 7,
}


async def get_or_create_scan_config(session: AsyncSession) -> ScanConfig:
    row = await session.get(ScanConfig, _SCAN_CONFIG_ID)
    if row is None:
        row = ScanConfig(
            id=_SCAN_CONFIG_ID,
            updated_at=datetime.now(tz=timezone.utc),
            **DEFAULT_SCAN_CONFIG,
        )
        session.add(row)
        await session.commit()
    return row


_SCAN_CONFIG_SKIP = frozenset({"id", "updated_at"})


def scan_config_to_dict(row: ScanConfig) -> dict:
    return {
        attr.key: getattr(row, attr.key)
        for attr in ScanConfig.__mapper__.column_attrs
        if attr.key not in _SCAN_CONFIG_SKIP
    }


async def save_scan_config(session: AsyncSession, data: dict) -> ScanConfig:
    row = await get_or_create_scan_config(session)
    for attr in ScanConfig.__mapper__.column_attrs:
        if attr.key in _SCAN_CONFIG_SKIP or attr.key not in data:
            continue
        setattr(row, attr.key, data[attr.key])
    row.updated_at = datetime.now(tz=timezone.utc)
    await session.commit()
    return await session.get(ScanConfig, _SCAN_CONFIG_ID)


# ── Tracked companies ───────────────────────────────────────────────

async def list_tracked_companies(
    session: AsyncSession, enabled_only: bool = False
) -> list[TrackedCompany]:
    stmt = select(TrackedCompany).order_by(TrackedCompany.name)
    if enabled_only:
        stmt = stmt.where(TrackedCompany.enabled.is_(True))
    return list((await session.execute(stmt)).scalars().all())


async def upsert_tracked_company(session: AsyncSession, data: dict) -> TrackedCompany:
    name = (data.get("name") or "").strip()
    if not name:
        raise ValueError("tracked company requires a name")
    existing = (
        await session.execute(select(TrackedCompany).where(TrackedCompany.name == name))
    ).scalar_one_or_none()
    if existing is None:
        existing = TrackedCompany(name=name, created_at=datetime.now(tz=timezone.utc))
        session.add(existing)
    for key in ("careers_url", "api_url", "provider", "enabled", "max_pages", "notes"):
        if key in data:
            setattr(existing, key, data[key])
    await session.commit()
    return existing


async def delete_tracked_company(session: AsyncSession, company_id: int) -> bool:
    row = await session.get(TrackedCompany, company_id)
    if row is None:
        return False
    await session.delete(row)
    await session.commit()
    return True


# ── Run + health records ────────────────────────────────────────────

async def create_scan_run(session: AsyncSession, mode: str, dry_run: bool) -> ScanRun:
    row = ScanRun(
        started_at=datetime.now(tz=timezone.utc),
        mode=mode,
        status="running",
        dry_run=dry_run,
    )
    session.add(row)
    await session.commit()
    return row


async def finish_scan_run(session: AsyncSession, run: ScanRun, values: dict) -> ScanRun:
    for key, value in values.items():
        if hasattr(run, key):
            setattr(run, key, value)
    run.finished_at = datetime.now(tz=timezone.utc)
    run.status = values.get("status", "completed")
    await session.commit()
    return run


async def record_board_health(session: AsyncSession, records: list[dict]) -> None:
    now = datetime.now(tz=timezone.utc)
    for record in records:
        session.add(
            BoardHealth(
                timestamp=now,
                company=record["company"],
                status=record["status"],
                detail=record.get("detail"),
            )
        )
    await session.commit()


async def board_failure_streaks(session: AsyncSession) -> dict[str, int]:
    """Consecutive-failure count per company.

    A board that has been unreachable for several runs is a configuration problem
    (wrong slug, migrated ATS), not a transient one — the streak is what distinguishes
    them, and its absence is why charles previously had 14 silently dead companies.
    """
    result = await session.execute(
        select(BoardHealth).order_by(BoardHealth.timestamp.asc(), BoardHealth.id.asc())
    )
    streaks: dict[str, int] = {}
    for row in result.scalars().all():
        if row.status in ("slug_gone", "network", "auth", "server", "unknown"):
            streaks[row.company] = streaks.get(row.company, 0) + 1
        elif row.status in ("reachable", "empty"):
            streaks[row.company] = 0
    return streaks


async def get_profile(session: AsyncSession, resume_id: str) -> Profile | None:
    return await session.get(Profile, resume_id)


async def save_profile(
    session: AsyncSession,
    profile: Profile,
    experience: list[ProfileExperience],
    education: list[ProfileEducation],
) -> None:
    await session.execute(
        delete(ProfileExperience).where(ProfileExperience.profile_id == profile.id)
    )
    await session.execute(
        delete(ProfileEducation).where(ProfileEducation.profile_id == profile.id)
    )
    existing = await session.get(Profile, profile.id)
    if existing:
        existing.first_name = profile.first_name
        existing.last_name = profile.last_name
        existing.email = profile.email
        existing.phone = profile.phone
        existing.linkedin_url = profile.linkedin_url
        existing.location = profile.location
        existing.work_auth = profile.work_auth
        existing.updated_at = profile.updated_at
    else:
        session.add(profile)
    await session.flush()
    for exp in experience:
        session.add(exp)
    for edu in education:
        session.add(edu)
    await session.commit()


async def generate_profile_from_resume(session: AsyncSession, resume_id: str) -> Profile:
    from parser.contact import extract_contact
    from parser.experience import extract_experience
    from parser.education import extract_education

    sections_result = await session.execute(
        select(ResumeSection).where(ResumeSection.resume_id == resume_id)
    )
    sections: dict[str, str] = {
        s.section_type: s.content for s in sections_result.scalars().all()
    }

    resume = await session.get(Resume, resume_id)
    full_text = sections.get("contact", "") + "\n" + "\n".join(
        v for k, v in sections.items() if k != "contact"
    )
    if resume and resume.file_path and os.path.exists(resume.file_path):
        # Use the PDF as the source of truth when it's present. A present-but-corrupt
        # file raises loudly (no silent fallback); a genuinely absent file falls back
        # to the already-extracted section text (the programmatic/seeded path).
        from parser.pdf import extract_text
        full_text = extract_text(resume.file_path)

    contact = extract_contact(full_text, sections.get("contact", ""))
    exp_entries = extract_experience(sections.get("experience", ""))
    edu_entries = extract_education(sections.get("education", ""))

    now = datetime.now(tz=timezone.utc)
    existing = await session.get(Profile, resume_id)
    if existing:
        existing.first_name = contact.first_name
        existing.last_name = contact.last_name
        existing.email = contact.email
        existing.phone = contact.phone or None
        existing.linkedin_url = contact.linkedin_url or None
        existing.location = contact.location or None
        existing.updated_at = now
        profile = existing
    else:
        profile = Profile(
            id=resume_id,
            first_name=contact.first_name,
            last_name=contact.last_name,
            email=contact.email,
            phone=contact.phone or None,
            linkedin_url=contact.linkedin_url or None,
            location=contact.location or None,
            created_at=now,
            updated_at=now,
        )
        session.add(profile)

    await session.flush()

    await session.execute(
        delete(ProfileExperience).where(ProfileExperience.profile_id == resume_id)
    )
    await session.execute(
        delete(ProfileEducation).where(ProfileEducation.profile_id == resume_id)
    )

    for i, e in enumerate(exp_entries):
        session.add(ProfileExperience(
            profile_id=resume_id,
            company=e.company,
            title=e.title,
            start_date=e.start_date or None,
            end_date=e.end_date or None,
            is_current=e.is_current,
            description=e.description or None,
            display_order=i,
        ))

    for i, e in enumerate(edu_entries):
        session.add(ProfileEducation(
            profile_id=resume_id,
            institution=e.institution,
            degree=e.degree or None,
            major=e.major or None,
            gpa=e.gpa or None,
            grad_year=e.grad_year or None,
            grad_month=e.grad_month or None,
            display_order=i,
        ))

    await session.commit()
    return profile


_INFO_ID = "default"


async def get_or_create_info(session: AsyncSession) -> UserInfo:
    row = await session.get(UserInfo, _INFO_ID)
    if row is None:
        row = UserInfo(id=_INFO_ID, updated_at=datetime.now(tz=timezone.utc))
        session.add(row)
        await session.commit()
    return row


_INFO_SKIP = frozenset({'id', 'updated_at', 'work_auth'})


async def save_info(session: AsyncSession, data: UserInfo) -> UserInfo:
    existing = await session.get(UserInfo, _INFO_ID)
    now = datetime.now(tz=timezone.utc)
    if existing:
        for attr in UserInfo.__mapper__.column_attrs:
            if attr.key not in _INFO_SKIP:
                setattr(existing, attr.key, getattr(data, attr.key, None))
        existing.updated_at = now
    else:
        data.id = _INFO_ID
        data.updated_at = now
        session.add(data)
    await session.commit()
    return await session.get(UserInfo, _INFO_ID)
