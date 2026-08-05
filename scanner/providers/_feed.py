"""Helpers for the many providers that follow one of a few shapes.

Most ATS providers differ only in (a) which hostname pattern identifies them, (b) the
endpoint path, and (c) which JSON keys hold the title/url/location. Factoring that out
keeps each provider module to its actual distinguishing logic instead of 60 lines of
boilerplate URL validation that must then be audited 35 times.

Also holds a minimal RSS/XML reader — several providers expose only a feed, and a
handful of tag extractions does not justify an XML dependency.
"""
from __future__ import annotations

import html
import re
from typing import Any, Callable, Iterable, Optional, Pattern
from urllib.parse import urlsplit

from scanner.providers._common import to_epoch_ms
from scanner.text import strip_html
from scanner.types import PortalEntry, Posting, ScanContext


def https_url(value: object) -> str:
    """Keep a well-formed absolute HTTPS URL, else ''.

    Used for the per-posting links a provider hands back. Unlike the API endpoint,
    these are display-only — recorded and clicked, never server-fetched — so they are
    not host-pinned; many tenants publish postings on a branded domain.
    """
    if not isinstance(value, str) or not value.strip():
        return ""
    try:
        parts = urlsplit(value.strip())
    except (ValueError, UnicodeError):
        return ""
    return value.strip() if parts.scheme == "https" and parts.netloc else ""


def tenant_origin(entry: PortalEntry, host_re: Pattern[str]) -> Optional[str]:
    """Origin of an entry whose hostname matches a per-tenant subdomain pattern.

    Tenant subdomains are the variable part, so the SSRF defense is a regex on the
    host shape rather than a static allowlist — but it is still a pin: nothing outside
    `<slug>.vendor.com` can ever be fetched.
    """
    for raw in (entry.api, entry.careers_url):
        if not isinstance(raw, str) or not raw.strip():
            continue
        try:
            parts = urlsplit(raw.strip())
        except (ValueError, UnicodeError):
            continue
        if parts.scheme != "https" or not parts.hostname:
            continue
        if not host_re.match(parts.hostname):
            continue
        return f"https://{parts.hostname}"
    return None


def first_path_segment(entry: PortalEntry, host: str) -> Optional[str]:
    """First path segment of an entry pinned to an exact hostname."""
    for raw in (entry.api, entry.careers_url):
        if not isinstance(raw, str) or not raw.strip():
            continue
        try:
            parts = urlsplit(raw.strip())
        except (ValueError, UnicodeError):
            continue
        if parts.scheme != "https" or parts.hostname != host:
            continue
        segments = [s for s in parts.path.split("/") if s]
        if segments:
            return segments[0]
    return None


def join_location(*parts: object, remote: bool = False) -> str:
    values = [str(p).strip() for p in parts if isinstance(p, str) and str(p).strip()]
    if remote:
        values.append("Remote")
    return ", ".join(dict.fromkeys(values))


def pick(row: dict, *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)):
            return str(value)
    return ""


def dig(row: dict, path: str) -> Any:
    """Read a dotted path, tolerating missing intermediate keys."""
    current: Any = row
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def rows_from(payload: Any, *paths: str) -> list[dict]:
    """First list found at any of the given dotted paths (or the payload itself)."""
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        return []
    for path in paths:
        value = dig(payload, path)
        if isinstance(value, list):
            return [r for r in value if isinstance(r, dict)]
    return []


# ── Minimal RSS/XML reading ─────────────────────────────────────────

_CDATA_RE = re.compile(r"^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$")
_ITEM_RE = re.compile(r"<item\b[^>]*>([\s\S]*?)</item>", re.I)


def xml_text(block: str, tag: str) -> str:
    """Inner text of the first <tag> in a block. Tag names may carry a namespace."""
    match = re.search(rf"<{re.escape(tag)}\b[^>]*>([\s\S]*?)</{re.escape(tag)}>", block, re.I)
    if not match:
        return ""
    inner = match.group(1)
    cdata = _CDATA_RE.match(inner)
    if cdata:
        return cdata.group(1).strip()
    return html.unescape(inner).strip()


def rss_items(xml: str) -> list[str]:
    if not isinstance(xml, str):
        return []
    return _ITEM_RE.findall(xml)


def make_rss_provider(
    provider_id: str,
    *,
    feed_url: Callable[[PortalEntry], Optional[str]],
    location_of: Optional[Callable[[str], str]] = None,
    company_of: Optional[Callable[[str, PortalEntry], str]] = None,
    timeout: Optional[float] = None,
):
    """Build a provider backed by an RSS jobs feed."""

    class RssProvider:
        id = provider_id

        def detect(self, entry: PortalEntry) -> Optional[str]:
            try:
                return feed_url(entry)
            except ValueError:
                return None

        async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
            url = feed_url(entry)
            if not url:
                raise ValueError(f"{provider_id}: cannot derive feed URL for {entry.name}")
            opts = {"timeout": timeout} if timeout else {}
            xml = await ctx.fetch_text(url, **opts)

            postings = []
            for item in rss_items(xml):
                title = xml_text(item, "title")
                link = https_url(xml_text(item, "link"))
                if not title or not link:
                    continue
                postings.append(
                    Posting(
                        title=title,
                        url=link,
                        company=company_of(item, entry) if company_of else entry.name,
                        location=location_of(item) if location_of else "",
                        description=strip_html(
                            xml_text(item, "description") or xml_text(item, "content:encoded")
                        ),
                        posted_at=to_epoch_ms(xml_text(item, "pubDate"))
                        or _parse_rfc822(xml_text(item, "pubDate")),
                    )
                )
            return postings

    return RssProvider()


def _parse_rfc822(value: str) -> Optional[int]:
    """RSS uses RFC-822 dates, which `to_epoch_ms` (ISO-8601) cannot read."""
    if not value:
        return None
    try:
        from email.utils import parsedate_to_datetime

        parsed = parsedate_to_datetime(value)
        if parsed is None:
            return None
        if parsed.tzinfo is None:
            from datetime import timezone

            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    except Exception:  # noqa: BLE001 — unparseable date is simply "no date"
        return None


def make_json_provider(
    provider_id: str,
    *,
    api_url: Callable[[PortalEntry], Optional[str]],
    row_paths: Iterable[str] = (),
    to_posting: Callable[[dict, PortalEntry], Optional[Posting]],
    timeout: Optional[float] = None,
    headers: Optional[dict[str, str]] = None,
):
    """Build a provider backed by a single JSON endpoint."""

    class JsonProvider:
        id = provider_id

        def detect(self, entry: PortalEntry) -> Optional[str]:
            try:
                return api_url(entry)
            except ValueError:
                return None

        async def fetch(self, entry: PortalEntry, ctx: ScanContext) -> list[Posting]:
            url = api_url(entry)
            if not url:
                raise ValueError(f"{provider_id}: cannot derive API URL for {entry.name}")
            opts: dict[str, Any] = {}
            if timeout:
                opts["timeout"] = timeout
            if headers:
                opts["headers"] = headers
            payload = await ctx.fetch_json(url, **opts)

            postings = []
            for row in rows_from(payload, *row_paths):
                posting = to_posting(row, entry)
                if posting and posting.title and posting.url:
                    postings.append(posting)
            return postings

    return JsonProvider()
