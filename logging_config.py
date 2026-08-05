"""Centralized logging configuration (top-level module, like config.py).

Call `configure_logging()` once at each process entry point (the API app's
lifespan and the scheduler's `main`). Named `logging_config` rather than `logging`
so it does not shadow the standard library.
"""
from __future__ import annotations

import logging

from config import Settings

_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"

_configured = False


def configure_logging(level: str | None = None) -> None:
    """Initialize root logging. Idempotent — safe to call from multiple entry points.

    Level comes from the argument, else `LOG_LEVEL` (via Settings), else INFO.
    """
    global _configured
    if _configured:
        return

    resolved = (level or Settings().log_level or "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, resolved, logging.INFO),
        format=_FORMAT,
        datefmt=_DATEFMT,
        force=True,
    )
    _configured = True
