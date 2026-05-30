from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from storage.models import UserInfo
from storage.repository import get_or_create_info, save_info

router = APIRouter()


class InfoOut(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str | None
    linkedin_url: str | None
    address: str | None
    city: str | None
    state: str | None
    zip_code: str | None
    country: str | None
    work_auth: str | None
    work_authorized: bool | None
    requires_sponsorship: bool | None
    gender: str | None
    ethnicity: str | None
    veteran_status: str | None
    disability_status: str | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class InfoIn(BaseModel):
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str | None = None
    linkedin_url: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    country: str | None = None
    work_auth: str | None = None
    work_authorized: bool | None = None
    requires_sponsorship: bool | None = None
    gender: str | None = None
    ethnicity: str | None = None
    veteran_status: str | None = None
    disability_status: str | None = None


@router.get("/info", response_model=InfoOut)
async def get_info(session: AsyncSession = Depends(get_db)) -> InfoOut:
    row = await get_or_create_info(session)
    return InfoOut.model_validate(row)


@router.put("/info", response_model=InfoOut)
async def update_info(
    body: InfoIn, session: AsyncSession = Depends(get_db)
) -> InfoOut:
    data = UserInfo(
        first_name=body.first_name,
        last_name=body.last_name,
        email=body.email,
        phone=body.phone,
        linkedin_url=body.linkedin_url,
        address=body.address,
        city=body.city,
        state=body.state,
        zip_code=body.zip_code,
        country=body.country,
        work_auth=body.work_auth,
        work_authorized=body.work_authorized,
        requires_sponsorship=body.requires_sponsorship,
        gender=body.gender,
        ethnicity=body.ethnicity,
        veteran_status=body.veteran_status,
        disability_status=body.disability_status,
        updated_at=datetime.now(tz=timezone.utc),
    )
    row = await save_info(session, data)
    return InfoOut.model_validate(row)
