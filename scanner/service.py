"""Glue between the source registry and the database.

Everything the API and the scheduler call goes through here, so a scan triggered from
the web UI and one triggered on a timer behave identically.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from scanner.runner import ScanResult, run_source
from scanner.sources._registry import get_source, load_sources
from storage.repository import (
    create_scan_run,
    finish_scan_run,
    get_or_create_scan_config,
    list_source_configs,
    mark_delisted,
    persist_postings,
    record_board_health,
    scan_config_to_dict,
)

logger = logging.getLogger(__name__)


async def _config_for(session: AsyncSession, overrides: Optional[dict]) -> dict:
    row = await get_or_create_scan_config(session)
    config = scan_config_to_dict(row)
    if overrides:
        config.update({k: v for k, v in overrides.items() if v is not None})
    return config


async def scan_one(
    session: AsyncSession,
    source_id: str,
    *,
    dry_run: bool = False,
    overrides: Optional[dict] = None,
) -> dict:
    """Run a single source and persist what it produced."""
    source = get_source(source_id)
    if source is None:
        raise ValueError(f"unknown source: {source_id}")

    config = await _config_for(session, overrides)
    settings = (await list_source_configs(session)).get(source_id)
    settings_blob = dict(settings.settings or {}) if settings else {}
    if overrides:
        settings_blob.update({k: v for k, v in overrides.items() if v is not None})

    run = await create_scan_run(session, source_id=source_id, dry_run=dry_run)
    started_at = run.started_at

    try:
        result: ScanResult = await run_source(
            source, config, settings=settings_blob, session=session
        )
    except Exception:
        await finish_scan_run(session, run, {"status": "failed"})
        logger.exception("source %s failed", source_id)
        raise

    added = refreshed = delisted = 0
    if not dry_run:
        added, refreshed = await persist_postings(
            session, result.postings, source_id=source_id
        )
        if result.health:
            await record_board_health(session, result.health)
            # Only boards that actually answered are eligible for delisting. A 404
            # returns zero postings, and delisting on that basis would wipe a
            # company's whole history on one bad request.
            reachable = [
                h["company"] for h in result.health if h["status"] in ("reachable", "empty")
            ]
            delisted = await mark_delisted(session, reachable, started_at)

    values = result.as_run_values()
    values.update(
        {
            "new_added": added,
            "refreshed": refreshed,
            "delisted": delisted,
            "status": "completed",
            # Persisted so the Runs tab can explain an old run, not just the last one.
            "drops": result.counters.drops_as_lists(),
        }
    )
    await finish_scan_run(session, run, values)

    return {
        "run_id": run.id,
        "source_id": source_id,
        "label": getattr(source, "label", source_id),
        "dry_run": dry_run,
        "counters": result.counters.as_dict(),
        "drops": result.counters.drops_as_lists(),
        "added": added,
        "refreshed": refreshed,
        "delisted": delisted,
        "errors": result.errors[:25],
        "companies_available": result.companies_available,
        "companies_scanned": result.companies_scanned,
        "cap_hit": result.cap_hit,
        "dataset_status": result.dataset_status,
        "unreachable_boards": result.unreachable_boards,
    }


async def scan_all(session: AsyncSession, *, dry_run: bool = False) -> list[dict]:
    """Run every enabled source.

    Sequential on purpose. The board feeds are one request each and finish in seconds
    while a directory sweep is thousands, so running them together would hide the fast
    results behind the slow one. Each ScanRun is written as it completes, so the Runs
    tab fills in progressively instead of going quiet for ten minutes.
    """
    configs = await list_source_configs(session)
    summaries = []
    for source_id, row in configs.items():
        if not row.enabled:
            continue
        try:
            summaries.append(await scan_one(session, source_id, dry_run=dry_run))
        except Exception as exc:  # noqa: BLE001 — one bad source must not stop the rest
            logger.exception("source %s failed during scan_all", source_id)
            summaries.append({"source_id": source_id, "error": str(exc)})
    return summaries


async def preview_scan(
    session: AsyncSession,
    *,
    source_id: str = "tracked",
    overrides: Optional[dict] = None,
    limit_companies: Optional[int] = 25,
) -> dict:
    """Dry-run a source and return the funnel plus samples, writing nothing.

    Ingest filters are destructive, so tuning them with real scans means repeatedly
    polluting or starving the table. This is the safe way to iterate.
    """
    source = get_source(source_id)
    if source is None:
        raise ValueError(f"unknown source: {source_id}")

    config = await _config_for(session, overrides)
    settings = (await list_source_configs(session)).get(source_id)
    settings_blob = dict(settings.settings or {}) if settings else {}
    if limit_companies:
        settings_blob.setdefault("limit_per_ats", limit_companies)
        settings_blob["preview_limit"] = limit_companies

    result = await run_source(
        source, config, settings=settings_blob, session=session, collect_samples=True
    )
    return {
        "source_id": source_id,
        "counters": result.counters.as_dict(),
        "drops": result.counters.drops_as_lists(),
        "companies_scanned": result.companies_scanned,
        "errors": result.errors[:25],
    }


async def run_scheduled_scan() -> None:
    """Entry point for the APScheduler job."""
    from storage.db import get_session

    async with get_session() as session:
        for summary in await scan_all(session):
            if "error" in summary:
                logger.warning("source %s errored: %s", summary["source_id"], summary["error"])
                continue
            logger.info(
                "%s: %d found, %d added, %d refreshed, %d delisted",
                summary["source_id"],
                summary["counters"]["found"],
                summary["added"],
                summary["refreshed"],
                summary["delisted"],
            )


def available_sources() -> dict:
    return load_sources()
