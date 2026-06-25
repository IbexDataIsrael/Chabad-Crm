"""Area CRUD (geographic areas with optional drawn polygon), org-scoped.

Reads: any authenticated user. Mutations: admins only.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import AreaCreate, AreaOut, AreaUpdate, ContactOut

router = APIRouter(prefix="/api/areas", tags=["areas"])


def _get_or_404(area_id: int, org_id: int, db: Session) -> models.Area:
    area = (
        db.query(models.Area)
        .filter(models.Area.id == area_id, models.Area.organization_id == org_id)
        .first()
    )
    if not area:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Area not found")
    return area


@router.get("", response_model=list[AreaOut])
def list_areas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.Area)
        .filter(models.Area.organization_id == current_user.organization_id)
        .order_by(models.Area.area_name)
        .all()
    )


@router.post("", response_model=AreaOut, status_code=status.HTTP_201_CREATED)
def create_area(
    payload: AreaCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    area = models.Area(**payload.model_dump(), organization_id=admin.organization_id)
    db.add(area)
    db.commit()
    db.refresh(area)
    return area


@router.get("/{area_id}", response_model=AreaOut)
def get_area(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_or_404(area_id, current_user.organization_id, db)


@router.put("/{area_id}", response_model=AreaOut)
def update_area(
    area_id: int,
    payload: AreaUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    area = _get_or_404(area_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(area, field, value)
    db.commit()
    db.refresh(area)
    return area


@router.delete("/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_area(
    area_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    area = _get_or_404(area_id, admin.organization_id, db)
    db.delete(area)
    db.commit()


@router.get("/{area_id}/shluchim", response_model=list[ContactOut])
def area_shluchim(
    area_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Shliach contacts covering any apartment within this area."""
    org_id = current_user.organization_id
    _get_or_404(area_id, org_id, db)
    return (
        db.query(models.Contact)
        .join(models.ContactShliach, models.ContactShliach.contact_id == models.Contact.id)
        .join(
            models.ContactShliachApartment,
            models.ContactShliachApartment.contact_shliach_id == models.ContactShliach.id,
        )
        .join(
            models.Apartment,
            models.Apartment.id == models.ContactShliachApartment.apartment_id,
        )
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .filter(
            models.Building.area_id == area_id,
            models.Contact.organization_id == org_id,
        )
        .distinct()
        .order_by(models.Contact.name)
        .all()
    )
