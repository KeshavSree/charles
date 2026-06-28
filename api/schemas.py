from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class UserInfoFields(BaseModel):
    """
    Single Python source of truth for UserInfo fields.
    Adding a field: add one line here + one mapped_column in storage/models.py.
    InfoOut and InfoIn both derive from this class.
    """
    first_name: str = ""
    last_name: str = ""
    chosen_name: str | None = None
    pronouns: str | None = None
    email: str = ""
    phone: str | None = None
    linkedin_url: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    country: str | None = None
    work_authorized: bool | None = None
    requires_sponsorship: bool | None = None
    gender: str | None = None
    ethnicity: str | None = None
    veteran_status: str | None = None
    disability_status: str | None = None
    hispanic_latino: str | None = None
    transgender: str | None = None
    would_relocate: bool | None = None
    non_compete: bool | None = None
    us_gov_employee: bool | None = None
    gov_contracting: bool | None = None
    export_restricted: bool | None = None
    f1_student: bool | None = None
    enrolled_returning: bool | None = None
    privacy_ack: bool | None = None
    job_alerts: bool | None = None
    worked_here: bool | None = None
    degree_pursuing: str | None = None
    grad_date: str | None = None
    twitter: str | None = None
    facebook: str | None = None
    github: str | None = None
    website: str | None = None
    # Aggressive-fill settings.
    aggressive_fill: bool = False
    worked_companies: list[str] = []
    skills: list[str] = []

    @field_validator('skills', 'worked_companies', mode='before')
    @classmethod
    def coerce_list(cls, v: object) -> list[str]:
        return v if isinstance(v, list) else []


class InfoOut(UserInfoFields):
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class InfoIn(UserInfoFields):
    pass
