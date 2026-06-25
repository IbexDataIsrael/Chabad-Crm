"""Building CRUD (belong to an area), org-scoped. Mutations: admins only."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import BuildingCreate, BuildingOut, BuildingUpdate

router = APIRouter(prefix="/api/buildings", tags=["buildings"])


def _get_or_404(building_id: int, org_id: int, db: Session) -> models.Building:
    b = (
        db.query(models.Building)
        .filter(
            models.Building.id == building_id,
            models.Building.organization_id == org_id,
        )
        .first()
    )
    if not b:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Building not found")
    return b


def _validate_area(area_id: int, org_id: int, db: Session) -> None:
    ok = (
        db.query(models.Area)
        .filter(models.Area.id == area_id, models.Area.organization_id == org_id)
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "area_id does not exist")


@router.get("", response_model=list[BuildingOut])
def list_buildings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    area_id: Optional[int] = None,
):
    query = db.query(models.Building).filter(
        models.Building.organization_id == current_user.organization_id
    )
    if area_id is not None:
        query = query.filter(models.Building.area_id == area_id)
    return query.order_by(models.Building.building_name).all()


@router.post("", response_model=BuildingOut, status_code=status.HTTP_201_CREATED)
def create_building(
    payload: BuildingCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    _validate_area(payload.area_id, admin.organization_id, db)
    b = models.Building(**payload.model_dump(), organization_id=admin.organization_id)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


@router.get("/{building_id}", response_model=BuildingOut)
def get_building(
    building_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_or_404(building_id, current_user.organization_id, db)


@router.put("/{building_id}", response_model=BuildingOut)
def update_building(
    building_id: int,
    payload: BuildingUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    b = _get_or_404(building_id, admin.organization_id, db)
    data = payload.model_dump(exclude_unset=True)
    if "area_id" in data and data["area_id"] is not None:
        _validate_area(data["area_id"], admin.organization_id, db)
    for field, value in data.items():
        setattr(b, field, value)
    db.commit()
    db.refresh(b)
    return b


@router.delete("/{building_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_building(
    building_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    b = _get_or_404(building_id, admin.organization_id, db)
    db.delete(b)
    db.commit()
