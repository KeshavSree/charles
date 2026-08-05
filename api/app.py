# api/app.py
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from logging_config import configure_logging
from storage.db import create_tables
from api.routers import jobs, pipeline, resumes, scanner, profiles, info


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    await create_tables()
    yield


app = FastAPI(title="Charles API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET", "PUT", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(jobs.router, prefix="/api")
app.include_router(resumes.router, prefix="/api")
app.include_router(scanner.router, prefix="/api")
app.include_router(profiles.router, prefix="/api")
app.include_router(info.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
