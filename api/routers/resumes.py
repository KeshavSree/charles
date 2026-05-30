# api/routers/resumes.py
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import Resume, ResumeSection

UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

router = APIRouter()


class ResumeSummaryOut(BaseModel):
    id: str
    filename: str
    uploaded_at: datetime
    section_count: int


class ResumeSectionOut(BaseModel):
    section_type: str
    content: str

    model_config = {"from_attributes": True}


class ResumeDetailOut(BaseModel):
    id: str
    filename: str
    uploaded_at: datetime
    sections: dict[str, str]


@router.get("/resumes", response_model=list[ResumeSummaryOut])
async def list_resumes(session: AsyncSession = Depends(get_db)) -> list[ResumeSummaryOut]:
    result = await session.execute(select(Resume).order_by(Resume.uploaded_at.desc()))
    resumes = result.scalars().all()
    out = []
    for r in resumes:
        count = (
            await session.execute(
                select(func.count()).where(ResumeSection.resume_id == r.id)
            )
        ).scalar_one()
        out.append(ResumeSummaryOut(
            id=r.id,
            filename=r.filename,
            uploaded_at=r.uploaded_at,
            section_count=count,
        ))
    return out


@router.post("/resumes", status_code=201)
async def upload_resume(
    file: UploadFile,
    session: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    resume_id = str(uuid.uuid4())
    file_path = UPLOADS_DIR / f"{resume_id}.pdf"
    file_path.write_bytes(await file.read())

    session.add(Resume(
        id=resume_id,
        filename=file.filename or "resume.pdf",
        file_path=str(file_path),
        uploaded_at=datetime.now(tz=timezone.utc),
    ))
    await session.flush()

    from parser.pdf import extract_text
    from parser.sections import detect_sections

    try:
        raw_text = extract_text(str(file_path))
        sections = detect_sections(raw_text)
        for section_type, content in sections.items():
            session.add(ResumeSection(
                resume_id=resume_id,
                section_type=section_type,
                content=content,
            ))
    except Exception:
        pass  # parsing failure must not block the upload

    await session.commit()

    try:
        from storage.repository import generate_profile_from_resume
        await generate_profile_from_resume(session, resume_id)
    except Exception:
        pass  # profile generation failure must not block the upload

    return {"id": resume_id}


@router.get("/resumes/{resume_id}", response_model=ResumeDetailOut)
async def get_resume(
    resume_id: str,
    session: AsyncSession = Depends(get_db),
) -> ResumeDetailOut:
    resume = await session.get(Resume, resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    sections_result = await session.execute(
        select(ResumeSection).where(ResumeSection.resume_id == resume_id)
    )
    sections = {s.section_type: s.content for s in sections_result.scalars().all()}
    return ResumeDetailOut(
        id=resume.id,
        filename=resume.filename,
        uploaded_at=resume.uploaded_at,
        sections=sections,
    )


@router.get("/resumes/{resume_id}/file")
async def get_resume_file(
    resume_id: str,
    session: AsyncSession = Depends(get_db),
) -> FileResponse:
    resume = await session.get(Resume, resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    path = Path(resume.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(str(path), media_type="application/pdf")


@router.delete("/resumes/{resume_id}", status_code=204, response_class=Response)
async def delete_resume(
    resume_id: str,
    session: AsyncSession = Depends(get_db),
) -> Response:
    resume = await session.get(Resume, resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    Path(resume.file_path).unlink(missing_ok=True)
    sections = (
        await session.execute(
            select(ResumeSection).where(ResumeSection.resume_id == resume_id)
        )
    ).scalars().all()
    for s in sections:
        await session.delete(s)
    await session.delete(resume)
    await session.commit()
    return Response(status_code=204)
