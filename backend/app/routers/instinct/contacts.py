"""Instinct contact endpoints.

phase 1 (docs/system_api.md):
- `GET  /ping`                           — connectivity check.
- `POST /contacts`                       — create a mekurav Contact as a draft.
phase 2 (docs/system_api_part2.md):
- `GET  /contacts/search?q=`             — §1 find by name (drafts included).
- `GET  /contacts?created_on=&status=`   — §6b compact list.
- `PATCH /contacts/{id}/fields`          — §4 contact custom-field counters.
- `POST /contacts/{id}/link-apartment`   — §5d mekurav <-> apartment link.
"""
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.routers.contacts import _check_phone_unique, _geocode_fallback

from .common import (
    active_apartment,
    append_note,
    check_key,
    clean_email,
    clean_phone,
    day_bounds,
    org_id,
    parse_date,
    unprocessable,
    write_custom_fields,
)

router = APIRouter(dependencies=[Depends(check_key)])

# contacts.contact_type -> the CustomFieldDefinition.entity_type its fields use
# (app/custom_field_utils.py); both store under entity_table='contacts'.
_CONTACT_ENTITY_TYPE = {"mekurav": "contact_mekurav", "shliach": "contact_shliach"}


class InstinctContactIn(BaseModel):
    # No source/status fields: they are server-set, and pydantic drops unknown
    # keys, so a caller sending them has no effect.
    first_name: str
    last_name: str
    phone: Optional[str] = None
    address: Optional[str] = None
    email: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: Optional[str]) -> Optional[str]:
        return clean_email(value)


class ContactFieldsIn(BaseModel):
    fields: dict[str, Any] = {}
    notes: Optional[str] = None


class LinkApartmentIn(BaseModel):
    apartment_id: int


def _get_contact(db: Session, contact_id: int) -> models.Contact:
    contact = (
        db.query(models.Contact)
        .filter(models.Contact.id == contact_id, models.Contact.organization_id == org_id())
        .first()
    )
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "contact not found")
    return contact


@router.get("/ping")
def ping():
    return {"ok": True}


@router.post("/contacts", status_code=status.HTTP_201_CREATED)
def create_contact(payload: InstinctContactIn, db: Session = Depends(get_db)):
    org = org_id()
    if not db.get(models.Organization, org):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "INSTINCT_ORG_ID not found")

    data = {
        "name": payload.first_name.strip(),
        "last_name": payload.last_name.strip() or None,
        # phase 2 §2: Israeli mobile only, stored normalized.
        "phone": clean_phone(payload.phone),
        "address": (payload.address or "").strip() or None,
        "email": payload.email,
    }
    if not data["name"]:
        raise unprocessable("first_name is required")
    if data["phone"]:
        _check_phone_unique(db, org, data["phone"])
    _geocode_fallback(data)

    contact = models.Contact(
        **data,
        organization_id=org,
        contact_type="mekurav",
        source="instinct",
        status="draft",
    )
    db.add(contact)
    db.flush()
    db.add(models.ContactMekurav(organization_id=org, contact_id=contact.id))
    db.commit()
    db.refresh(contact)

    return {
        "id": contact.id,
        "first_name": contact.name,
        "last_name": contact.last_name,
        "phone": contact.phone,
        "address": contact.address,
        "email": contact.email,
        "source": contact.source,
        "status": contact.status,
        "organization_id": contact.organization_id,
        "created_at": contact.created_at.isoformat() if contact.created_at else None,
    }


@router.get("/contacts/search")
def search_contacts(
    q: str = Query(..., min_length=1),
    record_status: Literal["active", "draft", "all"] = Query("all", alias="status"),
    db: Session = Depends(get_db),
):
    """§1: case-insensitive substring match on the full name, or every word of
    `q` matching the first or last name (so "Mizrahi Moshe" finds "Moshe
    Mizrahi"). Drafts are included by default so the assistant never creates
    a duplicate of a contact still pending approval."""
    q = q.strip()
    if not q:
        raise unprocessable("q must not be blank")
    C = models.Contact
    full = C.name + " " + func.coalesce(C.last_name, "")
    word_matches = [
        or_(C.name.icontains(word, autoescape=True), C.last_name.icontains(word, autoescape=True))
        for word in q.split()
    ]
    query = (
        db.query(C, models.ContactMekurav.apartment_id)
        .outerjoin(models.ContactMekurav, models.ContactMekurav.contact_id == C.id)
        .filter(
            C.organization_id == org_id(),
            or_(full.icontains(q, autoescape=True), and_(*word_matches)),
        )
    )
    if record_status != "all":
        query = query.filter(C.status == record_status)
    rows = (
        query.order_by(case((C.status == "draft", 0), else_=1), C.name, C.last_name, C.id)
        .limit(20)
        .all()
    )
    return {
        "results": [
            {
                "id": c.id,
                "name": c.name,
                "last_name": c.last_name,
                "phone": c.phone,
                "email": c.email,
                "source": c.source,
                "status": c.status,
                "apartment_id": apartment_id,
            }
            for c, apartment_id in rows
        ]
    }


@router.get("/contacts")
def list_contacts(
    created_on: Optional[str] = None,
    record_status: Optional[Literal["active", "draft"]] = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """§6b: compact rows ("who registered today?"), newest first."""
    C = models.Contact
    query = db.query(C).filter(C.organization_id == org_id())
    if created_on is not None:
        start, end = day_bounds(parse_date(created_on, "created_on"))
        query = query.filter(C.created_at >= start, C.created_at < end)
    if record_status is not None:
        query = query.filter(C.status == record_status)
    rows = query.order_by(C.created_at.desc(), C.id.desc()).limit(limit).all()
    return {
        "results": [
            {"id": c.id, "name": c.name, "last_name": c.last_name, "phone": c.phone, "status": c.status}
            for c in rows
        ]
    }


@router.patch("/contacts/{contact_id}/fields")
def update_contact_fields(
    contact_id: int, payload: ContactFieldsIn, db: Session = Depends(get_db)
):
    """§4: upsert the contact's custom-field values (tefillin / mezuzot
    counters). Unknown keys are parked in contacts.notes, never a 422."""
    org = org_id()
    contact = _get_contact(db, contact_id)
    entity_type = _CONTACT_ENTITY_TYPE.get(contact.contact_type, "contact_mekurav")
    written, parked = write_custom_fields(
        db, org, entity_type, "contacts", contact.id, payload.fields
    )
    note_lines = []
    if payload.notes and payload.notes.strip():
        note_lines.append(payload.notes.strip())
    note_lines += [f"{key}: {payload.fields[key]}" for key in parked]
    if note_lines:
        contact.notes = append_note(contact.notes, "\n".join(note_lines))
    db.commit()
    return {"id": contact.id, "fields_written": written, "parked_in_notes": parked}


@router.post("/contacts/{contact_id}/link-apartment")
def link_apartment(contact_id: int, payload: LinkApartmentIn, db: Session = Depends(get_db)):
    """§5d: set contact_mekurav.apartment_id (creating the mekurav row if a
    mekurav contact lacks one)."""
    org = org_id()
    contact = _get_contact(db, contact_id)
    if contact.contact_type != "mekurav":
        raise unprocessable("only a mekurav contact can be linked to an apartment")
    if active_apartment(db, payload.apartment_id, org) is None:
        raise unprocessable("apartment_id does not exist (or is not the current version)")
    if contact.mekurav is None:
        contact.mekurav = models.ContactMekurav(organization_id=org, contact_id=contact.id)
    contact.mekurav.apartment_id = payload.apartment_id
    db.commit()
    return {"contact_id": contact.id, "apartment_id": payload.apartment_id}
