"""Reverse discovery across public per-ATS company directories.

No coverage ceiling, which is exactly why the reverse profile's freshness gate is
mandatory rather than optional. Sweeping 8,000 boards without one is a firehose of
stale requisitions.
"""
from __future__ import annotations

from scanner.directory import build_directory_entries
from scanner.runner import SourceContext


class DirectorySource:
    id = "directory"
    label = "ATS directories"
    profile = "reverse"

    async def scan(self, sctx: SourceContext) -> None:
        from scanner.sources._ats import scan_boards
        from storage.repository import dead_board_keys, record_board_outcomes

        # Settings live on the source, not the global filter config: which directories
        # to walk and how many companies to sample are properties of *this* source.
        config = {**sctx.config, **sctx.settings}

        # Boards that have failed every recent sweep are dropped before the entry list
        # is built, so they cost nothing. The datasets are community-maintained and
        # nobody prunes them: a measured ~46% of slugs are simply gone.
        skip = await dead_board_keys(sctx.session) if sctx.session else set()
        pairs, meta = await build_directory_entries(config, skip=skip)

        sctx.result.companies_available = meta["available"]
        sctx.result.companies_scanned = meta["scanned"]
        sctx.result.boards_skipped_dead = meta["skipped_dead"]
        sctx.result.cap_hit = meta["cap_hit"]
        sctx.result.dataset_status = meta["dataset_status"]

        # Health is skipped: thousands of rows per run would swamp the table, and a
        # defunct board in a public dataset is expected noise, not a config problem.
        await scan_boards(sctx, pairs, collect_health=False)

        # Fold this run's results back in, so newly dead boards start a streak and any
        # board that answered again drops off the list.
        if sctx.session:
            await record_board_outcomes(sctx.session, sctx.result.board_outcomes)


SOURCE = DirectorySource()
