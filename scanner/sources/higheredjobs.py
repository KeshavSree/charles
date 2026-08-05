"""HigherEdJobs — category RSS feed (catID 68 = computing/technology)."""
from __future__ import annotations

from scanner.sources._board import make_rss_board

SOURCE = make_rss_board(
    "higheredjobs",
    url="https://www.higheredjobs.com/rss/categoryFeed.cfm?catID=68",
    label="HigherEdJobs",
)
