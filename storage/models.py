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
    # How this posting was discovered: tracked | directory | seed | board
    discovery: Mapped[str] = mapped_column(String(32), nullable=False, default="tracked")
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
    # active | delisted | skipped_invalid_url | skipped_blocked_host | skipped_expired
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    salary_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    salary_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    salary_currency: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    trust_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    trust_flags: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    fingerprint: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, index=True)


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
    skip_tiers: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    max_posting_age_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    blocked_companies: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    company_aliases: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # ── Directory / reverse-scan settings ──
    since_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    include_undated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ats_sources: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    limit_per_ats: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    shuffle: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    concurrency: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

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
    # tracked | directory | seeds
    mode: Mapped[str] = mapped_column(String(32), nullable=False, default="tracked")
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
    unreachable_boards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


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
