"""Instinct apartment endpoints (docs/system_api_part2.md §5).

- `GET   /apartments/search?q=`  — §5a find by building address / apartment
  number / resident (drafts included, like contact search).
- `POST  /apartments`            — §5b create as a draft (source='instinct',
  status='draft'); the building is matched by address or created.
- `PATCH /apartments/{id}`       — §5c versioned update (status='active'
  approves). NOTE: an apartment's id changes on every edit (fixes19
  versioning) — the response's `apartment_id` is the new current id.
"""
from types import SimpleNamespace
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.routers.apartments import _apply_versioned_update
from app.routers.buildings import _floor_sort_order_for

from .common import (
    active_apartment,
    append_note,
    check_key,
    clean_email,
    clean_phone,
    org_id,
    unprocessable,
)

router = APIRouter(dependencies=[Depends(check_key)])


class _ApartmentFields(BaseModel):
    apartment_name: Optional[str] = None
    floor: Optional[str] = None
    resident_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: Optional[str]) -> Optional[str]:
        return clean_email(value)


class ApartmentIn(_ApartmentFields):
    building_address: str


class ApartmentPatch(_ApartmentFields):
    status: Optional[Literal["active", "draft"]] = None


def _text(value: Optional[str]) -> Optional[str]:
    return (value or "").strip() or None


def _ensure_floor(db: Session, building: models.Building, floor: Optional[str]) -> None:
    """apartments.floor references a building floor by name — create the
    Floor row when the building doesn't have it yet, so the apartment shows
    up in the building's floor grid (same sort rule as routers/buildings.py)."""
    if not floor:
        return
    existing = list(building.floors)
    if any(f.name == floor for f in existing):
        return
    db.add(
        models.Floor(
            organization_id=building.organization_id,
            building_id=building.id,
            name=floor,
            sort_order=_floor_sort_order_for(floor, existing),
        )
    )


def _apartment_out(a: models.Apartment) -> dict:
    return {
        "apartment_id": a.id,
        "apartment_name": a.apartment_name,
        "floor": a.floor,
        "resident_name": a.name,
        "phone": a.phone,
        "email": a.email,
        "building_id": a.building_id,
        "building_address": a.building.building_address if a.building else None,
        "source": a.source,
        "status": a.status,
    }


@router.get("/apartments/search")
def search_apartments(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    q = q.strip()
    if not q:
        raise unprocessable("q must not be blank")
    A, B = models.Apartment, models.Building
    rows = (
        db.query(A)
        .join(B, B.id == A.building_id)
        .filter(
            A.organization_id == org_id(),
            A.is_display.is_(True),
            or_(
                B.building_address.icontains(q, autoescape=True),
                A.apartment_name.icontains(q, autoescape=True),
                A.name.icontains(q, autoescape=True),
            ),
        )
        .order_by(B.building_address, A.apartment_name, A.id)
        .limit(20)
        .all()
    )
    return {"results": [_apartment_out(a) for a in rows]}


@router.post("/apartments", status_code=status.HTTP_201_CREATED)
def create_apartment(payload: ApartmentIn, db: Session = Depends(get_db)):
    org = org_id()
    if not db.get(models.Organization, org):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "INSTINCT_ORG_ID not found")
    address = payload.building_address.strip()
    if not address:
        raise unprocessable("building_address is required")
    phone = clean_phone(payload.phone)

    building = (
        db.query(models.Building)
        .filter(
            models.Building.organization_id == org,
            func.lower(func.trim(models.Building.building_address)) == address.lower(),
        )
        .order_by(models.Building.id)
        .first()
    )
    if building is None:
        # routers/buildings.py create_building doesn't geocode, so neither
        # does this; the building can be placed on the map later in the app.
        building = models.Building(
            organization_id=org, building_address=address, building_type_id="building"
        )
        db.add(building)
        db.flush()
    elif building.building_type_id == "town_house":
        # Copied from routers/apartments.py create_apartment (fixes63): a
        # second unit means the town house has been split.
        building.building_type_id = "divided_town_house"

    floor = _text(payload.floor)
    _ensure_floor(db, building, floor)
    apartment = models.Apartment(
        organization_id=org,
        building_id=building.id,
        apartment_name=_text(payload.apartment_name),
        floor=floor,
        name=_text(payload.resident_name),
        phone=phone,
        email=payload.email,
        apartment_notes=_text(payload.notes),
        source="instinct",
        status="draft",
    )
    db.add(apartment)
    db.commit()
    db.refresh(apartment)
    return {
        "apartment_id": apartment.id,
        "building_id": building.id,
        "building_address": building.building_address,
        "source": apartment.source,
        "status": apartment.status,
    }


@router.patch("/apartments/{apartment_id}")
def update_apartment(apartment_id: int, payload: ApartmentPatch, db: Session = Depends(get_db)):
    active = active_apartment(db, apartment_id, org_id())
    if active is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "apartment not found (or not the current version)")
    sent = payload.model_fields_set
    changes: dict = {}
    for field, column in (("apartment_name", "apartment_name"), ("floor", "floor"), ("resident_name", "name")):
        if field in sent:
            changes[column] = _text(getattr(payload, field))
    if "phone" in sent:
        changes["phone"] = clean_phone(payload.phone)
    if "email" in sent:
        changes["email"] = payload.email
    if "status" in sent and payload.status is not None:
        changes["status"] = payload.status
    if _text(payload.notes):
        changes["apartment_notes"] = append_note(active.apartment_notes, payload.notes.strip())
    changes = {k: v for k, v in changes.items() if getattr(active, k) != v}
    if not changes:
        return {**_apartment_out(active), "previous_apartment_id": None}

    if changes.get("floor"):
        _ensure_floor(db, active.building, changes["floor"])
    # Versioned update (fixes19): retire the current row, insert the new one.
    # There is no user behind an API call, so the retired row's editor_id
    # stays NULL.
    new = _apply_versioned_update(db, active, changes, {}, SimpleNamespace(id=None))
    return {**_apartment_out(new), "previous_apartment_id": active.id}
