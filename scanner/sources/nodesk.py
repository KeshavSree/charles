"""NoDesk — public remote-jobs XML feed."""
from __future__ import annotations

from scanner.sources._board import make_rss_board

SOURCE = make_rss_board(
    "nodesk", url="https://nodesk.co/remote-jobs/index.xml", label="NoDesk",
)
