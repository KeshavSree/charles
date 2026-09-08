"""The dead-board skip.

Directory datasets are community-maintained and nobody prunes them: probing a random
sample twice, 20s apart, every one of 137 failures reproduced and none flapped. These
tests pin the two properties that make skipping them safe -- a board leaves the list
the moment it answers, and no board is banned permanently.
"""
from datetime import datetime, timedelta, timezone

import pytest

from storage.models import DeadBoard
from storage.repository import (
    DEAD_AFTER_FAILURES,
    DEAD_RECHECK_DAYS,
    dead_board_keys,
    record_board_outcomes,
)

GH = "greenhouse"


async def test_one_failure_is_not_enough_to_skip(db_session):
    """A single failure could be a network blip, so it only starts a streak."""
    await record_board_outcomes(db_session, [(GH, "curalate", False, "slug_gone", "HTTP 404")])
    assert await dead_board_keys(db_session) == set()


async def test_board_is_skipped_after_the_threshold(db_session):
    for _ in range(DEAD_AFTER_FAILURES):
        await record_board_outcomes(db_session, [(GH, "curalate", False, "slug_gone", "HTTP 404")])
    assert (GH, "curalate") in await dead_board_keys(db_session)


async def test_a_board_that_answers_again_drops_off_the_list(db_session):
    for _ in range(DEAD_AFTER_FAILURES):
        await record_board_outcomes(db_session, [(GH, "github", False, "slug_gone", "HTTP 404")])
    assert (GH, "github") in await dead_board_keys(db_session)

    await record_board_outcomes(db_session, [(GH, "github", True, "reachable", "")])
    assert await dead_board_keys(db_session) == set()
    assert (await db_session.get(DeadBoard, (GH, "github"))) is None


async def test_success_and_absence_are_the_same_state(db_session):
    """A healthy board never occupies a row, so the table only holds broken ones."""
    await record_board_outcomes(db_session, [(GH, "stripe", True, "reachable", "")])
    assert (await db_session.get(DeadBoard, (GH, "stripe"))) is None


async def test_skip_expires_so_a_revived_board_is_retried(db_session):
    """Nothing is banned forever: past the re-check window the board is requested
    again, which is the only way a company that returns to an ATS is rediscovered."""
    for _ in range(DEAD_AFTER_FAILURES):
        await record_board_outcomes(db_session, [(GH, "irobot", False, "slug_gone", "HTTP 404")])
    row = await db_session.get(DeadBoard, (GH, "irobot"))
    row.last_checked_at = datetime.now(tz=timezone.utc) - timedelta(days=DEAD_RECHECK_DAYS + 1)
    await db_session.commit()

    assert await dead_board_keys(db_session) == set()


async def test_slug_is_namespaced_by_provider(db_session):
    """"apex" exists on Lever and Greenhouse as different companies."""
    for _ in range(DEAD_AFTER_FAILURES):
        await record_board_outcomes(db_session, [("lever", "apex", False, "slug_gone", "404")])
    keys = await dead_board_keys(db_session)
    assert ("lever", "apex") in keys
    assert (GH, "apex") not in keys


async def test_outcomes_report_what_changed(db_session):
    stats = await record_board_outcomes(db_session, [
        (GH, "a", False, "slug_gone", ""), (GH, "b", False, "auth", ""),
        (GH, "c", True, "reachable", ""),
    ])
    assert stats == {"marked": 2, "revived": 0}

    for _ in range(DEAD_AFTER_FAILURES):
        await record_board_outcomes(db_session, [(GH, "a", False, "slug_gone", "")])
    stats = await record_board_outcomes(db_session, [(GH, "a", True, "reachable", "")])
    assert stats["revived"] == 1


async def test_empty_outcomes_is_a_noop(db_session):
    assert await record_board_outcomes(db_session, []) == {"marked": 0, "revived": 0}


async def test_build_directory_entries_skips_without_requesting():
    """The skip happens while the entry list is built, so a dead board costs no
    request at all -- that is the entire point of the feature."""
    from scanner.directory import build_directory_entries

    config = {"ats_sources": ["greenhouse"]}
    all_pairs, meta_all = await build_directory_entries(config)
    if not all_pairs:
        pytest.skip("greenhouse directory dataset not cached locally")

    victim = all_pairs[0]
    skip = {(victim[1].id, victim[0].name)}
    kept, meta = await build_directory_entries(config, skip=skip)

    assert meta["skipped_dead"] == 1
    assert meta["scanned"] == meta_all["scanned"] - 1
    assert all(e.name != victim[0].name for e, _ in kept)


async def test_a_large_batch_is_written_in_chunks(db_session, monkeypatch):
    """A directory sweep hands back ~28,700 outcomes. Committing them in one go stalls
    the event loop long enough that /scanner/progress stops answering, which the UI
    reads as having lost the server."""
    import storage.repository as repo

    monkeypatch.setattr(repo, "DEAD_BOARD_WRITE_CHUNK", 100)
    outcomes = [(GH, f"slug{i}", False, "slug_gone", "404") for i in range(250)]

    commits = 0
    original = db_session.commit

    async def counting_commit():
        nonlocal commits
        commits += 1
        await original()

    monkeypatch.setattr(db_session, "commit", counting_commit)
    stats = await record_board_outcomes(db_session, outcomes)

    assert stats["marked"] == 250
    assert commits >= 3          # two chunk commits plus the final one
    keys = {k[1] for k in await dead_board_keys(db_session)}
    assert len(keys) == 0        # one failure each; not yet over the threshold
