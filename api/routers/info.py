from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import get_db
from api.schemas import InfoIn, InfoOut
from storage.models import UserInfo
from storage.repository import get_or_create_info, save_info

router = APIRouter()


@router.get("/info", response_model=InfoOut)
async def get_info(session: AsyncSession = Depends(get_db)) -> InfoOut:
    row = await get_or_create_info(session)
    return InfoOut.model_validate(row)


@router.put("/info", response_model=InfoOut)
async def update_info(
    body: InfoIn, session: AsyncSession = Depends(get_db)
) -> InfoOut:
    data = UserInfo(**body.model_dump(), updated_at=datetime.now(tz=timezone.utc))
    row = await save_info(session, data)
    return InfoOut.model_validate(row)
