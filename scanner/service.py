"""Glue between the source registry and the database.

Everything the API and the scheduler call goes through here, so a scan triggered from
the web UI and one triggered on a timer behave identically.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from scanner import progress
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

    # Marks this source as the running stage. The *run* is claimed by whoever started
    # it (`start_run`), never here: scan_one used to claim it opportunistically, which
    # is how a second sweep could reset counters the first was still writing to.
    progress.begin_stage(source_id)
    try:
        result: ScanResult = await run_source(
            source, config, settings=settings_blob, session=session
        )
    except asyncio.CancelledError:
        # A cancelled sweep must not leave the row saying "running" forever, which is
        # what stranded three rows in scan_runs when a scan was killed by signal.
        progress.end_stage(source_id, failed=True)
        await finish_scan_run(session, run, {"status": "cancelled"})
        raise
    except Exception:
        progress.end_stage(source_id, failed=True)
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
    progress.end_stage(source_id, added=added)

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
    summaries = []
    for source_id in await enabled_source_ids(session):
        try:
            summaries.append(await scan_one(session, source_id, dry_run=dry_run))
        except asyncio.CancelledError:
            raise  # cancellation is for the whole run, not one source
        except Exception as exc:  # noqa: BLE001 — one bad source must not stop the rest
            logger.exception("source %s failed during scan_all", source_id)
            summaries.append({"source_id": source_id, "error": str(exc)})
    return summaries


async def enabled_source_ids(session: AsyncSession) -> list[str]:
    configs = await list_source_configs(session)
    return [sid for sid, row in configs.items() if row.enabled]


def _label(source_id: str) -> str:
    source = get_source(source_id)
    return getattr(source, "label", source_id) if source else source_id


async def start_run(
    *, source_id: Optional[str] = None, all_sources: bool = False, dry_run: bool = False,
    overrides: Optional[dict] = None, wait: bool = False,
) -> dict:
    """Start a sweep in the background and return immediately.

    The run deliberately outlives the request that starts it. Running it *inside* the
    POST tied "is a scan happening" to one browser tab's fetch: the dev proxy gave up
    after five minutes, the tab reported failure, and the sweep kept going unseen.
    Now the request only asks for a run and gets back its id; every client learns the
    state the same way, by reading `/progress`.
    """
    from storage.db import get_session

    if progress.is_active():
        # Refusing is the point. Two concurrent sweeps shared one set of counters
        # (progress once read 42,435 of 28,746) and doubled the load on the same ATS
        # hosts. A second click now just attaches to the run already going.
        return {"started": False, "reason": "already_running", **progress.snapshot()}

    async with get_session() as session:
        stages = (
            [(sid, _label(sid)) for sid in await enabled_source_ids(session)]
            if all_sources else [(source_id or "", _label(source_id or ""))]
        )
    if not stages or not stages[0][0]:
        raise ValueError("source_id or all is required")

    run_id = progress.begin(stages)
    if run_id is None:                      # lost a race with another starter
        return {"started": False, "reason": "already_running", **progress.snapshot()}

    async def owner() -> None:
        # Its own session: the request that started the run is long gone, and its
        # session with it.
        try:
            async with get_session() as session:
                if all_sources:
                    await scan_all(session, dry_run=dry_run)
                else:
                    await scan_one(session, source_id, dry_run=dry_run, overrides=overrides)
            progress.end("completed")
        except asyncio.CancelledError:
            progress.end("cancelled")
            raise
        except Exception as exc:  # noqa: BLE001 — surfaced through the snapshot
            logger.exception("scan run %s failed", run_id)
            progress.end("failed", str(exc))

    task = asyncio.create_task(owner(), name=f"scan-{run_id}")
    progress.register_task(task)
    if wait:
        # The scheduler has no client to poll, so it blocks until the sweep is done.
        # It still goes through this path so a timed run claims the tracker, shows up
        # in the UI, and cannot overlap a manual one.
        with contextlib.suppress(asyncio.CancelledError):
            await task
    return {"started": True, "run_id": run_id, **progress.snapshot()}


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

    # A preview is capped but still not instant, so it gets a bar too. `finally` is
    # load-bearing: leaving the tracker active would strand the UI on a phantom run
    # and stop the next real scan from claiming it.
    progress.begin([(source_id, getattr(source, "label", source_id))])
    progress.begin_stage(source_id)
    try:
        result = await run_source(
            source, config, settings=settings_blob, session=session, collect_samples=True
        )
    finally:
        progress.end_stage(source_id)
        progress.end()
    return {
        "source_id": source_id,
        "counters": result.counters.as_dict(),
        "drops": result.counters.drops_as_lists(),
        "companies_scanned": result.companies_scanned,
        "errors": result.errors[:25],
    }


async def run_scheduled_scan() -> None:
    """Entry point for the APScheduler job.

    Deliberately the same path as a button press. A timed sweep that bypassed the
    tracker would be invisible to the UI and could overlap a manual one, which is how
    two sweeps came to share one set of counters.
    """
    result = await start_run(all_sources=True, wait=True)
    if not result.get("started"):
        logger.info("scheduled scan skipped: a scan is already running")
        return
    logger.info(
        "scheduled scan %s: %s, %d kept, %d added",
        result.get("run_id"), result.get("status"), result.get("kept", 0), result.get("added", 0),
    )


def available_sources() -> dict:
    return load_sources()
