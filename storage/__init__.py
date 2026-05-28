from storage.db import create_tables, get_session
from storage.models import Job

# Lazy imports for repository functions (Task 9)
def __getattr__(name):
    if name in ("upsert_jobs", "query_jobs"):
        from storage.repository import upsert_jobs, query_jobs as _query_jobs
        return upsert_jobs if name == "upsert_jobs" else _query_jobs
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = ["create_tables", "get_session", "Job", "upsert_jobs", "query_jobs"]
