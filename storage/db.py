# storage/db.py
from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import Settings
from storage.models import Base

_settings = Settings()
_engine = create_async_engine(_settings.database_url, echo=False)
SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    _engine, expire_on_commit=False
)


async def create_tables() -> None:
    """Create all tables if they do not already exist."""
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Async context manager that yields a database session."""
    async with SessionLocal() as session:
        yield session
