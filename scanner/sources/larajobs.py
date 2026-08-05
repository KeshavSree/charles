"""LaraJobs — Laravel/PHP jobs RSS feed."""
from __future__ import annotations

from scanner.sources._board import make_rss_board

SOURCE = make_rss_board(
    "larajobs", url="https://larajobs.com/feed", label="LaraJobs",
    location_tag="job:location",
)
