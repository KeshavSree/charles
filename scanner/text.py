"""Text normalization shared by providers. Replaces `providers/_html-entities.mjs`
(Python's stdlib already decodes entities, so only the tag-stripping is ours)."""
from __future__ import annotations

import html
import re

_TAG_RE = re.compile(r"<[^>]*>")
_WS_RE = re.compile(r"\s+")


def strip_html(value: object) -> str:
    """Flatten an HTML job description to plain text.

    Block-level tags become spaces first so `<li>A</li><li>B</li>` doesn't run
    together as "AB" — the content filter matches substrings, and a false join can
    manufacture a keyword that was never in the posting.
    """
    if not isinstance(value, str) or not value:
        return ""
    text = re.sub(r"<(br|/p|/div|/li|/tr|/h[1-6])[^>]*>", " ", value, flags=re.I)
    text = _TAG_RE.sub(" ", text)
    return _WS_RE.sub(" ", html.unescape(text)).strip()


def clean(value: object) -> str:
    """Trim and collapse whitespace on a scalar field."""
    if value is None:
        return ""
    return _WS_RE.sub(" ", str(value)).strip()
