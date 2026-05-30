from datetime import datetime, timezone
from storage.models import UserInfo


async def test_user_info_table_exists(db_session):
    now = datetime.now(tz=timezone.utc)
    db_session.add(UserInfo(
        id="default",
        first_name="Jane",
        last_name="Smith",
        email="jane@example.com",
        updated_at=now,
    ))
    await db_session.commit()

    from sqlalchemy import select
    row = (await db_session.execute(select(UserInfo))).scalar_one()
    assert row.first_name == "Jane"
    assert row.email == "jane@example.com"
    assert row.phone is None


async def test_user_info_has_application_question_columns(db_session):
    from datetime import datetime, timezone
    from storage.models import UserInfo
    now = datetime.now(tz=timezone.utc)
    db_session.add(UserInfo(
        id="default2",
        work_authorized=True,
        requires_sponsorship=False,
        gender="Male",
        ethnicity="Asian",
        veteran_status="I am not a protected veteran",
        disability_status="I do not have a disability",
        updated_at=now,
    ))
    await db_session.commit()
    from sqlalchemy import select
    row = (await db_session.execute(
        select(UserInfo).where(UserInfo.id == "default2")
    )).scalar_one()
    assert row.work_authorized is True
    assert row.requires_sponsorship is False
    assert row.gender == "Male"
    assert row.veteran_status == "I am not a protected veteran"
