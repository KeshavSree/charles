"""Your own curated company list. The company-first path.

Coverage is bounded by the `tracked_companies` table, which is the tradeoff: you only
see what you asked for, but you see the *whole* board rather than only fresh postings,
and every company gets health tracking and delisting.
"""
from __future__ import annotations

from scanner.runner import SourceContext
from scanner.sources._ats import resolve_entries, scan_boards
from scanner.types import PortalEntry


class TrackedSource:
    id = "tracked"
    label = "My companies"
    # Full chain: a tracked board is being mirrored, so undated postings still pass.
    profile = "tracked"

    async def scan(self, sctx: SourceContext) -> None:
        from storage.repository import list_tracked_companies

        if sctx.session is None:
            raise ValueError("tracked source requires a database session")

        rows = await list_tracked_companies(sctx.session, enabled_only=True)
        entries = [
            PortalEntry(
                name=row.name,
                careers_url=row.careers_url or "",
                api=row.api_url,
                provider=row.provider,
                enabled=row.enabled,
                max_pages=row.max_pages,
            )
            for row in rows
        ]

        # Preview runs a subset so tuning filters stays fast.
        limit = sctx.settings.get("preview_limit")
        if limit:
            entries = entries[: int(limit)]

        pairs, unresolved = resolve_entries(entries)
        sctx.result.companies_available = len(entries)
        sctx.result.companies_scanned = len(pairs)

        for item in unresolved:
            sctx.result.errors.append({**item, "kind": "unresolved"})
            sctx.result.health.append(
                {"company": item["company"], "status": "unknown", "detail": item["error"]}
            )

        await scan_boards(sctx, pairs, collect_health=True)


SOURCE = TrackedSource()
