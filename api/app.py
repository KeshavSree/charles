# api/app.py
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from storage.db import create_tables
from api.routers import jobs, resumes


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


app = FastAPI(title="Charles API", lifespan=lifespan)
app.include_router(jobs.router, prefix="/api")
app.include_router(resumes.router, prefix="/api")
