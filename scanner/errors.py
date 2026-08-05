"""Fetch-error classification. Ported from `verify-portals.mjs:classifyFetchError`.

The categories drive BoardHealth: `slug_gone` means the board token is wrong (the
failure mode that silently hid 14 of charles's 24 configured companies), while
`network` is transient and should not be read as a dead board.
"""
from __future__ import annotations

import re

from scanner.http import FetchError

_NETWORK_RE = re.compile(r"ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout|network error", re.I)


def classify_fetch_error(exc: BaseException | None) -> str:
    """-> network | slug_gone | auth | server | unknown"""
    if exc is None:
        return "unknown"

    status = getattr(exc, "status", None)
    if status == 404 or status == 410:
        return "slug_gone"
    if status == 401 or status == 403:
        return "auth"
    if isinstance(status, int) and status >= 500:
        return "server"

    message = str(exc)
    if isinstance(exc, FetchError) and status is None:
        return "network"
    if _NETWORK_RE.search(message):
        return "network"
    if re.search(r"HTTP 40[48]|HTTP 410", message):
        return "slug_gone"
    if re.search(r"HTTP 40[13]", message):
        return "auth"
    if re.search(r"HTTP 5\d\d", message):
        return "server"
    return "unknown"
