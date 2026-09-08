# storage/repository.py
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

_log = logging.getLogger(__name__)

from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from storage.models import (
    BoardHealth, DeadBoard, Job, PipelineEntry, PIPELINE_OUTCOMES, PIPELINE_STAGES,
    Profile, ProfileExperience, ProfileEducation,
    Resume, ResumeSection, ScanConfig, ScanRun, SourceConfig, TrackedCompany,
    UserInfo,
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
    source_id: str = "tracked",
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
            "source_id": source_id,
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
            # A posting that reappears after being delisted is live again — but a
            # dismissal is the user's own decision and outranks the scanner's, or
            # every rescan would resurrect the rows they just rejected.
            if existing.status != "dismissed":
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


async def set_job_status(
    session: AsyncSession, job_id: str, status: str
) -> Optional[Job]:
    """Set a posting's status by hand. Used by the jobs list's dismiss/restore."""
    job = await session.get(Job, job_id)
    if job is None:
        return None
    job.status = status
    await session.commit()
    return job


async def purge_jobs(session: AsyncSession) -> int:
    """Delete every stored posting and report how many went.

    Deliberately leaves ScanRun and BoardHealth alone: those record what the scanner
    *did*, which stays true whether or not the resulting rows are still around, and
    board-failure streaks are the one thing you least want to lose when starting over.
    """
    total = (await session.execute(select(func.count()).select_from(Job))).scalar_one()
    await session.execute(delete(Job))
    await session.commit()
    return total


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
    "seniority_tiers": [],
    "blocked_companies": [],
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


# ── Pipeline ────────────────────────────────────────────────────────

async def add_to_pipeline(session: AsyncSession, job_id: str) -> Optional[PipelineEntry]:
    """Put a job into the pipeline at the first stage. Idempotent.

    Returns None if no such job exists, so the caller can 404 rather than create a
    dangling entry.
    """
    existing = await session.get(PipelineEntry, job_id)
    if existing is not None:
        return existing
    if await session.get(Job, job_id) is None:
        return None
    now = datetime.now(tz=timezone.utc)
    entry = PipelineEntry(
        job_id=job_id, stage=PIPELINE_STAGES[0], added_at=now, last_interacted_at=now
    )
    session.add(entry)
    await session.commit()
    return entry


async def update_pipeline_entry(
    session: AsyncSession,
    job_id: str,
    stage: Optional[str] = None,
    outcome: Optional[str] = None,
    notes: Optional[str] = None,
    contact_email: Optional[str] = None,
    clear_outcome: bool = False,
) -> Optional[PipelineEntry]:
    entry = await session.get(PipelineEntry, job_id)
    if entry is None:
        return None
    if stage is not None:
        if stage not in PIPELINE_STAGES:
            raise ValueError(f"unknown pipeline stage: {stage}")
        entry.stage = stage
        # An outcome only means anything in 'final'. Moving back out of it drops the
        # stale result rather than leaving an "Offer" hanging off an OA row.
        if stage != "final":
            entry.outcome = None
    if clear_outcome:
        entry.outcome = None
    elif outcome is not None:
        if outcome not in PIPELINE_OUTCOMES:
            raise ValueError(f"unknown pipeline outcome: {outcome}")
        entry.outcome = outcome
    if notes is not None:
        entry.notes = notes
    if contact_email is not None:
        # Blanking the field clears it; the value otherwise survives every later
        # stage change, which is the point of recording it at 'contacted'.
        entry.contact_email = contact_email.strip() or None
    entry.last_interacted_at = datetime.now(tz=timezone.utc)
    await session.commit()
    return entry


async def remove_from_pipeline(session: AsyncSession, job_id: str) -> bool:
    entry = await session.get(PipelineEntry, job_id)
    if entry is None:
        return False
    await session.delete(entry)
    await session.commit()
    return True


async def list_pipeline(
    session: AsyncSession, stage: Optional[str] = None
) -> list[tuple[PipelineEntry, Job]]:
    """Entries with their jobs, most recently touched first.

    Explicit join — this codebase declares FKs but never uses relationship().
    """
    stmt = (
        select(PipelineEntry, Job)
        .join(Job, Job.id == PipelineEntry.job_id)
        .order_by(PipelineEntry.last_interacted_at.desc())
    )
    if stage:
        stmt = stmt.where(PipelineEntry.stage == stage)
    return [(e, j) for e, j in (await session.execute(stmt)).all()]


async def get_pipeline_entry(
    session: AsyncSession, job_id: str
) -> Optional[tuple[PipelineEntry, Job]]:
    stmt = (
        select(PipelineEntry, Job)
        .join(Job, Job.id == PipelineEntry.job_id)
        .where(PipelineEntry.job_id == job_id)
    )
    return (await session.execute(stmt)).first()


async def pipeline_stage_counts(session: AsyncSession) -> dict[str, int]:
    stmt = select(PipelineEntry.stage, func.count()).group_by(PipelineEntry.stage)
    rows = dict((await session.execute(stmt)).all())
    return {stage: int(rows.get(stage, 0)) for stage in PIPELINE_STAGES}


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


# ── Source enable state + settings ──────────────────────────────────

# Sources that are on for a fresh install. The board feeds stay off: they need no
# company list, so the title and location filters are the only thing constraining them,
# and turning all twelve on by default would flood the table before it is tuned.
DEFAULT_ENABLED_SOURCES = {"tracked"}


async def list_source_configs(session: AsyncSession) -> dict[str, SourceConfig]:
    """Every registered source's row, creating any that do not exist yet."""
    from scanner.sources._registry import load_sources

    rows = {
        r.id: r for r in (await session.execute(select(SourceConfig))).scalars().all()
    }
    now = datetime.now(tz=timezone.utc)
    created = False
    for source_id in load_sources():
        if source_id in rows:
            continue
        row = SourceConfig(
            id=source_id,
            enabled=source_id in DEFAULT_ENABLED_SOURCES,
            settings={},
            updated_at=now,
        )
        session.add(row)
        rows[source_id] = row
        created = True
    if created:
        await session.commit()
    return rows


async def save_source_config(
    session: AsyncSession, source_id: str, data: dict
) -> SourceConfig:
    rows = await list_source_configs(session)
    row = rows.get(source_id)
    if row is None:
        raise ValueError(f"unknown source: {source_id}")
    if "enabled" in data:
        row.enabled = bool(data["enabled"])
    if "settings" in data and isinstance(data["settings"], dict):
        row.settings = data["settings"]
    row.updated_at = datetime.now(tz=timezone.utc)
    await session.commit()
    return row


# ── Run + health records ────────────────────────────────────────────

async def create_scan_run(session: AsyncSession, source_id: str, dry_run: bool) -> ScanRun:
    row = ScanRun(
        started_at=datetime.now(tz=timezone.utc),
        source_id=source_id,
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


async def reap_orphaned_runs(session: AsyncSession) -> int:
    """Mark runs still labelled `running` at startup as interrupted.

    A run only lives in the process that started it, so any row still saying "running"
    when the process boots is by definition dead -- killed, crashed, or reloaded
    mid-sweep. Left alone they accumulate as phantom in-progress entries in the Runs
    tab, which is exactly the kind of UI-says-one-thing-reality-says-another this
    whole change is meant to remove.
    """
    result = await session.execute(
        select(ScanRun).where(ScanRun.status == "running", ScanRun.finished_at.is_(None))
    )
    rows = result.scalars().all()
    now = datetime.now(tz=timezone.utc)
    for row in rows:
        row.status = "interrupted"
        row.finished_at = now
    if rows:
        await session.commit()
    return len(rows)


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


# A board is skipped once it has failed this many consecutive sweeps. Two is enough:
# failures were measured to be 100% reproducible, so the second run exists only to
# absorb a transient network blip, not to build confidence in the verdict.
DEAD_AFTER_FAILURES = 2

# Even a permanently dead slug is re-probed this often, so a company that moves back
# onto an ATS is picked up again. Spread over the sweep this costs a fraction of a
# percent of the requests the skip saves.
DEAD_RECHECK_DAYS = 7

# Rows written per commit when folding a sweep's outcomes in. Small enough that the
# event loop is never held for long, large enough that 28,700 outcomes don't become
# 28,700 transactions.
DEAD_BOARD_WRITE_CHUNK = 500


async def dead_board_keys(session: AsyncSession) -> set[tuple[str, str]]:
    """(provider_id, slug) pairs to skip this run.

    A row is only skipped while it is both over the failure threshold *and* inside its
    re-check window; letting it out of the window is what makes the skip self-healing
    rather than a permanent ban.
    """
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=DEAD_RECHECK_DAYS)
    rows = await session.execute(
        select(DeadBoard.provider_id, DeadBoard.slug).where(
            DeadBoard.failures >= DEAD_AFTER_FAILURES,
            DeadBoard.last_checked_at >= cutoff,
        )
    )
    return {(p, s) for p, s in rows.all()}


async def record_board_outcomes(
    session: AsyncSession, outcomes: list[tuple[str, str, bool, str, str]]
) -> dict[str, int]:
    """Fold one sweep's per-board results into the dead-board list.

    Takes (provider_id, slug, ok, kind, detail). A success deletes the row outright, so
    "not in the table" and "healthy" are the same state and the table only ever holds
    boards that are currently broken.
    """
    if not outcomes:
        return {"marked": 0, "revived": 0}
    now = datetime.now(tz=timezone.utc)

    existing = {
        (row.provider_id, row.slug): row
        for row in (await session.execute(select(DeadBoard))).scalars().all()
    }
    marked = revived = 0
    # A directory sweep hands back ~28,700 outcomes, ~13,000 of them failures. Writing
    # those in one commit stalls the event loop long enough for `/scanner/progress` to
    # stop answering, which the UI correctly reads as having lost the server -- a
    # self-inflicted desync at the very end of a successful run. Chunk it and yield.
    for i, (provider_id, slug, ok, kind, detail) in enumerate(outcomes, start=1):
        row = existing.get((provider_id, slug))
        if ok:
            if row is not None:
                await session.delete(row)
                revived += 1
        else:
            if row is None:
                session.add(DeadBoard(
                    provider_id=provider_id, slug=slug, failures=1, kind=kind,
                    detail=(detail or "")[:500], first_failed_at=now, last_checked_at=now,
                ))
            else:
                row.failures += 1
                row.kind = kind
                row.detail = (detail or "")[:500]
                row.last_checked_at = now
            marked += 1
        if i % DEAD_BOARD_WRITE_CHUNK == 0:
            await session.commit()
            await asyncio.sleep(0)      # let pending progress polls through
    await session.commit()
    return {"marked": marked, "revived": revived}


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
        existing.github_url = profile.github_url
        existing.website = profile.website
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
    from parser.resume import parse_pdf, parse_text

    sections_result = await session.execute(
        select(ResumeSection).where(ResumeSection.resume_id == resume_id)
    )
    sections: dict[str, str] = {
        s.section_type: s.content for s in sections_result.scalars().all()
    }

    resume = await session.get(Resume, resume_id)
    if resume and resume.file_path and os.path.exists(resume.file_path):
        # Use the PDF as the source of truth when it's present, so the parser gets
        # the column split and font tiers that the stored section text has already
        # thrown away. A present-but-corrupt file raises loudly (no silent
        # fallback); a genuinely absent file falls back to the flat-text parsers
        # (the programmatic/seeded path).
        parsed = parse_pdf(resume.file_path)
    else:
        full_text = sections.get("contact", "") + "\n" + "\n".join(
            v for k, v in sections.items() if k != "contact"
        )
        parsed = parse_text(sections, full_text)

    contact = parsed.contact
    exp_entries = parsed.experience
    edu_entries = parsed.education

    now = datetime.now(tz=timezone.utc)
    existing = await session.get(Profile, resume_id)
    if existing:
        existing.first_name = contact.first_name
        existing.last_name = contact.last_name
        existing.email = contact.email
        existing.phone = contact.phone or None
        existing.linkedin_url = contact.linkedin_url or None
        existing.github_url = contact.github_url or None
        existing.website = contact.website or None
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
            github_url=contact.github_url or None,
            website=contact.website or None,
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
            location=e.location or None,
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
