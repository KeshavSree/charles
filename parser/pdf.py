# parser/pdf.py
from __future__ import annotations

import pdfplumber


def extract_text(file_path: str) -> str:
    """Return all text from a PDF file, pages joined with newlines."""
    with pdfplumber.open(file_path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages)
