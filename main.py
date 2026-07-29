import asyncio

from config import Settings
from logging_config import configure_logging
from storage.db import create_tables
from scheduler import start_scheduler


def main() -> None:
    settings = Settings()
    configure_logging(settings.log_level)
    asyncio.run(create_tables())
    start_scheduler(settings)


if __name__ == "__main__":
    main()
