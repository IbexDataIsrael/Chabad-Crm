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


def _shliach_area_ids(user: models.User, db: Session) -> set[int]:
    """Area ids a shliach user covers — assigned directly (contact_shliach_area)
    or via an apartment whose building sits in the area."""
    cs_ids = [
        row[0]
        for row in db.query(models.ContactShliach.id)
        .filter(
            models.ContactShliach.user_id == user.id,
            models.ContactShliach.organization_id == user.organization_id,
        )
        .all()
    ]
    if not cs_ids:
        return set()
    direct = db.query(models.ContactShliachArea.area_id).filter(
        models.ContactShliachArea.contact_shliach_id.in_(cs_ids)
    )
    via_apartment = (
        db.query(models.Building.area_id)
        .join(models.Apartment, models.Apartment.building_id == models.Building.id)
        .join(
            models.ContactShliachApartment,
            models.ContactShliachApartment.apartment_id == models.Apartment.id,
        )
        .filter(models.ContactShliachApartment.contact_shliach_id.in_(cs_ids))
    )
    return {r[0] for r in direct.all()} | {r[0] for r in via_apartment.all()}


@router.get("", response_model=list[AreaOut])
def list_areas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Area).filter(
        models.Area.organization_id == current_user.organization_id
    )
    # A shliach only sees the areas they cover; admins/staff see all org areas.
    if current_user.role == "shliach":
        area_ids = _shliach_area_ids(current_user, db)
        if not area_ids:
            return []
        query = query.filter(models.Area.id.in_(area_ids))
    return query.order_by(models.Area.area_name).all()


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
    area = _get_or_404(area_id, current_user.organization_id, db)
    # A shliach may only read an area they cover.
    if current_user.role == "shliach" and area.id not in _shliach_area_ids(
        current_user, db
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Area not found")
    return area


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
    """Shliach contacts covering this area — directly (contact_shliach_area) or via
    an apartment within the area."""
    org_id = current_user.organization_id
    _get_or_404(area_id, org_id, db)

    # Shliach records that cover an apartment in this area.
    via_apartment = (
        db.query(models.ContactShliach.contact_id)
        .join(
            models.ContactShliachApartment,
            models.ContactShliachApartment.contact_shliach_id == models.ContactShliach.id,
        )
        .join(
            models.Apartment,
            models.Apartment.id == models.ContactShliachApartment.apartment_id,
        )
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .filter(models.Building.area_id == area_id)
    )
    # Shliach records assigned to the area directly.
    via_area = (
        db.query(models.ContactShliach.contact_id)
        .join(
            models.ContactShliachArea,
            models.ContactShliachArea.contact_shliach_id == models.ContactShliach.id,
        )
        .filter(models.ContactShliachArea.area_id == area_id)
    )
    contact_ids = {row[0] for row in via_apartment.all()} | {
        row[0] for row in via_area.all()
    }
    if not contact_ids:
        return []
    return (
        db.query(models.Contact)
        .filter(
            models.Contact.id.in_(contact_ids),
            models.Contact.organization_id == org_id,
        )
        .order_by(models.Contact.name)
        .all()
    )
