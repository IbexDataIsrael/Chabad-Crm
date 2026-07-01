"""Apartment CRUD (belong to a building), org-scoped.

Apartments are created inline from the contact forms, so create/update are open to
any authenticated user; delete is admin-only.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    ApartmentCreate,
    ApartmentListOut,
    ApartmentOut,
    ApartmentUpdate,
)

router = APIRouter(prefix="/api/apartments", tags=["apartments"])


def _shliach_apartment_ids(db: Session, user: models.User) -> list[int]:
    """Apartment ids covered by the shliach contact linked to this user."""
    shliach = (
        db.query(models.ContactShliach)
        .filter(models.ContactShliach.user_id == user.id)
        .first()
    )
    if not shliach:
        return []
    return [
        row.apartment_id
        for row in db.query(models.ContactShliachApartment.apartment_id)
        .filter(models.ContactShliachApartment.contact_shliach_id == shliach.id)
        .all()
    ]


def _enrich(a: models.Apartment) -> ApartmentListOut:
    building = a.building
    area = building.area if building else None
    mekurav = a.mekuravim[0] if a.mekuravim else None
    contact = mekurav.contact if mekurav else None
    contact_name = None
    if contact:
        contact_name = f"{contact.name} {contact.last_name or ''}".strip()
    return ApartmentListOut(
        id=a.id,
        guid=a.guid,
        building_id=a.building_id,
        apartment_name=a.apartment_name,
        apartment_notes=a.apartment_notes,
        building_name=building.building_name if building else None,
        area_name=area.area_name if area else None,
        contact_id=contact.id if contact else None,
        contact_name=contact_name,
    )


def _get_or_404(apartment_id: int, org_id: int, db: Session) -> models.Apartment:
    a = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.id == apartment_id,
            models.Apartment.organization_id == org_id,
        )
        .first()
    )
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    return a


def _validate_building(building_id: int, org_id: int, db: Session) -> None:
    ok = (
        db.query(models.Building)
        .filter(
            models.Building.id == building_id,
            models.Building.organization_id == org_id,
        )
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "building_id does not exist")


@router.get("", response_model=list[ApartmentOut])
def list_apartments(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    building_id: Optional[int] = None,
    q: Optional[str] = None,
):
    query = db.query(models.Apartment).filter(
        models.Apartment.organization_id == current_user.organization_id
    )
    if building_id is not None:
        query = query.filter(models.Apartment.building_id == building_id)
    if q:
        query = query.filter(models.Apartment.apartment_name.ilike(f"%{q}%"))
    return query.order_by(models.Apartment.apartment_name).all()


@router.get("/list", response_model=list[ApartmentListOut])
def list_apartments_enriched(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Apartments enriched with building/area + linked contact, for the apartments
    page. Shliach users see only the apartments they cover."""
    query = db.query(models.Apartment).filter(
        models.Apartment.organization_id == current_user.organization_id
    )
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return []
        query = query.filter(models.Apartment.id.in_(ids))
    rows = query.order_by(models.Apartment.apartment_name).all()
    return [_enrich(a) for a in rows]


@router.post("", response_model=ApartmentOut, status_code=status.HTTP_201_CREATED)
def create_apartment(
    payload: ApartmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    _validate_building(payload.building_id, org_id, db)
    data = payload.model_dump()
    contact_id = data.pop("contact_id", None)
    a = models.Apartment(**data, organization_id=org_id)
    db.add(a)
    db.flush()

    # Optionally link an existing mekurav contact to this apartment.
    if contact_id is not None:
        contact = (
            db.query(models.Contact)
            .filter(
                models.Contact.id == contact_id,
                models.Contact.organization_id == org_id,
            )
            .first()
        )
        if not contact:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "contact_id does not exist")
        if contact.mekurav is None:
            contact.mekurav = models.ContactMekurav(
                organization_id=org_id, contact_id=contact.id
            )
            db.flush()
        contact.mekurav.apartment_id = a.id

    db.commit()
    db.refresh(a)
    return a


@router.get("/{apartment_id}", response_model=ApartmentOut)
def get_apartment(
    apartment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_or_404(apartment_id, current_user.organization_id, db)


@router.put("/{apartment_id}", response_model=ApartmentOut)
def update_apartment(
    apartment_id: int,
    payload: ApartmentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    a = _get_or_404(apartment_id, current_user.organization_id, db)
    data = payload.model_dump(exclude_unset=True)
    if "building_id" in data and data["building_id"] is not None:
        _validate_building(data["building_id"], current_user.organization_id, db)
    for field, value in data.items():
        setattr(a, field, value)
    db.commit()
    db.refresh(a)
    return a


@router.delete("/{apartment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_apartment(
    apartment_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    a = _get_or_404(apartment_id, admin.organization_id, db)
    db.delete(a)
    db.commit()
