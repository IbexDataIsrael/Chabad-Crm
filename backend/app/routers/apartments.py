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
from app.schemas import ApartmentCreate, ApartmentOut, ApartmentUpdate

router = APIRouter(prefix="/api/apartments", tags=["apartments"])


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


@router.post("", response_model=ApartmentOut, status_code=status.HTTP_201_CREATED)
def create_apartment(
    payload: ApartmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _validate_building(payload.building_id, current_user.organization_id, db)
    a = models.Apartment(
        **payload.model_dump(), organization_id=current_user.organization_id
    )
    db.add(a)
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
