# tests/conftest.py
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from storage.models import Base


def make_pdf(text: str = "John Doe\njohn@example.com") -> bytes:
    """Build a minimal but genuinely valid single-page PDF with extractable text.

    Used by upload/parse tests now that a corrupt PDF is a hard error rather than a
    silently swallowed no-op. Byte offsets for the xref are computed, so it parses.
    """
    escaped = (
        text.replace("\\", r"\\")
        .replace("(", r"\(")
        .replace(")", r"\)")
        .replace("\n", ") Tj T* (")
    )
    content = f"BT /F1 12 Tf 72 720 Td 14 TL ({escaped}) Tj ET".encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_pos = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (
        len(objs) + 1,
        xref_pos,
    )
    return bytes(out)


@pytest.fixture
def sample_pdf() -> bytes:
    return make_pdf()


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    """In-memory SQLite session for tests."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()
