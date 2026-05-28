# storage/models.py
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Job(Base):
    """Persisted job posting row.

    Primary key: first 16 hex chars of SHA256(url).
    """

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    company: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    location: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    posted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
