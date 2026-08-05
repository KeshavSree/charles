"""HTTP transport shared by every provider. Ported from `providers/_http.mjs`.

Two invariants matter here and must not be relaxed:

1. **No redirects.** `follow_redirects=False` plus treating any 3xx as an error is the
   Python equivalent of career-ops' `redirect: 'error'`. Combined with each provider's
   host allowlist it guarantees the *final* hostname stays inside the allowlist — a
   server-side redirect cannot walk the request off to an arbitrary host.
2. **Status detail survives.** Callers (Workday's retry loop, the error classifier)
   dispatch on `.status` and `.retry_after`, so the error type carries them rather
   than collapsing to a string.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

import httpx

DEFAULT_TIMEOUT_S = 10.0
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; charles-scanner/1.0)"

# Browser-like UA for providers that must clear WAF/CDN bot management which blocks
# the default UA outright (seen live in career-ops: Glints' firewall, Geico's
# Cloudflare-gated Workday tenant). Shared so every provider working around such a
# block bumps one constant instead of drifting Chrome versions per file.
BROWSER_LIKE_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


class FetchError(Exception):
    """Transport-level failure carrying the detail retry logic needs."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        body: str = "",
        retry_after: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.body = body
        self.retry_after = retry_after


async def _request(
    client: httpx.AsyncClient,
    url: str,
    *,
    method: str = "GET",
    timeout: float = DEFAULT_TIMEOUT_S,
    headers: Optional[dict[str, str]] = None,
    content: Optional[bytes | str] = None,
) -> httpx.Response:
    # Advertise only encodings httpx can decode without an optional dependency.
    # Left to its default, httpx offers `br` and then fails to decode a brotli
    # response (seen live: Ashby), which surfaces as an opaque network error on a
    # board that is actually healthy.
    merged = {"user-agent": DEFAULT_USER_AGENT, "accept-encoding": "gzip, deflate"}
    if headers:
        merged.update(headers)
    try:
        response = await client.request(
            method,
            url,
            headers=merged,
            content=content,
            timeout=timeout,
            follow_redirects=False,
        )
    except httpx.TimeoutException as exc:
        raise FetchError(f"timeout after {timeout}s") from exc
    except httpx.HTTPError as exc:
        raise FetchError(f"network error: {exc}") from exc

    # SSRF guard: a redirect could leave the provider's allowlisted host.
    if response.is_redirect:
        raise FetchError(
            f"HTTP {response.status_code} redirect refused "
            f"(to {response.headers.get('location', '?')})",
            status=response.status_code,
        )

    if response.status_code >= 400:
        # WAF/CDN challenge pages carry no actionable text — the status code and its
        # reason phrase are what a log line needs. The raw body is still attached for
        # callers that want to inspect it.
        raise FetchError(
            f"HTTP {response.status_code}",
            status=response.status_code,
            body=response.text[:2000],
            retry_after=response.headers.get("retry-after"),
        )
    return response


def make_context(client: httpx.AsyncClient, **kwargs: Any):
    """Build a ScanContext bound to a shared AsyncClient."""
    from scanner.types import ScanContext

    async def fetch_json(url: str, **opts: Any) -> Any:
        response = await _request(client, url, **opts)
        return response.json()

    async def fetch_text(url: str, **opts: Any) -> str:
        response = await _request(client, url, **opts)
        return response.text

    return ScanContext(
        fetch_json=fetch_json,
        fetch_text=fetch_text,
        sleep=asyncio.sleep,
        **kwargs,
    )
