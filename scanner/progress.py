"""Authoritative state of the scan this process is running.

A sweep takes tens of minutes. It used to run *inside* the POST that started it, which
made the UI's idea of "is a scan happening" a property of one browser tab's fetch: the
proxy timed out at five minutes, the tab showed "Failed", and the sweep carried on
invisibly. Refreshing showed nothing. Clicking again started a *second* sweep whose
counters landed in the same place, so progress read 42,435 of 28,746.

So the run lives here, not in a request. Requests start it, cancel it, and read it;
none of them own it. Any number of tabs polling `snapshot()` see the same truth, and a
reload sees whatever is actually happening.

In memory on purpose: progress is meaningless once the process dies, and a restart
should say "nothing running" rather than resurrect a phantom from a table.

Writes need no lock -- asyncio is single threaded and nothing here awaits between read
and write -- but they *do* need to be attributed, which is what `_token` is for. A
cancelled sweep's workers keep unwinding for a moment after a new run starts, and
their late `advance()` calls must not land on the new run's counters.
"""
from __future__ import annotations

import asyncio
import contextvars
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

# Set inside the task that owns a run, so every mutation it makes -- however deep in
# the provider stack -- carries the run's identity without threading a parameter
# through `scan_all` -> `scan_one` -> `run_source` -> `scan_boards`.
_token: contextvars.ContextVar[str] = contextvars.ContextVar("scan_run_token", default="")


@dataclass
class Stage:
    """One source's slice of a run."""

    id: str
    label: str
    status: str = "pending"      # pending | running | done | failed | cancelled
    done: int = 0
    # None until a source declares a denominator: single-request feeds never do, and a
    # board sweep only knows its count once the directory resolves.
    total: Optional[int] = None
    kept: int = 0
    found: int = 0
    added: int = 0
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    detail: str = ""

    @property
    def fraction(self) -> Optional[float]:
        if self.status in ("done", "cancelled"):
            return 1.0
        if not self.total:
            return None
        # Clamped because a denominator can be revised mid-stage; a bar that reads
        # 148% is worse than one that sits at 100% for a moment.
        return max(0.0, min(self.done / self.total, 1.0))


@dataclass
class Run:
    id: str
    token: str
    stages: list[Stage] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    status: str = "running"      # running | completed | failed | cancelled
    error: str = ""

    @property
    def active(self) -> bool:
        return self.finished_at is None


_run: Optional[Run] = None
# The most recently finished run, kept so a tab that reloads just after a sweep ends
# still learns how it went instead of seeing a blank page. It ages out rather than
# lingering: a "Scan complete" banner that never leaves is its own kind of lie, and
# expiring it here keeps the server the only thing deciding what the UI shows.
_last: Optional[Run] = None
LAST_RUN_TTL_S = 300
_task: Optional[asyncio.Task] = None


def is_active() -> bool:
    return _run is not None and _run.active


def begin(sources: list[tuple[str, str]]) -> Optional[str]:
    """Claim the tracker for a new run, or return None if one is already going.

    Refusing here is what stops a second click from starting a competing sweep --
    which is how two runs came to share one set of counters, and how the same ATS
    hosts came to be hit at twice the configured concurrency.
    """
    global _run
    if is_active():
        return None
    run_id = uuid.uuid4().hex[:12]
    _run = Run(id=run_id, token=uuid.uuid4().hex,
               stages=[Stage(id=i, label=l) for i, l in sources])
    _token.set(_run.token)
    return run_id


def _mine() -> Optional[Run]:
    """The run this caller belongs to, or None if it is a straggler from a dead one."""
    if _run is None or not _run.active:
        return None
    return _run if _token.get() == _run.token else None


def current_stage() -> Optional[Stage]:
    run = _mine()
    if run is None or not run.stages:
        return None
    stage = next((s for s in run.stages if s.status == "running"), None)
    return stage


def begin_stage(source_id: str) -> None:
    run = _mine()
    if run is None:
        return
    for stage in run.stages:
        if stage.id == source_id:
            stage.status = "running"
            stage.started_at = time.time()
            return


def set_total(total: int, *, detail: str = "") -> None:
    """Declare the running stage's denominator once it is known."""
    stage = current_stage()
    if stage is not None:
        stage.total = total
        if detail:
            stage.detail = detail


def advance(n: int = 1) -> None:
    stage = current_stage()
    if stage is not None:
        stage.done += n


def set_counts(found: int, kept: int) -> None:
    stage = current_stage()
    if stage is not None:
        stage.found = found
        stage.kept = kept


def end_stage(source_id: str, *, failed: bool = False, added: int = 0) -> None:
    run = _mine()
    if run is None:
        return
    for stage in run.stages:
        if stage.id == source_id:
            stage.status = "failed" if failed else "done"
            stage.finished_at = time.time()
            stage.added = added
            return


def _finalize(run: Run, status: str, error: str) -> None:
    global _run, _last
    run.finished_at = time.time()
    run.status = status
    run.error = error
    # No stage may outlive the run still claiming to be running: the panel reads
    # these directly, and a gold "running" chip under a "Scan failed" header is
    # exactly the sort of half-truth this module exists to prevent.
    for stage in run.stages:
        if stage.status == "running":
            stage.status = "cancelled" if status == "cancelled" else "failed"
            stage.finished_at = stage.finished_at or time.time()
        elif stage.status == "pending" and status in ("cancelled", "failed"):
            stage.status = "cancelled"
    _last, _run = run, None


def end(status: str = "completed", error: str = "") -> None:
    """Finish the run this caller owns. A straggler from a dead run is ignored."""
    run = _mine()
    if run is not None:
        _finalize(run, status, error)


def register_task(task: asyncio.Task) -> None:
    global _task
    _task = task


async def cancel() -> bool:
    """Stop the running sweep. Returns False when there was nothing to stop.

    Finalizes the run here rather than trusting the task's own handler: a task
    cancelled before it first runs never executes its `except CancelledError` block at
    all, which left the run marked active forever when Stop was clicked immediately
    after Start.
    """
    global _task
    run = _run
    if run is None or not run.active:
        return False
    if _task is not None and not _task.done():
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001 — recorded below
            pass
    _task = None
    if _run is run and run.active:
        _finalize(run, "cancelled", "")
    return True


def _run_dict(run: Run) -> dict:
    now = time.time()
    stages = [
        {
            "id": s.id, "label": s.label, "status": s.status,
            "done": s.done, "total": s.total, "fraction": s.fraction,
            "found": s.found, "kept": s.kept, "added": s.added,
            "elapsed": None if s.started_at is None
            else round((s.finished_at or now) - s.started_at, 1),
        }
        for s in run.stages
    ]
    stage = next((s for s in run.stages if s.status == "running"), None)
    index = run.stages.index(stage) if stage is not None else len(run.stages) - 1
    return {
        "run_id": run.id,
        "active": run.active,
        "status": run.status,
        "error": run.error,
        "elapsed": round((run.finished_at or now) - run.started_at, 1),
        "started_at": run.started_at,
        "stage_index": max(index, 0),
        "stage_count": len(run.stages),
        "completed": sum(1 for s in run.stages if s.status in ("done", "failed", "cancelled")),
        "kept": sum(s.kept for s in run.stages),
        "added": sum(s.added for s in run.stages),
        "current": None if stage is None else {
            "id": stage.id, "label": stage.label, "done": stage.done,
            "total": stage.total, "fraction": stage.fraction,
            "found": stage.found, "kept": stage.kept, "detail": stage.detail,
            "elapsed": round(now - (stage.started_at or now), 1),
        },
        "stages": stages,
    }


def snapshot() -> dict:
    """What `/api/scanner/progress` returns: the live run, else the last finished one.

    `active` is the only flag the UI needs to decide whether a scan is happening, and
    it comes from the server every time -- never from what a tab remembers doing.
    """
    if _run is not None:
        return _run_dict(_run)
    if _last is not None and (time.time() - (_last.finished_at or 0)) < LAST_RUN_TTL_S:
        return {**_run_dict(_last), "active": False}
    return {"active": False, "status": "idle", "stages": [], "run_id": None}


def reset() -> None:
    global _run, _last, _task
    _run = _last = _task = None
