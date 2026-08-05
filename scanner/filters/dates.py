"""Date filters and the reverse-scan freshness gate.

`classify_posting_date` is the single age gate, applied identically to every source.
An undated posting is dropped unless `include_undated` is set, which matters because a
bounded window and "keep things with no date" are contradictory by default.

`build_posted_date_filter` is a separate, optional absolute-bounds filter, unused by the
UI today.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Optional

DAY_MS = 86_400_000


def _now_ms() -> int:
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def build_posted_date_filter(
    after_iso: Optional[str], before_iso: Optional[str]
) -> Callable[[Optional[int]], bool]:
    """Absolute bounds, both inclusive; `before` is treated as end-of-day."""

    def _parse(value: Optional[str], end_of_day: bool) -> Optional[int]:
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if end_of_day:
            parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999000)
        return int(parsed.timestamp() * 1000)

    after_ms = _parse(after_iso, False)
    before_ms = _parse(before_iso, True)
    if after_ms is None and before_ms is None:
        return lambda posted_at: True

    def matches(posted_at: Optional[int]) -> bool:
        if not isinstance(posted_at, int):
            return True
        if after_ms is not None and posted_at < after_ms:
            return False
        if before_ms is not None and posted_at > before_ms:
            return False
        return True

    return matches


def classify_posting_date(posted_at: Optional[int], cutoff_ms: int) -> str:
    """-> 'stale' | 'undated' | 'keep'

    'stale' is always dropped. 'undated' is dropped unless include_undated is set, but
    is counted separately so a caller can tell "nothing was fresh" from "nothing had a
    date" — those need very different responses.
    """
    if isinstance(posted_at, int) and posted_at < cutoff_ms:
        return "stale"
    if not isinstance(posted_at, int):
        return "undated"
    return "keep"
