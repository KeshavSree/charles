# api/routers/scraper.py
from __future__ import annotations

import logging

from fastapi import APIRouter

import scrapers.ashby  # noqa: F401 — triggers @register
import scrapers.greenhouse  # noqa: F401 — triggers @register
import scrapers.lever  # noqa: F401 — triggers @register
from scheduler import run_all_scrapers

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/scraper/run")
async def trigger_scraper() -> dict[str, str]:
    await run_all_scrapers()
    return {"status": "done"}
