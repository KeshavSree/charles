import asyncio
import logging

from config import Settings
from storage.db import create_tables
from scheduler import start_scheduler


def main() -> None:
    settings = Settings()
    logging.basicConfig(level=getattr(logging, settings.log_level))
    asyncio.run(create_tables())
    start_scheduler(settings)


if __name__ == "__main__":
    main()
