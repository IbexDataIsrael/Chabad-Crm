"""Building CRUD (belong to an area) + nested floor CRUD, org-scoped.
Mutations: admins only. Creating a building can auto-create its floors (fixes7)."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import nullslast
from sqlalchemy.orm import Session, selectinload

from app import models
from app.core.display import building_display_name
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    BuildingCreate,
    BuildingOut,
    BuildingPageOut,
    BuildingUpdate,
    FloorCreate,
    FloorOut,
    FloorUpdate,
)

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


def _get_floor_or_404(
    floor_id: int, building: models.Building, db: Session
) -> models.Floor:
    f = (
        db.query(models.Floor)
        .filter(
            models.Floor.id == floor_id,
            models.Floor.building_id == building.id,
        )
        .first()
    )
    if not f:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Floor not found")
    return f


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
    query = db.query(models.Building).options(
        selectinload(models.Building.floors)
    ).filter(
        models.Building.organization_id == current_user.organization_id
    )
    if area_id is not None:
        query = query.filter(models.Building.area_id == area_id)
    return query.order_by(models.Building.building_address).all()


@router.get("/list", response_model=BuildingPageOut)
def list_buildings_paginated(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    area_id: Optional[int] = None,
    area_ids: Optional[list[int]] = Query(None),
    sort: Literal["address", "name", "area", "created"] = "address",
    dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
):
    """One server-side page of buildings (fixes12 §3.3, same envelope pattern
    as contacts/apartments). The plain list keeps feeding the pickers.
    fixes15 §7.1: sortable (`sort`+`dir`) and filterable by several areas at
    once (repeated ?area_ids=… params; the single `area_id` stays supported)."""
    if page_size not in (20, 50, 100):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "page_size must be 20, 50 or 100"
        )
    query = db.query(models.Building).options(
        selectinload(models.Building.floors)
    ).filter(
        models.Building.organization_id == current_user.organization_id
    )
    if area_id is not None:
        query = query.filter(models.Building.area_id == area_id)
    if area_ids:
        query = query.filter(models.Building.area_id.in_(area_ids))
    total = query.count()
    if sort == "name":
        key = models.Building.building_name
    elif sort == "area":
        # Alphabetical by the parent area's name. fixes33 §2.2: area_id is now
        # nullable (an unassigned building keeps existing) — an inner join
        # would silently drop those rows from this page's results even though
        # `total` above already counted them.
        query = query.outerjoin(models.Area, models.Area.id == models.Building.area_id)
        key = models.Area.area_name
    elif sort == "created":
        key = models.Building.created_at
    else:
        key = models.Building.building_address
    rows = (
        query.order_by(
            nullslast(key.desc() if dir == "desc" else key.asc()),
            models.Building.id,
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return BuildingPageOut(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=BuildingOut, status_code=status.HTTP_201_CREATED)
def create_building(
    payload: BuildingCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    _validate_area(payload.area_id, admin.organization_id, db)
    data = payload.model_dump(exclude={"floors"})
    b = models.Building(**data, organization_id=admin.organization_id)
    db.add(b)
    db.flush()
    if b.is_town_house:
        # fixes19 §4: a town house (בית פרטי) gets no floors — spawn exactly
        # one apartment unit named "<building name>-th" instead.
        db.add(
            models.Apartment(
                organization_id=admin.organization_id,
                building_id=b.id,
                apartment_name=f"{building_display_name(b)}-th",
            )
        )
    else:
        # Creation hook (fixes7 §3): auto-populate the building's floor records.
        for index, floor_name in enumerate(payload.floors):
            if not floor_name.strip():
                continue
            db.add(
                models.Floor(
                    organization_id=admin.organization_id,
                    building_id=b.id,
                    name=floor_name.strip(),
                    sort_order=index,
                )
            )
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


# --- Floors (fixes7 §3) ------------------------------------------------------
@router.get("/{building_id}/floors", response_model=list[FloorOut])
def list_floors(
    building_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    b = _get_or_404(building_id, current_user.organization_id, db)
    return b.floors


@router.post(
    "/{building_id}/floors",
    response_model=FloorOut,
    status_code=status.HTTP_201_CREATED,
)
def add_floor(
    building_id: int,
    payload: FloorCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    b = _get_or_404(building_id, admin.organization_id, db)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Floor name is required")
    sort_order = payload.sort_order
    if sort_order is None:
        sort_order = (b.floors[-1].sort_order + 1) if b.floors else 0
    f = models.Floor(
        organization_id=admin.organization_id,
        building_id=b.id,
        name=name,
        sort_order=sort_order,
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.put("/{building_id}/floors/{floor_id}", response_model=FloorOut)
def update_floor(
    building_id: int,
    floor_id: int,
    payload: FloorUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    b = _get_or_404(building_id, admin.organization_id, db)
    f = _get_floor_or_404(floor_id, b, db)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and (data["name"] is None or not data["name"].strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Floor name is required")
    for field, value in data.items():
        setattr(f, field, value.strip() if field == "name" else value)
    db.commit()
    db.refresh(f)
    return f


@router.delete(
    "/{building_id}/floors/{floor_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_floor(
    building_id: int,
    floor_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    b = _get_or_404(building_id, admin.organization_id, db)
    f = _get_floor_or_404(floor_id, b, db)
    db.delete(f)
    db.commit()
