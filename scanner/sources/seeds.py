"""VC portfolio companies, probed for an ATS board.

Catches early-stage companies that are on nobody's curated list and may not have
reached the public ATS directory dataset yet.
"""
from __future__ import annotations

from scanner.runner import SourceContext
from scanner.seeds import SEED_SOURCES, build_seed_entries


class SeedsSource:
    id = "seeds"
    label = "YC and A16Z direct ATS Greenhouse/Ashby/Lever"
    profile = "reverse"

    async def scan(self, sctx: SourceContext) -> None:
        from scanner.sources._ats import scan_boards

        lists = sctx.settings.get("lists") or list(SEED_SOURCES.keys())
        config = {**sctx.config, **sctx.settings}
        pairs, meta = await build_seed_entries(config, lists)

        sctx.result.companies_available = meta["available"]
        sctx.result.companies_scanned = meta["scanned"]

        await scan_boards(sctx, pairs, collect_health=False)


SOURCE = SeedsSource()
