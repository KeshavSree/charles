# storage/models.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, DateTime, Integer, Float, ForeignKey, Boolean, JSON, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Job(Base):
    """Persisted job posting row.

    Primary key: first 16 hex chars of SHA256(url). `dedup_url` is the normalized
    form (tracking params stripped) and is the key the scanner actually matches on —
    two URLs differing only by `?utm_source=` are the same posting.

    Lifecycle: `first_seen_at` is immutable, `last_seen_at` refreshes every run, and
    `status` tracks whether the posting is still on its board. A posting that
    disappears from a board that *successfully returned* becomes 'delisted'; a board
    that errored never delists anything.
    """

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    dedup_url: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # Which registered source produced this posting.
    source_id: Mapped[str] = mapped_column(String(64), nullable=False, default="tracked", index=True)
    company: Mapped[str] = mapped_column(String(256), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    posted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # intern | entry | mid | senior
    tier: Mapped[str] = mapped_column(String(16), nullable=False, default="mid")
    # active | dismissed | delisted | skipped_invalid_url | skipped_blocked_host
    # | skipped_expired
    # 'dismissed' is the only user-set value: the rest are the scanner's. It survives
    # rescans (see persist_postings) so a rejected posting stays rejected.
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    salary_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    salary_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    salary_currency: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    trust_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    trust_flags: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    fingerprint: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)


# The application stages, in order. Index position is the whole ordering model —
# "advance" is +1 here — so never reorder without a data migration.
PIPELINE_STAGES = ("interested", "contacted", "applied", "oa", "interview", "final")

# Terminal results, recorded on an entry sitting in the 'final' stage. Deliberately
# NOT stages: a job is in 'final' and separately has (or does not yet have) a result.
PIPELINE_OUTCOMES = ("offer", "rejected")


class PipelineEntry(Base):
    """A job the user is actively pursuing.

    `job_id` is the primary key, so a job is in the pipeline at most once. Deleting
    the entry drops the job from the pipeline and leaves the `Job` row alone — the
    scanner's own lifecycle (`Job.status`) is independent of this one.
    """

    __tablename__ = "pipeline_entries"

    job_id: Mapped[str] = mapped_column(String(16), ForeignKey("jobs.id"), primary_key=True)
    # interested | contacted | applied | oa | interview | final
    stage: Mapped[str] = mapped_column(
        String(32), nullable=False, default="interested", index=True
    )
    # offer | rejected — only meaningful while stage == 'final'
    outcome: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    # Who was reached out to. Captured at the 'contacted' stage and carried through
    # every stage after it — the recruiter you emailed is still the thread you reply
    # on at OA and interview time.
    contact_email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Last time the user did something with this entry — moved its stage, set a
    # result, recorded a contact. Not a scanner timestamp.
    last_interacted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


# Composite index backing the default jobs view: active postings, newest first.
Index("ix_jobs_status_posted", Job.status, Job.posted_at.desc())
Index("ix_jobs_company", Job.company)
Index("ix_jobs_tier", Job.tier)


class TrackedCompany(Base):
    """A company whose board the scanner polls directly (the company-first path).

    Replaces companies.yaml. An entry is identified by its careers URL — the provider
    registry derives the ATS and API endpoint from it via detect(), so there is no
    board-token guessing and a wrong URL surfaces in BoardHealth instead of 404ing
    silently.
    """

    __tablename__ = "tracked_companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    careers_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Optional: pins the ATS board when careers_url is a branded page.
    api_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Optional: bypasses detect() entirely.
    provider: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Workday-only pagination override.
    max_pages: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ScanConfig(Base):
    """Singleton holding the INGEST filter configuration — what may enter the DB.

    Mirrors UserInfo's singleton pattern. Every column is a filter config blob
    consumed by scanner/filters/*.py. Distinct from the VIEW filters on /api/jobs,
    which only narrow what is already stored.
    """

    __tablename__ = "scan_config"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default="default")

    # ── Ingest filters ──
    title_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    location_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    content_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    visa_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    salary_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    trust_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Which seniority tiers to KEEP. Empty means every tier passes.
    seniority_tiers: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    max_posting_age_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    blocked_companies: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    company_aliases: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # ── Global scan settings ──
    # max_posting_age_days above is the single age control. Tracked sources treat an
    # unset value as no limit; reverse sources fall back to REVERSE_FALLBACK_DAYS.
    include_undated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    concurrency: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SourceConfig(Base):
    """Per-source enable state and settings.

    Rows are created lazily the first time a registered source is seen, so dropping a
    new source file into scanner/sources/ needs no migration. `settings` is an opaque
    blob whose shape is owned by the source itself.
    """

    __tablename__ = "source_config"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    settings: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ScanRun(Base):
    """Per-run counters — the only observability into which filter stage drops what.

    Also carries the reverse-scan degradation fields, which let a caller tell a
    *degraded* run (dataset stale, company cap hit) from a genuinely *empty* one.
    """

    __tablename__ = "scan_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Which source this run covers. One ScanRun per source, never a blended row.
    source_id: Mapped[str] = mapped_column(String(64), nullable=False, default="tracked", index=True)
    # running | completed | failed
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    dry_run: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    companies: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    boards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    filtered_blacklist: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_title: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_tier: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_location: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_posting_age: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_posted_date: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_salary: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_content: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filtered_visa: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dropped_stale: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dropped_no_date: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dupes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    new_added: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    refreshed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    delisted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Reverse-scan degradation signals
    companies_available: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    companies_scanned: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cap_hit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dataset_status: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # stage -> [{title, count}] for the postings this run dropped.
    drops: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    unreachable_boards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Boards not requested at all this run because they are on the dead-board list.
    boards_skipped_dead: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class BoardHealth(Base):
    """One row per company per run. Consecutive failures build a streak, so a board
    that has been dead for N runs can be surfaced instead of failing silently."""

    __tablename__ = "board_health"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    company: Mapped[str] = mapped_column(String(256), nullable=False, index=True)
    # reachable | empty | slug_gone | network | auth | server | unknown
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class DeadBoard(Base):
    """A directory board that failed, keyed by the slug the URL is built from.

    Distinct from `BoardHealth`, which appends one row per company per run and backs
    the Health tab. A directory sweep touches ~28,700 boards, so history at that
    volume would swamp both the table and the UI. This is current state only: one
    upserted row per broken board, holding a consecutive-failure streak.

    Measured before building: probing the same random sample twice, 20 seconds apart,
    every one of 137 failures reproduced and none flapped. A board that 404s is a slug
    that no longer exists in a community-maintained dataset nobody prunes, so the
    streak is about tolerating transient network trouble, not genuine ambiguity.
    """

    __tablename__ = "dead_boards"

    provider_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    slug: Mapped[str] = mapped_column(String(256), primary_key=True)
    # Consecutive failures. Reset to zero (row deleted) the moment a board answers.
    failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # slug_gone | network | auth | server | unknown
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    first_failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # When the board was last actually requested. Drives the periodic re-check that
    # lets a company which moves back onto an ATS get picked up again.
    last_checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(256), nullable=False)
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ResumeSection(Base):
    __tablename__ = "resume_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resume_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("resumes.id"), nullable=False
    )
    section_type: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[str] = mapped_column(String(36), ForeignKey("resumes.id"), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    last_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    linkedin_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    github_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    website: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    work_auth: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ProfileExperience(Base):
    __tablename__ = "profile_experience"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("profiles.id"), nullable=False
    )
    company: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    title: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    location: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    start_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    end_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ProfileEducation(Base):
    __tablename__ = "profile_education"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("profiles.id"), nullable=False
    )
    institution: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    degree: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    major: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    gpa: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    grad_year: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    grad_month: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class UserInfo(Base):
    __tablename__ = "user_info"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default="default")
    first_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    last_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    chosen_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    pronouns: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    email: Mapped[str] = mapped_column(String(256), nullable=False, default="")
    phone: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    linkedin_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    zip_code: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    work_auth: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    work_authorized: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    requires_sponsorship: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    gender: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    ethnicity: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    veteran_status: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    disability_status: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    hispanic_latino: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    transgender: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    would_relocate: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    non_compete: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    us_gov_employee: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    gov_contracting: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    export_restricted: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    f1_student: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    enrolled_returning: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    privacy_ack: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    job_alerts: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    worked_here: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    degree_pursuing: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    grad_date: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    twitter: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    facebook: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    github: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    aggressive_fill: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    worked_companies: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    skills: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
