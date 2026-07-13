"""Apartment CRUD (belong to a building), org-scoped.

Apartments are created inline from the contact forms, so create/update are open to
any authenticated user; delete is admin-only. The batch endpoint (fixes7 §5)
creates the Cartesian product of selected floors × labels in one transaction.

fixes19 §3 — versioning: an update never overwrites a row. The current row is
retired (is_display=False, stamped with last_edit + editor_id) and a new active
row is inserted; `root_id` chains a lineage together. Every list/read is scoped
to active rows; only admins may read historical snapshots (the history view).
"""
import datetime

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, nullslast, or_, select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.picklist_utils import validate_picklist_value
from app.schemas import (
    ApartmentBatchCreate,
    ApartmentBatchResult,
    ApartmentCreate,
    ApartmentListOut,
    ApartmentOut,
    ApartmentPageOut,
    ApartmentUpdate,
    ApartmentVersionOut,
)

router = APIRouter(prefix="/api/apartments", tags=["apartments"])

# Apartment columns constrained by an org-managed picklist (fixes7 §4).
_APARTMENT_PICKLISTS = {
    "jewish_status": "apartment.Jewish_status",
    "campaign_status": "apartment.campaign_status",
    "mezuzah_status": "apartment.mezuzah_status",
    "language": "apartment.language",  # fixes13
}


def _validate_apartment_picklists(data: dict, org_id: int, db: Session) -> None:
    for field, field_key in _APARTMENT_PICKLISTS.items():
        if field in data and data[field] is not None:
            validate_picklist_value(db, org_id, field_key, data[field])


def _validate_report_number(data: dict, org_id: int, db: Session) -> None:
    """fixes19: the linked report number must exist within the org."""
    rn_id = data.get("report_number_id")
    if rn_id is None:
        return
    ok = (
        db.query(models.ReportNumber)
        .filter(
            models.ReportNumber.id == rn_id,
            models.ReportNumber.organization_id == org_id,
        )
        .first()
    )
    if not ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "report_number_id does not exist"
        )


def _shliach_apartment_ids(db: Session, user: models.User) -> list[int]:
    """Apartment ids visible to a shliach user (fixes19: derived from the areas
    they cover — the apartment-coverage bridge was dropped): apartments of
    buildings inside their covered areas."""
    shliach = (
        db.query(models.ContactShliach)
        .filter(models.ContactShliach.user_id == user.id)
        .first()
    )
    if not shliach:
        return []
    area_ids = [
        row.area_id
        for row in db.query(models.ContactShliachArea.area_id)
        .filter(models.ContactShliachArea.contact_shliach_id == shliach.id)
        .all()
    ]
    if not area_ids:
        return []
    return [
        row.id
        for row in db.query(models.Apartment.id)
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .filter(models.Building.area_id.in_(area_ids))
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
    out = ApartmentListOut.model_validate(a)
    out.building_name = building.building_name if building else None
    out.building_address = building.building_address if building else None
    out.area_name = area.area_name if area else None
    out.contact_id = contact.id if contact else None
    out.contact_name = contact_name
    return out


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


def _validate_building(building_id: int, org_id: int, db: Session) -> models.Building:
    building = (
        db.query(models.Building)
        .filter(
            models.Building.id == building_id,
            models.Building.organization_id == org_id,
        )
        .first()
    )
    if not building:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "building_id does not exist")
    return building


@router.get("", response_model=list[ApartmentOut])
def list_apartments(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    building_id: Optional[int] = None,
    q: Optional[str] = None,
):
    query = db.query(models.Apartment).filter(
        models.Apartment.organization_id == current_user.organization_id,
        models.Apartment.is_display.is_(True),  # active versions only (fixes19)
    )
    # fixes11 §1.2: a shliach only gets the apartments they cover (the enriched
    # /list endpoint was already scoped; the plain list feeds the pickers).
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return []
        query = query.filter(models.Apartment.id.in_(ids))
    if building_id is not None:
        query = query.filter(models.Apartment.building_id == building_id)
    if q:
        query = query.filter(models.Apartment.apartment_name.ilike(f"%{q}%"))
    return query.order_by(models.Apartment.apartment_name).all()


def _natural(col, db: Session):
    """Natural sort keys that respect the alphabet (fixes17 §3.2).

    Pure-numeric values keep the natural (length, value) ordering — '2' before
    '10' — while anything containing a non-digit sorts plainly alphabetically.
    The old unconditional (length, value) key broke alphabetical labels
    ('Bet' sorted before 'Aleph' because it's shorter). Digit detection is
    dialect-specific: regex on PostgreSQL, GLOB on SQLite (tests)."""
    if db.get_bind().dialect.name == "postgresql":
        is_numeric = col.op("~")(r"^\d+$")
    else:
        is_numeric = ~col.op("GLOB")("*[^0-9]*")
    # NULL values keep sorting last (the caller wraps keys in nullslast).
    return [
        case((col.is_(None), None), (is_numeric, func.length(col)), else_=0),
        col,
    ]


def _floor_rank():
    """The apartment's floor position within its building (floors.sort_order),
    resolved by name via a correlated subquery — apartments.floor is free text,
    so a join could duplicate rows if two floors ever share a name."""
    return (
        select(func.min(models.Floor.sort_order))
        .where(
            models.Floor.building_id == models.Apartment.building_id,
            models.Floor.name == models.Apartment.floor,
        )
        .correlate(models.Apartment)
        .scalar_subquery()
    )


def _sort_keys(sort: str, db: Session) -> list:
    """Direction-sensitive primary keys per sort option (fixes8 §1D). The caller
    appends the always-ascending secondaries."""
    if sort == "label":
        return _natural(models.Apartment.apartment_name, db)
    if sort == "resident":
        return [models.Apartment.name]  # plain alphabetical — names aren't numeric
    if sort == "building":
        return [models.Building.building_address]
    if sort == "created":
        return [models.Apartment.created_at]  # fixes17 §3.2
    # Default "floor": canonical floor order, then the free-text floor name for
    # floors that no longer exist in the floors table.
    return [_floor_rank(), *_natural(models.Apartment.floor, db)]


@router.get("/list", response_model=ApartmentPageOut)
def list_apartments_enriched(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    building_id: Optional[int] = None,
    area_id: Optional[int] = None,
    area_ids: Optional[list[int]] = Query(None),
    apartment_id: Optional[int] = None,
    q: Optional[str] = None,
    jewish_status: Optional[list[str]] = Query(None),
    mezuzah_status: Optional[list[str]] = Query(None),
    sort: Literal["floor", "label", "resident", "building", "created"] = "floor",
    dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
):
    """One page of apartments enriched with building/area + linked contact, for
    the apartments page. Shliach users see only the apartments they cover.

    Filters: `building_id` / `area_id` bound the list (fixes8 §2A lazy loading);
    `apartment_id` returns a single enriched row (detail page); `q` matches the
    street name in the parent building address (plus label / resident name);
    fixes18 §5.2: `jewish_status` / `mezuzah_status` match the picklist columns.
    fixes19: only active versions (is_display) are returned.
    Sorting (fixes8 §1D) defaults to floor, then apartment number within a floor;
    `dir` flips the primary key only. Pagination (fixes8 §2C) is server-side."""
    if page_size not in (20, 50, 100):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "page_size must be 20, 50 or 100"
        )
    query = (
        db.query(models.Apartment)
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .filter(
            models.Apartment.organization_id == current_user.organization_id,
            models.Apartment.is_display.is_(True),  # active versions only (fixes19)
        )
    )
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return ApartmentPageOut(items=[], total=0, page=page, page_size=page_size)
        query = query.filter(models.Apartment.id.in_(ids))
    if building_id is not None:
        query = query.filter(models.Apartment.building_id == building_id)
    if area_id is not None:
        query = query.filter(models.Building.area_id == area_id)
    # fixes15 §7.1: multi-select area filter (repeated ?area_ids=… params).
    if area_ids:
        query = query.filter(models.Building.area_id.in_(area_ids))
    if apartment_id is not None:
        query = query.filter(models.Apartment.id == apartment_id)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                models.Building.building_address.ilike(like),
                models.Building.building_name.ilike(like),
                models.Apartment.apartment_name.ilike(like),
                models.Apartment.name.ilike(like),
            )
        )
    # fixes18 §5.2: picklist-column filters (multi-select, OR within a field).
    if jewish_status:
        query = query.filter(models.Apartment.jewish_status.in_(jewish_status))
    if mezuzah_status:
        query = query.filter(models.Apartment.mezuzah_status.in_(mezuzah_status))

    total = query.count()

    primary = [k.desc() if dir == "desc" else k.asc() for k in _sort_keys(sort, db)]
    # Secondary keys always ascend: within a floor, apartments sort by number.
    secondary = (
        [] if sort == "label" else _natural(models.Apartment.apartment_name, db)
    )
    order = [nullslast(k) for k in (*primary, *secondary)]
    rows = (
        query.order_by(*order, models.Apartment.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return ApartmentPageOut(
        items=[_enrich(a) for a in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


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
    _validate_apartment_picklists(data, org_id, db)
    _validate_report_number(data, org_id, db)
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


@router.post(
    "/batch", response_model=ApartmentBatchResult, status_code=status.HTTP_201_CREATED
)
def batch_create_apartments(
    payload: ApartmentBatchCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Bulk generator (fixes7 §5): insert the full floors × labels matrix in one
    transaction, skipping combinations that already exist in the building."""
    org_id = current_user.organization_id
    building = _validate_building(payload.building_id, org_id, db)

    floors_by_id = {f.id: f for f in building.floors}
    floors = []
    for floor_id in dict.fromkeys(payload.floor_ids):  # de-dupe, keep order
        floor = floors_by_id.get(floor_id)
        if floor is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"floor {floor_id} does not belong to this building",
            )
        floors.append(floor)
    labels = [l.strip() for l in dict.fromkeys(payload.labels) if l.strip()]
    if not floors or not labels:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Select at least one floor and one label"
        )

    existing = {
        (ap.floor or "", ap.apartment_name or "")
        for ap in db.query(models.Apartment)
        .filter(
            models.Apartment.building_id == building.id,
            models.Apartment.is_display.is_(True),  # active versions only (fixes19)
        )
        .all()
    }
    created = 0
    skipped = 0
    for floor in floors:
        for label in labels:
            if (floor.name, label) in existing:
                skipped += 1
                continue
            db.add(
                models.Apartment(
                    organization_id=org_id,
                    building_id=building.id,
                    apartment_name=label,
                    floor=floor.name,
                )
            )
            created += 1
    db.commit()  # single transaction for the whole matrix
    return ApartmentBatchResult(created=created, skipped=skipped)


# The data columns copied from a retired version into its successor (fixes19).
_VERSIONED_COLUMNS = (
    "building_id",
    "apartment_name",
    "apartment_notes",
    "floor",
    "jewish_status",
    "campaign_status",
    "mezuzah_status",
    "language",
    "name",
    "phone",
    "email",
    "report_number_id",
)


@router.get("/{apartment_id}/history", response_model=list[ApartmentVersionOut])
def apartment_history(
    apartment_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Previous versions of this apartment's lineage, newest first — the admin
    history view (fixes19 §3). Each row is a full read-only snapshot plus the
    editor's name and the retirement time."""
    a = _get_or_404(apartment_id, admin.organization_id, db)
    root_id = a.root_id or a.id
    versions = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.organization_id == admin.organization_id,
            models.Apartment.is_display.is_(False),
            or_(
                models.Apartment.root_id == root_id,
                models.Apartment.id == root_id,
            ),
        )
        .order_by(
            models.Apartment.last_edit.desc().nullslast(), models.Apartment.id.desc()
        )
        .all()
    )
    out = []
    for v in versions:
        item = ApartmentVersionOut.model_validate(v)
        item.editor_name = v.editor.full_name if v.editor else None
        out.append(item)
    return out


@router.get("/{apartment_id}", response_model=ApartmentOut)
def get_apartment(
    apartment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    a = _get_or_404(apartment_id, current_user.organization_id, db)
    # fixes19 §3: historical versions are admin-only (the mekurav-facing views
    # must never see anything but the current version).
    if not a.is_display and current_user.role != "admin":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    return a


@router.put("/{apartment_id}", response_model=ApartmentOut)
def update_apartment(
    apartment_id: int,
    payload: ApartmentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Versioned update (fixes19 §3): the current row is retired
    (is_display=False + last_edit/editor_id stamp) and a new active row with the
    updated values is inserted and returned. References from mekurav contacts
    follow the new row."""
    org_id = current_user.organization_id
    a = _get_or_404(apartment_id, org_id, db)
    if not a.is_display:
        # Historical snapshots are immutable.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    data = payload.model_dump(exclude_unset=True)
    if "building_id" in data and data["building_id"] is not None:
        _validate_building(data["building_id"], org_id, db)
    _validate_apartment_picklists(data, org_id, db)
    _validate_report_number(data, org_id, db)

    # 1. Retire the current version.
    a.is_display = False
    a.last_edit = datetime.datetime.utcnow()
    a.editor_id = current_user.id

    # 2. Insert the new active version (copy + updates applied). The original
    #    created_at is carried over — it's the apartment's creation date, not
    #    the version's.
    values = {col: getattr(a, col) for col in _VERSIONED_COLUMNS}
    for field, value in data.items():
        values[field] = value
    new = models.Apartment(
        **values,
        organization_id=org_id,
        is_display=True,
        root_id=a.root_id or a.id,
        created_at=a.created_at,
    )
    db.add(new)
    db.flush()

    # 3. Contact links follow the active version.
    db.query(models.ContactMekurav).filter(
        models.ContactMekurav.apartment_id == a.id
    ).update({models.ContactMekurav.apartment_id: new.id}, synchronize_session=False)

    db.commit()
    db.refresh(new)
    return new


@router.delete("/{apartment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_apartment(
    apartment_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    a = _get_or_404(apartment_id, admin.organization_id, db)
    # fixes19: remove the whole lineage — historical versions must not linger
    # (invisibly) after their apartment is gone.
    root_id = a.root_id or a.id
    lineage = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.organization_id == admin.organization_id,
            or_(
                models.Apartment.root_id == root_id,
                models.Apartment.id == root_id,
            ),
        )
        .all()
    )
    for row in lineage:
        db.delete(row)
    db.commit()
