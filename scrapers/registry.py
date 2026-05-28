from __future__ import annotations

from typing import Type

import httpx

from scrapers.base import BaseScraper

SCRAPER_REGISTRY: dict[str, Type[BaseScraper]] = {}


def register(source_name: str):
    """Class decorator that registers a BaseScraper subclass.

    Usage::

        @register("greenhouse")
        class GreenhouseScraper(BaseScraper):
            ...

    Raises:
        ValueError: If source_name is already registered.
    """
    def decorator(cls: Type[BaseScraper]) -> Type[BaseScraper]:
        if source_name in SCRAPER_REGISTRY:
            raise ValueError(
                f"Scraper already registered for source '{source_name}'. "
                f"Existing: {SCRAPER_REGISTRY[source_name].__name__}, "
                f"New: {cls.__name__}"
            )
        SCRAPER_REGISTRY[source_name] = cls
        return cls

    return decorator


def get_scraper(source_name: str, client: httpx.AsyncClient) -> BaseScraper:
    """Instantiate a registered scraper by source name.

    Raises:
        KeyError: If source_name is not in the registry.
    """
    if source_name not in SCRAPER_REGISTRY:
        raise KeyError(
            f"No scraper registered for source '{source_name}'. "
            f"Available: {list(SCRAPER_REGISTRY.keys())}"
        )
    return SCRAPER_REGISTRY[source_name](client)
