"""Provider discovery + routing. Ported from `providers/_registry.mjs`.

Adding an ATS is dropping a file into `scanner/providers/`. Modules whose name starts
with `_` are shared helpers, never loaded as providers.

Load order is alphabetical so `detect()` priority is deterministic across machines —
two providers that both claim a URL must resolve the same way every run.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Any, Optional

from scanner.types import PortalEntry

logger = logging.getLogger(__name__)

_CACHE: Optional[dict[str, Any]] = None


def load_providers(refresh: bool = False) -> dict[str, Any]:
    """Discover every provider module into an id -> provider mapping.

    Malformed modules (import error, wrong shape, duplicate id) are logged and
    skipped, never fatal — one broken provider must not take down the whole scan.
    """
    global _CACHE
    if _CACHE is not None and not refresh:
        return _CACHE

    import scanner.providers as pkg

    providers: dict[str, Any] = {}
    names = sorted(
        m.name for m in pkgutil.iter_modules(pkg.__path__) if not m.name.startswith("_")
    )
    for name in names:
        try:
            module = importlib.import_module(f"scanner.providers.{name}")
        except Exception:
            logger.exception("provider %s: failed to import — skipping", name)
            continue

        provider = getattr(module, "PROVIDER", None)
        if provider is None or not hasattr(provider, "fetch") or not getattr(provider, "id", ""):
            logger.error("provider %s: skipping — must export PROVIDER with .id and .fetch", name)
            continue
        if provider.id in providers:
            logger.error("provider %s: duplicate id %r — keeping first", name, provider.id)
            continue
        providers[provider.id] = provider

    _CACHE = providers
    return providers


def resolve_provider(
    entry: PortalEntry, providers: Optional[dict[str, Any]] = None
) -> tuple[Optional[Any], Optional[str]]:
    """Pick the provider that handles an entry.

    Precedence:
      1. An explicit `entry.provider` wins and skips detection entirely.
      2. Otherwise each provider's `detect()` runs in load order; first hit wins.

    Returns (provider, error). A detect() that raises is logged and skipped rather
    than aborting resolution — a malformed careers_url must not kill the run.
    """
    providers = providers if providers is not None else load_providers()

    if entry.provider:
        found = providers.get(entry.provider)
        if not found:
            return None, f"unknown provider: {entry.provider}"
        return found, None

    for provider in providers.values():
        try:
            if provider.detect(entry):
                return provider, None
        except Exception as exc:  # noqa: BLE001 — a bad entry must not abort resolution
            logger.debug("provider %s: detect() raised for %r — %s", provider.id, entry.name, exc)
            continue
    return None, None
