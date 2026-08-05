"""Helpers shared by provider modules. The leading underscore keeps the registry
from loading this as a provider.

`assert_host` is the SSRF boundary. Every provider validates the *derived* API URL
against its own allowlist before the URL reaches the network layer, and the network
layer refuses redirects — together those guarantee the request cannot leave the
allowlisted host. Neither half is sufficient alone.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Iterable, Optional
from urllib.parse import urlsplit

# Conservative charset for any slug interpolated into a URL. Applied to values from
# untrusted sources (the public ATS-directory dataset, VC portfolio payloads).
SLUG_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def assert_host(url: str, allowed: Iterable[str], provider_id: str) -> str:
    """Reject a URL that isn't HTTPS on an allowlisted host."""
    try:
        parts = urlsplit(url)
    except (ValueError, UnicodeError) as exc:
        raise ValueError(f"{provider_id}: invalid URL: {url}") from exc
    if parts.scheme != "https":
        raise ValueError(f"{provider_id}: URL must use HTTPS: {url}")
    allowed = set(allowed)
    if parts.hostname not in allowed:
        raise ValueError(
            f"{provider_id}: untrusted hostname {parts.hostname!r} — "
            f"must be one of: {', '.join(sorted(allowed))}"
        )
    return url


def host_of(url: str) -> str:
    try:
        return urlsplit(url).hostname or ""
    except (ValueError, UnicodeError):
        return ""


def path_segments(url: str) -> list[str]:
    try:
        return [s for s in urlsplit(url).path.split("/") if s]
    except (ValueError, UnicodeError):
        return []


def to_epoch_ms(value: object) -> Optional[int]:
    """Parse an ISO-8601 timestamp to epoch ms, or None.

    Returns None (not 0) on anything unparseable — a falsy-coercion bug here would
    turn "no date" into "1970", which the freshness filters would then read as stale.
    """
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        # Heuristic: values below ~1e11 are seconds, above are already ms.
        number = float(value)
        if number <= 0:
            return None
        return int(number * 1000) if number < 1e11 else int(number)
    if not isinstance(value, str):
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text[:10], "%Y-%m-%d")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)
