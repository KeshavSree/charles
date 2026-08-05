"""We Work Remotely — public RSS feed."""
from __future__ import annotations

from scanner.sources._board import make_rss_board

SOURCE = make_rss_board(
    "weworkremotely", url="https://weworkremotely.com/remote-jobs.rss",
    label="We Work Remotely", location_tag="region",
)
