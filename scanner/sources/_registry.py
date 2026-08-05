"""Source discovery. Mirrors `scanner/registry.py` so the two extension points feel
the same: adding a source is dropping a file into `scanner/sources/`.

Modules whose name starts with `_` are shared helpers, never loaded as sources.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CACHE: Optional[dict[str, Any]] = None


def load_sources(refresh: bool = False) -> dict[str, Any]:
    """Discover every source module into an id -> source mapping.

    A malformed source is logged and skipped rather than fatal. One broken feed must
    not stop the other fourteen from scanning.
    """
    global _CACHE
    if _CACHE is not None and not refresh:
        return _CACHE

    import scanner.sources as pkg

    sources: dict[str, Any] = {}
    names = sorted(
        m.name for m in pkgutil.iter_modules(pkg.__path__) if not m.name.startswith("_")
    )
    for name in names:
        try:
            module = importlib.import_module(f"scanner.sources.{name}")
        except Exception:
            logger.exception("source %s: failed to import — skipping", name)
            continue
        source = getattr(module, "SOURCE", None)
        if source is None or not hasattr(source, "scan") or not getattr(source, "id", ""):
            logger.error("source %s: skipping — must export SOURCE with .id and .scan", name)
            continue
        if source.id in sources:
            logger.error("source %s: duplicate id %r — keeping first", name, source.id)
            continue
        sources[source.id] = source

    _CACHE = sources
    return sources


def get_source(source_id: str) -> Optional[Any]:
    return load_sources().get(source_id)
