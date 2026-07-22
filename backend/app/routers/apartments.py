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

from app import custom_field_utils, models, picklist_utils
from app.core.shliach import resolve_shliach
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.picklist_utils import validate_picklist_value
from app.schemas import (
    ApartmentBatchCreate,
    ApartmentBatchResult,
    ApartmentBulkUpdate,
    ApartmentBulkUpdateResult,
    ApartmentCreate,
    ApartmentListOut,
    ApartmentOut,
    ApartmentPageOut,
    ApartmentRestoreField,
    ApartmentUpdate,
    ApartmentVersionOut,
    BuildingAggregate,
    ReportNumberBuildingLink,
)

router = APIRouter(prefix="/api/apartments", tags=["apartments"])

# Apartment fields constrained by an org-managed picklist (fixes7 §4). Values
# live in PicklistLink (fixes32) — these 4 keep dedicated API fields for
# backward compatibility; any other apartment.* picklist is dynamic (see
# ApartmentOut.picklist_values).
_APARTMENT_PICKLISTS = {
    "jewish_status": "apartment.Jewish_status",
    "campaign_status": "apartment.campaign_status",
    "mezuzah_status": "apartment.mezuzah_status",
    "language": "apartment.language",  # fixes13
}


def _validate_picklist_changes(changes: dict, org_id: int, db: Session) -> None:
    """`changes` is field_key -> value (already resolved — fixed field names
    translated to their field_key, custom picklist_values entries as-is)."""
    for field_key, value in changes.items():
        if value is not None:
            validate_picklist_value(db, org_id, field_key, value)


def _split_picklist_changes(data: dict) -> dict[str, Optional[str]]:
    """Pop the 4 fixed picklist fields + the custom `picklist_values` dict out
    of a payload dict (mutates `data`), returning one field_key -> value dict
    (fixes32) ready for `_validate_picklist_changes` / `picklist_utils.set_value`."""
    changes: dict[str, Optional[str]] = {}
    for field, field_key in _APARTMENT_PICKLISTS.items():
        if field in data:
            changes[field_key] = data.pop(field)
    custom = data.pop("picklist_values", None) or {}
    changes.update(custom)
    return changes


def _split_custom_field_changes(data: dict):
    """fixes35: pop the `custom_field_values` dict out of a payload dict
    (mutates `data`) — the non-select custom-field counterpart to
    `_split_picklist_changes`."""
    return data.pop("custom_field_values", None) or {}


def _apply_picklist_fields(out, values: dict[str, Optional[str]]) -> None:
    """Populate an ApartmentOut's 4 fixed fields + the dynamic picklist_values
    dict from a resolved {field_key: value} map."""
    for field, field_key in _APARTMENT_PICKLISTS.items():
        setattr(out, field, values.get(field_key))
    out.picklist_values = {
        k: v for k, v in values.items() if k not in _APARTMENT_PICKLISTS.values()
    }


def _apartment_out(
    db: Session,
    a: models.Apartment,
    picklist_map: Optional[dict] = None,
    custom_field_map: Optional[dict] = None,
) -> ApartmentOut:
    values = (
        picklist_map
        if picklist_map is not None
        else picklist_utils.get_values(db, a.organization_id, "apartments", a.id)
    )
    out = ApartmentOut.model_validate(a)
    _apply_picklist_fields(out, values)
    out.custom_field_values = (
        custom_field_map
        if custom_field_map is not None
        else custom_field_utils.get_values(db, a.organization_id, "apartment", a.id)
    )
    return out


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
    """Apartment ids visible to a shliach user: apartments whose report number
    is assigned to them (fixes20 §4 — the point of the report-number
    association) plus apartments of buildings inside their covered areas
    (fixes19). fixes21 §1: the shliach contact is resolved by the user_id link
    *or* by matching email, so an unlinked (e.g. imported) shliach still sees
    their apartments."""
    shliach = resolve_shliach(db, user)
    if not shliach:
        return []
    ids: set[int] = set()
    report_number_ids = [
        row.report_number_id
        for row in db.query(models.ReportNumberContactShliach.report_number_id)
        .filter(models.ReportNumberContactShliach.contact_shliach_id == shliach.id)
        .all()
    ]
    if report_number_ids:
        ids.update(
            row.id
            for row in db.query(models.Apartment.id)
            .filter(models.Apartment.report_number_id.in_(report_number_ids))
            .all()
        )
    area_ids = [
        row.area_id
        for row in db.query(models.ContactShliachArea.area_id)
        .filter(models.ContactShliachArea.contact_shliach_id == shliach.id)
        .all()
    ]
    if area_ids:
        ids.update(
            row.id
            for row in db.query(models.Apartment.id)
            .join(models.Building, models.Building.id == models.Apartment.building_id)
            .filter(models.Building.area_id.in_(area_ids))
            .all()
        )
    return sorted(ids)


def _enrich(
    a: models.Apartment,
    picklist_map: dict[str, Optional[str]],
    custom_field_map: Optional[dict] = None,
) -> ApartmentListOut:
    building = a.building
    area = building.area if building else None
    mekurav = a.mekuravim[0] if a.mekuravim else None
    contact = mekurav.contact if mekurav else None
    contact_name = None
    if contact:
        contact_name = f"{contact.name} {contact.last_name or ''}".strip()
    out = ApartmentListOut.model_validate(a)
    _apply_picklist_fields(out, picklist_map)
    out.custom_field_values = custom_field_map or {}
    out.building_name = building.building_name if building else None
    out.building_address = building.building_address if building else None
    out.area_name = area.area_name if area else None
    out.contact_id = contact.id if contact else None
    out.contact_name = contact_name
    # fixes20 §3: the linked report number's name for the table column.
    out.report_number_name = a.report_number.name if a.report_number else None
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
    rows = query.order_by(models.Apartment.apartment_name).all()
    picklist_map = picklist_utils.get_values_bulk(
        db, current_user.organization_id, "apartments", [r.id for r in rows]
    )
    custom_field_map = custom_field_utils.get_values_bulk(
        db, current_user.organization_id, "apartment", [r.id for r in rows]
    )
    return [
        _apartment_out(db, a, picklist_map.get(a.id, {}), custom_field_map.get(a.id, {}))
        for a in rows
    ]


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


def _picklist_filter(query, field_key: str, values: list[str]):
    """Restrict to apartments whose stored value for `field_key` (fixes32:
    PicklistLink, not a real column) is one of `values`."""
    return query.filter(
        models.Apartment.id.in_(
            picklist_utils.matching_entity_ids("apartments", field_key, values)
        )
    )


def _apply_apartment_filters(
    query,
    *,
    building_id: Optional[int] = None,
    building_ids: Optional[list[int]] = None,
    area_id: Optional[int] = None,
    area_ids: Optional[list[int]] = None,
    apartment_id: Optional[int] = None,
    apartment_ids: Optional[list[int]] = None,
    report_number_ids: Optional[list[int]] = None,
    q: Optional[str] = None,
    jewish_status: Optional[list[str]] = None,
    mezuzah_status: Optional[list[str]] = None,
    campaign_status: Optional[list[str]] = None,
    language: Optional[list[str]] = None,
    custom_picklists: Optional[dict[str, list[str]]] = None,
):
    """Apply the shared apartment-list filters (fixes8/15/18/20/23). The caller's
    query must already be joined to `models.Building` (area/street filters need
    it). Used by both the paged list and the bulk-update endpoint so they always
    resolve to the same set of rows."""
    if building_id is not None:
        query = query.filter(models.Apartment.building_id == building_id)
    # fixes23 §2: multi-select building filter (repeated ?building_ids=… params).
    if building_ids:
        query = query.filter(models.Apartment.building_id.in_(building_ids))
    if area_id is not None:
        query = query.filter(models.Building.area_id == area_id)
    # fixes15 §7.1: multi-select area filter (repeated ?area_ids=… params).
    if area_ids:
        query = query.filter(models.Building.area_id.in_(area_ids))
    if apartment_id is not None:
        query = query.filter(models.Apartment.id == apartment_id)
    # fixes30 §3: explicit apartment selection (repeated ?apartment_ids=…) —
    # the report page fetches exactly the chosen apartments.
    if apartment_ids:
        query = query.filter(models.Apartment.id.in_(apartment_ids))
    # fixes20 §3: searchable report-number filter (multi-select).
    if report_number_ids:
        query = query.filter(models.Apartment.report_number_id.in_(report_number_ids))
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
    # fixes18 §5.2 / fixes32 §6: picklist filters (multi-select, OR within a
    # field, AND across fields) — the 4 fixed apartment picklists plus any
    # number of dynamic (admin-added) ones.
    if jewish_status:
        query = _picklist_filter(query, "apartment.Jewish_status", jewish_status)
    if mezuzah_status:
        query = _picklist_filter(query, "apartment.mezuzah_status", mezuzah_status)
    if campaign_status:
        query = _picklist_filter(query, "apartment.campaign_status", campaign_status)
    if language:
        query = _picklist_filter(query, "apartment.language", language)
    for field_key, values in (custom_picklists or {}).items():
        if values:
            query = _picklist_filter(query, field_key, values)
    return query


@router.get("/list", response_model=ApartmentPageOut)
def list_apartments_enriched(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    building_id: Optional[int] = None,
    building_ids: Optional[list[int]] = Query(None),
    area_id: Optional[int] = None,
    area_ids: Optional[list[int]] = Query(None),
    apartment_id: Optional[int] = None,
    apartment_ids: Optional[list[int]] = Query(None),
    report_number_ids: Optional[list[int]] = Query(None),
    q: Optional[str] = None,
    jewish_status: Optional[list[str]] = Query(None),
    mezuzah_status: Optional[list[str]] = Query(None),
    campaign_status: Optional[list[str]] = Query(None),
    language: Optional[list[str]] = Query(None),
    # fixes32 §6: dynamic filter for any custom apartment.* picklist, sent as
    # repeated "field_key:value" pairs (OR within a field_key, AND across).
    picklist: Optional[list[str]] = Query(None),
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
    custom_picklists: dict[str, list[str]] = {}
    for entry in picklist or []:
        key, sep, value = entry.partition(":")
        if sep:
            custom_picklists.setdefault(key, []).append(value)
    query = _apply_apartment_filters(
        query,
        building_id=building_id,
        building_ids=building_ids,
        area_id=area_id,
        area_ids=area_ids,
        apartment_id=apartment_id,
        apartment_ids=apartment_ids,
        report_number_ids=report_number_ids,
        q=q,
        jewish_status=jewish_status,
        mezuzah_status=mezuzah_status,
        campaign_status=campaign_status,
        language=language,
        custom_picklists=custom_picklists,
    )

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
    picklist_map = picklist_utils.get_values_bulk(
        db, current_user.organization_id, "apartments", [r.id for r in rows]
    )
    custom_field_map = custom_field_utils.get_values_bulk(
        db, current_user.organization_id, "apartment", [r.id for r in rows]
    )
    return ApartmentPageOut(
        items=[
            _enrich(a, picklist_map.get(a.id, {}), custom_field_map.get(a.id, {}))
            for a in rows
        ],
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
    picklist_changes = _split_picklist_changes(data)
    _validate_picklist_changes(picklist_changes, org_id, db)
    custom_field_changes = _split_custom_field_changes(data)
    _validate_report_number(data, org_id, db)
    a = models.Apartment(**data, organization_id=org_id)
    db.add(a)
    db.flush()
    for field_key, value in picklist_changes.items():
        if value is not None:
            picklist_utils.set_value(db, org_id, "apartments", a.id, field_key, value)
    for field_key, value in custom_field_changes.items():
        if value is not None:
            custom_field_utils.set_value(db, org_id, "apartment", a.id, field_key, value)

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
    return _apartment_out(db, a)


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


@router.get(
    "/report-number-buildings", response_model=list[ReportNumberBuildingLink]
)
def report_number_buildings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes23 §2: distinct (report number → building) pairs across the org's
    active apartments. The apartments page uses these to conditionally narrow the
    building filter — a building shows only while it holds an apartment carrying a
    selected report number. Shliach users get only their visible apartments."""
    query = db.query(
        models.Apartment.report_number_id, models.Apartment.building_id
    ).filter(
        models.Apartment.organization_id == current_user.organization_id,
        models.Apartment.is_display.is_(True),
        models.Apartment.report_number_id.isnot(None),
    )
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return []
        query = query.filter(models.Apartment.id.in_(ids))
    return [
        ReportNumberBuildingLink(report_number_id=rn_id, building_id=b_id)
        for rn_id, b_id in query.distinct().all()
    ]


@router.get("/building-aggregates", response_model=list[BuildingAggregate])
def building_aggregates(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    building_id: Optional[int] = None,
    building_ids: Optional[list[int]] = Query(None),
    area_id: Optional[int] = None,
    area_ids: Optional[list[int]] = Query(None),
    report_number_ids: Optional[list[int]] = Query(None),
    q: Optional[str] = None,
    jewish_status: Optional[list[str]] = Query(None),
    mezuzah_status: Optional[list[str]] = Query(None),
    campaign_status: Optional[list[str]] = Query(None),
    language: Optional[list[str]] = Query(None),
    picklist: Optional[list[str]] = Query(None),
):
    """fixes30 §1: apartment counts per building under the exact /list filters —
    the group-by-building view shows each building header with its full
    filtered count, not just the rows on the current page. Shliach users are
    scoped to their covered apartments like everywhere else."""
    query = (
        db.query(models.Apartment.building_id, func.count(models.Apartment.id))
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .filter(
            models.Apartment.organization_id == current_user.organization_id,
            models.Apartment.is_display.is_(True),
        )
    )
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return []
        query = query.filter(models.Apartment.id.in_(ids))
    custom_picklists: dict[str, list[str]] = {}
    for entry in picklist or []:
        key, sep, value = entry.partition(":")
        if sep:
            custom_picklists.setdefault(key, []).append(value)
    query = _apply_apartment_filters(
        query,
        building_id=building_id,
        building_ids=building_ids,
        area_id=area_id,
        area_ids=area_ids,
        report_number_ids=report_number_ids,
        q=q,
        jewish_status=jewish_status,
        mezuzah_status=mezuzah_status,
        campaign_status=campaign_status,
        language=language,
        custom_picklists=custom_picklists,
    )
    return [
        BuildingAggregate(building_id=b_id, count=count)
        for b_id, count in query.group_by(models.Apartment.building_id).all()
    ]


def _bulk_versioned_update(
    db: Session,
    apartments: list[models.Apartment],
    changes: dict,
    editor: models.User,
) -> int:
    """Apply `changes` to a list of active apartments as fixes19 §3 versioned
    edits, in a single transaction: retire each current row and insert its
    successor carrying the change, re-pointing any mekurav link. `changes` here
    only ever carries real columns (report_number_id / apartment_notes) — the
    picklist-backed fields are copied forward untouched (fixes32). Returns the
    number of apartments updated."""
    for active in apartments:
        active.is_display = False
        active.last_edit = datetime.datetime.utcnow()
        active.editor_id = editor.id
        values = {col: getattr(active, col) for col in _VERSIONED_COLUMNS}
        values.update(changes)
        new = models.Apartment(
            **values,
            organization_id=active.organization_id,
            is_display=True,
            root_id=active.root_id or active.id,
            created_at=active.created_at,
        )
        db.add(new)
        db.flush()
        db.query(models.ContactMekurav).filter(
            models.ContactMekurav.apartment_id == active.id
        ).update(
            {models.ContactMekurav.apartment_id: new.id}, synchronize_session=False
        )
        picklist_utils.copy_links(db, "apartments", active.id, new.id)
    db.commit()
    return len(apartments)


@router.post("/bulk-update", response_model=ApartmentBulkUpdateResult)
def bulk_update_apartments(
    payload: ApartmentBulkUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes23 §3: apply a change (report number and/or notes) to every active
    apartment matching the page's current filters, as versioned edits. The filter
    block mirrors GET /api/apartments/list, so "all apartments currently matching
    the active filters" resolves to the exact same rows the user sees. Shliach
    users only touch apartments assigned to them."""
    org_id = current_user.organization_id
    changes: dict = {}
    if payload.set_report_number:
        _validate_report_number(
            {"report_number_id": payload.report_number_id}, org_id, db
        )
        changes["report_number_id"] = payload.report_number_id
    if payload.set_notes:
        changes["apartment_notes"] = payload.apartment_notes
    if not changes:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Select at least one field to update"
        )

    query = (
        db.query(models.Apartment)
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .filter(
            models.Apartment.organization_id == org_id,
            models.Apartment.is_display.is_(True),
        )
    )
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return ApartmentBulkUpdateResult(updated=0)
        query = query.filter(models.Apartment.id.in_(ids))
    query = _apply_apartment_filters(
        query,
        building_ids=payload.building_ids,
        area_ids=payload.area_ids,
        report_number_ids=payload.report_number_ids,
        q=payload.q,
        jewish_status=payload.jewish_status,
        mezuzah_status=payload.mezuzah_status,
    )
    apartments = query.all()
    updated = _bulk_versioned_update(db, apartments, changes, current_user)
    return ApartmentBulkUpdateResult(updated=updated)


# The real-column data copied from a retired version into its successor
# (fixes19). Picklist-backed fields (fixes32) aren't columns anymore — they're
# copied separately via picklist_utils.copy_links.
_VERSIONED_COLUMNS = (
    "building_id",
    "apartment_name",
    "apartment_notes",
    "floor",
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
    picklist_map = picklist_utils.get_values_bulk(
        db, admin.organization_id, "apartments", [v.id for v in versions]
    )
    out = []
    for v in versions:
        item = ApartmentVersionOut.model_validate(v)
        _apply_picklist_fields(item, picklist_map.get(v.id, {}))
        item.editor_name = v.editor.full_name if v.editor else None
        out.append(item)
    return out


# Fields an admin may roll back per-field (building_id is excluded — a restore
# should not silently move an apartment to a different building). Covers both
# the real versioned columns and the 4 fixed picklist fields (fixes32).
_RESTORABLE_FIELDS = tuple(
    c for c in _VERSIONED_COLUMNS if c != "building_id"
) + tuple(_APARTMENT_PICKLISTS.keys())


@router.post("/{apartment_id}/restore-field", response_model=ApartmentOut)
def restore_apartment_field(
    apartment_id: int,
    payload: ApartmentRestoreField,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes22 §2: roll one field of the active apartment back to the value it
    held in a previous version. Applied as a normal versioned edit — a new
    active version is created carrying the restored field, and the pre-restore
    state itself becomes a history entry. Admin only."""
    org_id = admin.organization_id
    active = _get_or_404(apartment_id, org_id, db)
    if not active.is_display:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    if payload.field not in _RESTORABLE_FIELDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"field '{payload.field}' cannot be restored"
        )
    # The source version must belong to this apartment's lineage.
    root_id = active.root_id or active.id
    version = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.id == payload.version_id,
            models.Apartment.organization_id == org_id,
            or_(
                models.Apartment.root_id == root_id,
                models.Apartment.id == root_id,
            ),
        )
        .first()
    )
    if not version:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "version not found in this apartment's history"
        )
    changes: dict = {}
    picklist_changes: dict[str, Optional[str]] = {}
    if payload.field in _APARTMENT_PICKLISTS:
        field_key = _APARTMENT_PICKLISTS[payload.field]
        picklist_changes[field_key] = picklist_utils.get_values(
            db, org_id, "apartments", version.id, [field_key]
        )[field_key]
    else:
        changes[payload.field] = getattr(version, payload.field)
    _validate_picklist_changes(picklist_changes, org_id, db)
    _validate_report_number(changes, org_id, db)
    return _apartment_out(db, _apply_versioned_update(db, active, changes, picklist_changes, admin))


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
    return _apartment_out(db, a)


def _apply_versioned_update(
    db: Session,
    active: models.Apartment,
    changes: dict,
    picklist_changes: dict[str, Optional[str]],
    editor: models.User,
    custom_field_changes: Optional[dict] = None,
) -> models.Apartment:
    """Core of the fixes19 §3 versioning: retire the active row (is_display=False
    + last_edit/editor_id stamp) and insert a new active row carrying `changes`
    (real columns), `picklist_changes` (field_key -> value, fixes32) and
    `custom_field_changes` (field_key -> value, fixes35, non-select only).
    Mekurav contact links follow the new row; every existing picklist link and
    custom field value is copied onto the new row first (so unrelated fields
    survive), then the changes are applied on top. Commits and returns the new
    row."""
    org_id = active.organization_id
    active.is_display = False
    active.last_edit = datetime.datetime.utcnow()
    active.editor_id = editor.id

    values = {col: getattr(active, col) for col in _VERSIONED_COLUMNS}
    values.update(changes)  # the original created_at is carried over below
    new = models.Apartment(
        **values,
        organization_id=org_id,
        is_display=True,
        root_id=active.root_id or active.id,
        created_at=active.created_at,
    )
    db.add(new)
    db.flush()
    db.query(models.ContactMekurav).filter(
        models.ContactMekurav.apartment_id == active.id
    ).update({models.ContactMekurav.apartment_id: new.id}, synchronize_session=False)
    picklist_utils.copy_links(db, "apartments", active.id, new.id)
    for field_key, value in picklist_changes.items():
        picklist_utils.set_value(db, org_id, "apartments", new.id, field_key, value)
    custom_field_utils.copy_values(db, "apartments", active.id, new.id)
    for field_key, value in (custom_field_changes or {}).items():
        custom_field_utils.set_value(db, org_id, "apartment", new.id, field_key, value)
    db.commit()
    db.refresh(new)
    return new


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
    follow the new row. fixes22 §2: a shliach may edit only apartments assigned
    to them (their edits version + stamp editor_id like anyone else's)."""
    org_id = current_user.organization_id
    a = _get_or_404(apartment_id, org_id, db)
    if not a.is_display:
        # Historical snapshots are immutable.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    if current_user.role == "shliach" and a.id not in _shliach_apartment_ids(
        db, current_user
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only edit apartments assigned to you"
        )
    data = payload.model_dump(exclude_unset=True)
    if "building_id" in data and data["building_id"] is not None:
        _validate_building(data["building_id"], org_id, db)
    picklist_changes = _split_picklist_changes(data)
    _validate_picklist_changes(picklist_changes, org_id, db)
    custom_field_changes = _split_custom_field_changes(data)
    _validate_report_number(data, org_id, db)
    return _apartment_out(
        db,
        _apply_versioned_update(
            db, a, data, picklist_changes, current_user, custom_field_changes
        ),
    )


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
    picklist_utils.delete_links_many(db, "apartments", [row.id for row in lineage])
    custom_field_utils.delete_values_many(db, "apartments", [row.id for row in lineage])
    for row in lineage:
        db.delete(row)
    db.commit()
