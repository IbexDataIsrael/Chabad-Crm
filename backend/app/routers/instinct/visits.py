"""Instinct visit endpoints (docs/system_api_part2.md §3).

- `POST  /visits`                — log a visit (written directly, not a draft:
  it records something that already happened, same as a UI-entered visit).
- `PATCH /visits/{id}/followup`  — mark its follow-up done.
"""
import datetime
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

from .common import (
    active_apartment,
    check_key,
    org_id,
    parse_date,
    unprocessable,
    write_custom_fields,
)

router = APIRouter(dependencies=[Depends(check_key)])

_TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
_DEFAULT_TIME = datetime.time(12, 0)


class VisitIn(BaseModel):
    contact_id: Optional[int] = None
    apartment_id: Optional[int] = None
    date: str
    time: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    followup_task: Optional[str] = None
    custom_fields: dict[str, Any] = {}


class FollowupIn(BaseModel):
    followup_done: bool


def _parse_time(value: Optional[str]) -> datetime.time:
    if value is None or not value.strip():
        return _DEFAULT_TIME
    try:
        if not _TIME_RE.match(value.strip()):
            raise ValueError
        return datetime.datetime.strptime(value.strip(), "%H:%M").time()
    except ValueError:
        raise unprocessable("invalid time: expected HH:MM (24h), e.g. 21:30")


def _text(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def visit_out(visit: models.VisitHistory) -> dict:
    return {
        "id": visit.id,
        "contact_id": visit.contact_id,
        "apartment_id": visit.apartment_id,
        "visit_date": visit.visit_date.isoformat(),
        "location": visit.location,
        "notes": visit.notes,
        "followup_task": visit.followup_task,
        "followup_done": visit.followup_done,
        "created_at": visit.created_at.isoformat() if visit.created_at else None,
    }


@router.post("/visits", status_code=status.HTTP_201_CREATED)
def create_visit(payload: VisitIn, db: Session = Depends(get_db)):
    org = org_id()
    if payload.contact_id is None and payload.apartment_id is None:
        raise unprocessable("contact_id or apartment_id is required")
    if payload.contact_id is not None and (
        db.query(models.Contact.id)
        .filter(models.Contact.id == payload.contact_id, models.Contact.organization_id == org)
        .first()
        is None
    ):
        raise unprocessable("contact_id does not exist")
    if payload.apartment_id is not None and active_apartment(db, payload.apartment_id, org) is None:
        raise unprocessable("apartment_id does not exist (or is not the current version)")
    visit_date = datetime.datetime.combine(
        parse_date(payload.date), _parse_time(payload.time)
    )

    visit = models.VisitHistory(
        organization_id=org,
        contact_id=payload.contact_id,
        apartment_id=payload.apartment_id,
        visit_date=visit_date,
        location=_text(payload.location),
        followup_task=_text(payload.followup_task),
        followup_done=False,
    )
    db.add(visit)
    db.flush()
    written, parked = write_custom_fields(
        db, org, "visit", "visit_history", visit.id, payload.custom_fields
    )
    # Unmapped custom-field keys are parked in the visit's notes, never a 422.
    note_lines = [line for line in [_text(payload.notes)] if line]
    note_lines += [f"{key}={payload.custom_fields[key]}" for key in parked]
    visit.notes = "\n".join(note_lines) or None
    db.commit()
    db.refresh(visit)
    return {**visit_out(visit), "custom_fields_written": written, "parked_in_notes": parked}


@router.patch("/visits/{visit_id}/followup")
def update_followup(visit_id: int, payload: FollowupIn, db: Session = Depends(get_db)):
    visit = (
        db.query(models.VisitHistory)
        .filter(models.VisitHistory.id == visit_id, models.VisitHistory.organization_id == org_id())
        .first()
    )
    if visit is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "visit not found")
    visit.followup_done = payload.followup_done
    db.commit()
    db.refresh(visit)
    return visit_out(visit)
