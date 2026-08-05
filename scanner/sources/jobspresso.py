"""Jobspresso — public WP job-feed RSS."""
from __future__ import annotations

from scanner.sources._board import make_rss_board

SOURCE = make_rss_board(
    "jobspresso", url="https://jobspresso.co/?feed=job_feed",
    label="Jobspresso", location_tag="job_listing:location",
)
