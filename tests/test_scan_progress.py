"""Scan progress: the server's single answer to "is a scan running".

Every one of these pins a failure that actually happened. The run used to live inside
the POST that started it, so "running" was a property of one browser tab's fetch: the
dev proxy timed out at five minutes, the tab reported failure, and the sweep carried on
unseen. Clicking again started a second sweep whose counters landed in the same place,
and progress read 42,435 of 28,746.
"""
import asyncio
import contextvars

import pytest

from scanner import progress

SOURCES = [("directory", "ATS directories"), ("remoteok", "RemoteOK")]


@pytest.fixture(autouse=True)
def clean():
    progress.reset()
    yield
    progress.reset()


def test_idle_snapshot_is_inactive():
    snap = progress.snapshot()
    assert snap["active"] is False
    assert snap["status"] == "idle"
    assert snap["run_id"] is None


def test_begin_returns_a_run_id_and_goes_active():
    run_id = progress.begin(SOURCES)
    assert run_id
    snap = progress.snapshot()
    assert snap["active"] is True
    assert snap["run_id"] == run_id
    assert snap["stage_count"] == 2


def test_a_second_run_is_refused_while_one_is_active():
    """Two concurrent sweeps shared one set of counters and doubled the request rate
    against the same ATS hosts."""
    first = progress.begin(SOURCES)
    assert progress.begin(SOURCES) is None
    assert progress.snapshot()["run_id"] == first


def test_a_new_run_is_allowed_once_the_previous_one_ends():
    progress.begin(SOURCES)
    progress.end()
    assert progress.begin(SOURCES) is not None


def test_fraction_never_exceeds_one():
    """The bar read 148% when two sweeps advanced the same stage."""
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.set_total(28746)
    progress.advance(42435)
    assert progress.snapshot()["current"]["fraction"] == 1.0


def test_a_stale_writer_cannot_touch_the_current_run():
    """A cancelled sweep's workers keep unwinding briefly. Their late advance() calls
    must not land on the counters of the run that replaced it."""
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.set_total(100)
    progress.advance(10)
    progress.end("cancelled")

    # A fresh run, started in this same context as a new "owner".
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.set_total(100)

    def straggler():
        # The dead run's task carries the old token in its own context copy, exactly
        # as an in-flight worker would after its run was replaced.
        progress._token.set("a-dead-run-token")
        progress.advance(500)

    contextvars.copy_context().run(straggler)
    assert progress.snapshot()["current"]["done"] == 0


def test_the_last_finished_run_survives_for_a_reload():
    """A tab reloading just after a sweep ends should learn how it went, not see a
    blank page."""
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.set_counts(1000, 7)
    progress.end_stage("directory", added=7)
    progress.end("completed")

    snap = progress.snapshot()
    assert snap["active"] is False
    assert snap["status"] == "completed"
    assert snap["added"] == 7


def test_cancellation_is_reported_as_its_own_status():
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.end("cancelled")
    assert progress.snapshot()["status"] == "cancelled"


def test_failure_carries_its_message():
    progress.begin(SOURCES)
    progress.end("failed", "boom")
    snap = progress.snapshot()
    assert snap["status"] == "failed"
    assert snap["error"] == "boom"


def test_pending_stages_are_marked_cancelled_not_left_running():
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.end("cancelled")
    statuses = {s["id"]: s["status"] for s in progress.snapshot()["stages"]}
    assert statuses["directory"] == "cancelled"
    assert statuses["remoteok"] == "cancelled"


async def test_cancel_with_nothing_running_is_not_an_error():
    assert await progress.cancel() is False


def test_a_finished_run_ages_out_of_the_snapshot(monkeypatch):
    """Otherwise "Scan complete" sits on the page indefinitely, which is just a
    different way for the UI to show something that is not currently true."""
    progress.begin(SOURCES)
    progress.end("completed")
    assert progress.snapshot()["status"] == "completed"

    monkeypatch.setattr(progress, "LAST_RUN_TTL_S", -1)
    assert progress.snapshot()["status"] == "idle"
    assert progress.snapshot()["active"] is False


def test_a_failed_run_leaves_no_stage_claiming_to_be_running():
    """A gold "running" chip under a "Scan failed" header is the same class of
    half-truth as a bar that keeps moving after the scan died."""
    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.end("failed", "boom")

    statuses = {s["id"]: s["status"] for s in progress.snapshot()["stages"]}
    assert statuses["directory"] == "failed"
    assert statuses["remoteok"] == "cancelled"
    assert "running" not in statuses.values()


def test_snapshot_shape_matches_the_typescript_interface():
    """The UI trusts this payload completely, so a field the server adds and the
    client never declares is a silent desync waiting to happen. Compares the live
    snapshot's keys against `frontend/lib/api.ts` rather than a copy of them.
    """
    import pathlib
    import re

    ts_path = pathlib.Path(__file__).resolve().parents[1] / "frontend" / "lib" / "api.ts"
    ts = ts_path.read_text()

    def declared(interface: str) -> set[str]:
        block = re.search(rf"export interface {interface} \{{(.*?)\n\}}", ts, re.S)
        assert block, f"{interface} not found in api.ts"
        return set(re.findall(r"^\s*(\w+)\??:", block.group(1), re.M))

    progress.begin(SOURCES)
    progress.begin_stage("directory")
    progress.set_total(10)
    progress.advance(1)
    snap = progress.snapshot()

    assert set(snap) <= declared("ScanProgress"), "server sends a field the UI never declares"
    stage_fields = declared("ScanStage")
    assert set(snap["stages"][0]) <= stage_fields
    assert set(snap["current"]) - {"detail"} <= stage_fields
