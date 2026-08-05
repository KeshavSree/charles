"""Salary filter. Ported from `scan.mjs:buildSalaryFilter`.

All figures are annual — providers annualize before constructing a Salary.

Conservative by design: a posting with no salary data passes, because most providers
expose none and rejecting them would empty the pipeline. Currency mismatch rejects
only when *both* sides are known.

Malformed bounds disable the filter with a warning rather than mis-filtering — a
silently inverted range would look like "no jobs matched".
"""
from __future__ import annotations

import logging
from typing import Callable, Optional

from scanner.types import Salary

logger = logging.getLogger(__name__)


def build_salary_filter(config: Optional[dict]) -> Callable[[Optional[Salary]], bool]:
    if not config:
        return lambda salary: True

    try:
        minimum = float(config.get("min") or 0)
        maximum = float(config.get("max") or 0)
    except (TypeError, ValueError):
        logger.warning("salary_filter.min/max must be numbers — salary filter disabled")
        return lambda salary: True

    currency = str(config.get("currency") or "").strip().upper()

    if minimum < 0 or maximum < 0:
        logger.warning("salary_filter bounds must be non-negative — salary filter disabled")
        return lambda salary: True
    if maximum > 0 and minimum > maximum:
        logger.warning("salary_filter.min exceeds max — salary filter disabled")
        return lambda salary: True
    if minimum == 0 and maximum == 0:
        return lambda salary: True

    def matches(salary: Optional[Salary]) -> bool:
        if salary is None:
            return True
        job_low = salary.min if salary.min is not None else salary.max
        job_high = salary.max if salary.max is not None else salary.min
        if job_low is None and job_high is None:
            return True

        job_currency = (salary.currency or "").strip().upper()
        if currency and job_currency and currency != job_currency:
            return False

        # Reject only when the job's range is entirely outside the filter's.
        if minimum > 0 and job_high is not None and job_high < minimum:
            return False
        if maximum > 0 and job_low is not None and job_low > maximum:
            return False
        return True

    return matches
