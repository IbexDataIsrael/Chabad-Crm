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
from sqlalchemy import func, nullslast, or_, select
from sqlalchemy.orm import Session

from app import custom_field_utils, models, picklist_utils
from app.core.campaigns import get_active_campaign_id
from app.core.natural_sort import natural_sort_keys
from app.core.shliach import resolve_shliach
from app.database import get_db
from app.deps import get_current_user, require_admin_or_campaign_manager
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
    ApartmentRouteItem,
    ApartmentUpdate,
    ApartmentVersionOut,
    BuildingAggregate,
    DoorOutcomeIn,
    DoorOutcomeOut,
    ReportNumberBuildingLink,
)

router = APIRouter(prefix="/api/apartments", tags=["apartments"])

# Apartment fields constrained by an org-managed picklist (fixes7 §4). Values
# live in PicklistLink (fixes32) — these keep dedicated API fields for
# backward compatibility; any other apartment.* picklist is dynamic (see
# ApartmentOut.picklist_values). `language` (fixes13) is handled separately
# below — fixes51 §2.2 made it multi-select, so it doesn't fit this
# one-scalar-field-per-key map any more.
_APARTMENT_PICKLISTS = {
    "jewish_status": "apartment.Jewish_status",
    "campaign_status": "apartment.campaign_status",
    "mezuzah_status": "apartment.mezuzah_status",
}
_APARTMENT_LANGUAGE_FIELD_KEY = "apartment.language"

# fixes71 §C.2: keeps the "to_knock" apartment custom field (backend/scripts/
# backfill_to_knock.py's one-time rule, now applied live) in sync with every
# Jewish-status write — true when affirmatively Jewish or unset, false for an
# explicit not_jewish/gentile/na. Matches _NO_KNOCK_VALUES in that script.
_TO_KNOCK_FIELD_KEY = "to_knock"
_NO_KNOCK_VALUES = {"not_jewish", "gentile", "na"}


def _sync_to_knock(
    db: Session, org_id: int, apartment_id: int, jewish_status_value: Optional[str]
) -> None:
    target = jewish_status_value is None or jewish_status_value not in _NO_KNOCK_VALUES
    definition = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.field_key == _TO_KNOCK_FIELD_KEY,
        )
        .first()
    )
    if definition is None:
        return  # a missing housekeeping field must never break a real apartment write
    custom_field_utils.set_value(db, org_id, "apartment", apartment_id, _TO_KNOCK_FIELD_KEY, target)


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


def _apply_picklist_fields(
    out, values: dict[str, Optional[str]], language_values: Optional[list[str]] = None
) -> None:
    """Populate an ApartmentOut's fixed fields + the dynamic picklist_values
    dict from a resolved {field_key: value} map, plus (fixes51 §2.2) the
    multi-select `language` list from its own separate lookup."""
    for field, field_key in _APARTMENT_PICKLISTS.items():
        setattr(out, field, values.get(field_key))
    out.language = language_values or []
    out.picklist_values = {
        k: v
        for k, v in values.items()
        if k not in _APARTMENT_PICKLISTS.values() and k != _APARTMENT_LANGUAGE_FIELD_KEY
    }


def _apartment_out(
    db: Session,
    a: models.Apartment,
    picklist_map: Optional[dict] = None,
    custom_field_map: Optional[dict] = None,
    language_values: Optional[list[str]] = None,
) -> ApartmentOut:
    values = (
        picklist_map
        if picklist_map is not None
        else picklist_utils.get_values(db, a.organization_id, "apartments", a.id)
    )
    if language_values is None:
        language_values = picklist_utils.get_multi_values(
            db, a.organization_id, "apartments", a.id, _APARTMENT_LANGUAGE_FIELD_KEY
        )
    out = ApartmentOut.model_validate(a)
    _apply_picklist_fields(out, values, language_values)
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
    is linked to an ACTIVE Task under an active Campaign for them (fixes58 —
    replaces the old direct `ReportNumberContactShliach` assignment), plus
    apartments of buildings inside their covered areas (fixes19).

    fixes58: `Task.volunteer_user_id` is a direct `users.id` FK (plan decision
    #2, `docs/plan58-plan.md`), not routed through `resolve_shliach()` — a
    volunteer with no linked/resolvable shliach contact still sees their
    Task-driven apartments. The area branch is unaffected by fixes58 and
    still needs a resolvable shliach; fixes21 §1: resolved by the user_id
    link *or* by matching email, so an unlinked (e.g. imported) shliach still
    sees their area coverage."""
    ids: set[int] = set()

    report_number_ids = [
        row.report_number_id
        for row in db.query(models.TaskReportNumber.report_number_id)
        .join(models.Task, models.Task.id == models.TaskReportNumber.task_id)
        .join(models.Campaign, models.Campaign.id == models.Task.campaign_id)
        .filter(
            models.Task.volunteer_user_id == user.id,
            models.Task.status == "ACTIVE",
            models.Campaign.is_active.is_(True),
            models.Campaign.deleted_at.is_(None),
        )
        .all()
    ]
    if report_number_ids:
        ids.update(
            row.id
            for row in db.query(models.Apartment.id)
            .filter(models.Apartment.report_number_id.in_(report_number_ids))
            .all()
        )

    shliach = resolve_shliach(db, user)
    if shliach:
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
    language_values: Optional[list[str]] = None,
) -> ApartmentListOut:
    building = a.building
    area = building.area if building else None
    mekurav = a.mekuravim[0] if a.mekuravim else None
    contact = mekurav.contact if mekurav else None
    contact_name = None
    if contact:
        contact_name = f"{contact.name} {contact.last_name or ''}".strip()
    out = ApartmentListOut.model_validate(a)
    _apply_picklist_fields(out, picklist_map, language_values)
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
        models.Apartment.status == "active",  # Instinct drafts stay out of pickers
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
    language_map = picklist_utils.get_multi_values_bulk(
        db, current_user.organization_id, "apartments", [r.id for r in rows],
        _APARTMENT_LANGUAGE_FIELD_KEY,
    )
    custom_field_map = custom_field_utils.get_values_bulk(
        db, current_user.organization_id, "apartment", [r.id for r in rows]
    )
    return [
        _apartment_out(
            db, a, picklist_map.get(a.id, {}), custom_field_map.get(a.id, {}),
            language_map.get(a.id, []),
        )
        for a in rows
    ]


def _latest_door_outcomes(
    db: Session, org_id: int, apartment_ids: list[int]
) -> dict[int, tuple[str, datetime.datetime]]:
    """fixes68 §B1: the most recent visit.door_outcome per apartment (newest
    visit first, first one carrying an outcome link wins). `apartment_ids` is
    always a small (activist-scoped) route set, so one ordered fetch + one
    bulk picklist lookup is cheap — no need for a per-apartment query."""
    if not apartment_ids:
        return {}
    visits = (
        db.query(models.VisitHistory)
        .filter(
            models.VisitHistory.organization_id == org_id,
            models.VisitHistory.apartment_id.in_(apartment_ids),
        )
        .order_by(models.VisitHistory.visit_date.desc())
        .all()
    )
    picklist_map = picklist_utils.get_values_bulk(
        db, org_id, "visit_history", [v.id for v in visits]
    )
    result: dict[int, tuple[str, datetime.datetime]] = {}
    for v in visits:
        if v.apartment_id in result:
            continue
        outcome = picklist_map.get(v.id, {}).get("visit.door_outcome")
        if outcome:
            result[v.apartment_id] = (outcome, v.visit_date)
    return result


@router.get("/my-route", response_model=list[ApartmentRouteItem])
def my_route(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes68 §1/§B1: one pre-sorted payload for the activist's door-to-door
    route (Feature 1) — assigned apartments only, but every field, built via
    the same `_enrich()` the admin apartments grid uses (fixed columns,
    dynamic picklist_values, custom_field_values, linked contact) so the
    activist sees the same full picture an admin does, not a trimmed
    subset. Still nowhere near the plain GET /api/apartments dump's size
    (unpaginated, org-wide, ~25k rows / 9.7MB — see the spec's SPEED PROBLEM
    note): this is the activist's own set, tens to low hundreds of rows, and
    every field on that set is still a small payload. Must stay registered
    before GET "/{apartment_id}" below — that route has no `:int` path
    converter, so "my-route" would otherwise match it first and 422 on the
    int conversion.

    Order is the same mandatory hierarchy sort as `sort=hierarchy` on /list
    (report number -> building -> floor -> label) — the frontend never
    re-sorts, "next door" is just index+1."""
    org_id = current_user.organization_id
    query = (
        db.query(models.Apartment)
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .outerjoin(
            models.ReportNumber,
            models.ReportNumber.id == models.Apartment.report_number_id,
        )
        .filter(
            models.Apartment.organization_id == org_id,
            models.Apartment.is_display.is_(True),
            models.Apartment.status == "active",
        )
    )
    if current_user.role == "shliach":
        ids = _shliach_apartment_ids(db, current_user)
        if not ids:
            return []
        query = query.filter(models.Apartment.id.in_(ids))
    rows = query.order_by(*_sort_keys("hierarchy", db)).all()
    row_ids = [r.id for r in rows]
    picklist_map = picklist_utils.get_values_bulk(db, org_id, "apartments", row_ids)
    language_map = picklist_utils.get_multi_values_bulk(
        db, org_id, "apartments", row_ids, _APARTMENT_LANGUAGE_FIELD_KEY
    )
    custom_field_map = custom_field_utils.get_values_bulk(db, org_id, "apartment", row_ids)
    outcomes = _latest_door_outcomes(db, org_id, row_ids)
    items = []
    for a in rows:
        enriched = _enrich(
            a,
            picklist_map.get(a.id, {}),
            custom_field_map.get(a.id, {}),
            language_map.get(a.id, []),
        )
        last_outcome, last_outcome_at = outcomes.get(a.id, (None, None))
        items.append(
            ApartmentRouteItem(
                **enriched.model_dump(),
                last_outcome=last_outcome,
                last_outcome_at=last_outcome_at,
            )
        )
    return items


def _natural(col, db: Session):
    """fixes52 §6: moved to app.core.natural_sort so areas/report_numbers/
    contacts can share it too — kept as a thin local alias since every call
    site in this module already says `_natural(...)`."""
    return natural_sort_keys(col, db)


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
    # fixes54 §1.1: header-click sorting for the plain/single-join grid
    # columns — the caller joins Area/ReportNumber in for these two.
    if sort == "area":
        return [models.Area.area_name]
    if sort == "report_number":
        return [models.ReportNumber.name]
    if sort == "notes":
        return [models.Apartment.apartment_notes]
    if sort == "phone":
        return [models.Apartment.phone]
    if sort == "email":
        return [models.Apartment.email]
    if sort == "hierarchy":
        # fixes53 §2: the mandatory canonical order — Report Number, then
        # Building, then Floor. Always ascending regardless of `dir` (the
        # caller forces `dir="asc"` for this option); "L" already sorts
        # ahead of every numbered floor via Floor.sort_order (fixes52 §3),
        # reused as-is through _floor_rank().
        return [
            *_natural(models.ReportNumber.name, db),
            models.Building.building_address,
            _floor_rank(),
            *_natural(models.Apartment.floor, db),
        ]
    # Default "floor": canonical floor order, then the free-text floor name for
    # floors that no longer exist in the floors table.
    return [_floor_rank(), *_natural(models.Apartment.floor, db)]


def _picklist_filter(query, field_key: str, values: list[str]):
    """Restrict to apartments whose stored value for `field_key` (fixes32:
    PicklistLink, not a real column) is one of `values`. fixes57 §2: `values`
    may include EMPTY_FIELD_SENTINEL, meaning "also match apartments with no
    value at all for this field" — ORed alongside any real values requested."""
    real_values = [v for v in values if v != EMPTY_FIELD_SENTINEL]
    conditions = []
    if real_values:
        conditions.append(
            models.Apartment.id.in_(
                picklist_utils.matching_entity_ids("apartments", field_key, real_values)
            )
        )
    if len(real_values) != len(values):  # sentinel was present
        conditions.append(
            models.Apartment.id.notin_(
                picklist_utils.unassigned_entity_ids("apartments", field_key)
            )
        )
    if not conditions:
        return query
    return query.filter(or_(*conditions))


# fixes53 §2: sent as the `custom_field_filter` query value in place of real
# search text to mean "this field is blank" (Excel-style blank selection) —
# a value no real search text can collide with.
EMPTY_FIELD_SENTINEL = "\x00__empty__\x00"


def _custom_field_text_filter(query, db: Session, org_id: int, field_key: str, text: str):
    """fixes52 §2.2 / fixes53 §2: restrict to apartments whose non-select
    custom-field value for `field_key` matches `text` — a boolean field
    matches "true"/"false" against `checked`; text/number/date match an
    ILIKE contains against the stored string, or (EMPTY_FIELD_SENTINEL) match
    apartments with no meaningful value at all. An unknown field_key is a
    silent no-op (same "don't error mid filter-chain on a stale key" stance
    the picklist filters already take)."""
    definition = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.field_key == field_key,
        )
        .first()
    )
    if definition is None:
        return query
    if text == EMPTY_FIELD_SENTINEL and definition.field_type != "boolean":
        # No row at all, or a row whose value was cleared to "" rather than
        # deleted (set_value only deletes on None — see custom_field_utils).
        has_value = select(models.CustomFieldValue.entity_id).where(
            models.CustomFieldValue.entity_table == "apartments",
            models.CustomFieldValue.definition_id == definition.id,
            models.CustomFieldValue.value.isnot(None),
            models.CustomFieldValue.value != "",
        )
        return query.filter(models.Apartment.id.notin_(has_value))
    sub = select(models.CustomFieldValue.entity_id).where(
        models.CustomFieldValue.entity_table == "apartments",
        models.CustomFieldValue.definition_id == definition.id,
    )
    if definition.field_type == "boolean":
        sub = sub.where(models.CustomFieldValue.checked.is_(text.strip().lower() == "true"))
    else:
        sub = sub.where(models.CustomFieldValue.value.ilike(f"%{text.strip()}%"))
    return query.filter(models.Apartment.id.in_(sub))


def _id_or_null_filter(query, column, ids: list[int]):
    """fixes57 §2: an id-list filter where 0 is a reserved sentinel meaning
    "no value assigned" (real ids are always >= 1, Postgres serial columns
    start at 1) — ORed alongside any real ids requested."""
    real_ids = [i for i in ids if i != 0]
    conditions = []
    if real_ids:
        conditions.append(column.in_(real_ids))
    if len(real_ids) != len(ids):  # sentinel 0 was present
        conditions.append(column.is_(None))
    if not conditions:
        return query
    return query.filter(or_(*conditions))


def _apply_apartment_filters(
    query,
    db: Session,
    org_id: int,
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
    custom_field_filters: Optional[dict[str, str]] = None,
    record_status: Optional[str] = "active",
):
    """Apply the shared apartment-list filters (fixes8/15/18/20/23). The caller's
    query must already be joined to `models.Building` (area/street filters need
    it). Used by both the paged list and the bulk-update endpoint so they always
    resolve to the same set of rows. Instinct phase 2: `record_status` keeps
    API-created drafts out of every list/aggregate/bulk set by default, the
    same way contacts do (None = no status filter)."""
    if record_status is not None:
        query = query.filter(models.Apartment.status == record_status)
    if building_id is not None:
        query = query.filter(models.Apartment.building_id == building_id)
    # fixes23 §2: multi-select building filter (repeated ?building_ids=… params).
    if building_ids:
        query = query.filter(models.Apartment.building_id.in_(building_ids))
    if area_id is not None:
        query = query.filter(models.Building.area_id == area_id)
    # fixes15 §7.1: multi-select area filter (repeated ?area_ids=… params).
    # fixes57 §2: 0 is the "-" (no area assigned) sentinel.
    if area_ids:
        query = _id_or_null_filter(query, models.Building.area_id, area_ids)
    if apartment_id is not None:
        query = query.filter(models.Apartment.id == apartment_id)
    # fixes30 §3: explicit apartment selection (repeated ?apartment_ids=…) —
    # the report page fetches exactly the chosen apartments.
    if apartment_ids:
        query = query.filter(models.Apartment.id.in_(apartment_ids))
    # fixes20 §3: searchable report-number filter (multi-select).
    # fixes57 §2: 0 is the "-" (no report number assigned) sentinel.
    if report_number_ids:
        query = _id_or_null_filter(
            query, models.Apartment.report_number_id, report_number_ids
        )
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
    # fixes52 §2.2: dynamic custom (non-select) apartment field filters.
    for field_key, text in (custom_field_filters or {}).items():
        if text and text.strip():
            query = _custom_field_text_filter(query, db, org_id, field_key, text)
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
    # fixes52 §2.2: dynamic filter for any custom (non-select) apartment
    # field, sent the same "field_key:query" way.
    custom_field_filter: Optional[list[str]] = Query(None),
    sort: Literal[
        "floor", "label", "resident", "building", "created", "hierarchy",
        # fixes54 §1.1: header-click sorting on the remaining plain/
        # single-join grid columns.
        "area", "report_number", "notes", "phone", "email",
    ] = "floor",
    dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    # Instinct phase 2 (mirrors contacts' list): drafts only on request.
    # `status` itself would shadow fastapi.status inside this function.
    record_status: Literal["active", "draft"] = Query("active", alias="status"),
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
    custom_field_filters: dict[str, str] = {}
    for entry in custom_field_filter or []:
        key, sep, value = entry.partition(":")
        if sep:
            custom_field_filters[key] = value
    query = _apply_apartment_filters(
        query,
        db,
        current_user.organization_id,
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
        custom_field_filters=custom_field_filters,
        # A single-apartment lookup (the detail page) resolves drafts too.
        record_status=record_status if apartment_id is None else None,
    )
    if sort in ("hierarchy", "report_number"):
        # fixes53 §2 / fixes54 §1.1: the Report Number tier/column needs the
        # table joined in — an outer join since report_number_id is nullable.
        query = query.outerjoin(
            models.ReportNumber,
            models.ReportNumber.id == models.Apartment.report_number_id,
        )
    if sort == "area":
        # fixes54 §1.1: outer join since Building.area_id is nullable.
        query = query.outerjoin(models.Area, models.Area.id == models.Building.area_id)

    total = query.count()

    # fixes53 §2: the hierarchy is a fixed, mandatory order — always
    # ascending across all three tiers, regardless of what `dir` a caller
    # sends (the UI disables the direction toggle while it's selected).
    effective_dir = "asc" if sort == "hierarchy" else dir
    primary = [
        k.desc() if effective_dir == "desc" else k.asc() for k in _sort_keys(sort, db)
    ]
    # Secondary keys always ascend: within a floor, apartments sort by number.
    secondary = (
        [] if sort == "label" else _natural(models.Apartment.apartment_name, db)
    )
    order = [nullslast(k) for k in (*primary, *secondary)]

    total_buildings = None
    if sort == "building":
        # fixes53 §2: the group-by-building view paginates by building, not
        # by apartment row — a building's apartments must never be split
        # across pages, or its header count (rendered rows) can't ever match
        # the number the header prints. `page`/`page_size` here address
        # buildings; the raw (direction-free) sort column must be in the
        # SELECT list alongside `distinct()` (Postgres requires ORDER BY
        # columns to appear there) — direction is applied only in order_by.
        building_col = _sort_keys("building", db)[0]
        building_key = building_col.desc() if dir == "desc" else building_col.asc()
        building_rows = (
            query.with_entities(models.Apartment.building_id, building_col)
            .distinct()
            .order_by(nullslast(building_key))
        )
        total_buildings = building_rows.count()
        page_building_ids = [
            row[0]
            for row in building_rows.offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        ]
        rows = (
            query.filter(models.Apartment.building_id.in_(page_building_ids))
            .order_by(*order, models.Apartment.id)
            .all()
            if page_building_ids
            else []
        )
    else:
        rows = (
            query.order_by(*order, models.Apartment.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    picklist_map = picklist_utils.get_values_bulk(
        db, current_user.organization_id, "apartments", [r.id for r in rows]
    )
    language_map = picklist_utils.get_multi_values_bulk(
        db, current_user.organization_id, "apartments", [r.id for r in rows],
        _APARTMENT_LANGUAGE_FIELD_KEY,
    )
    custom_field_map = custom_field_utils.get_values_bulk(
        db, current_user.organization_id, "apartment", [r.id for r in rows]
    )
    return ApartmentPageOut(
        items=[
            _enrich(
                a, picklist_map.get(a.id, {}), custom_field_map.get(a.id, {}),
                language_map.get(a.id, []),
            )
            for a in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_buildings=total_buildings,
    )


@router.post("", response_model=ApartmentOut, status_code=status.HTTP_201_CREATED)
def create_apartment(
    payload: ApartmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    building = _validate_building(payload.building_id, org_id, db)
    if building.building_type_id == "town_house":
        # fixes63: a second unit means the town house has been split — the
        # single-"-th"-apartment convention is gone, so this is now the only
        # signal that distinguishes an undivided town house from one that
        # isn't.
        building.building_type_id = "divided_town_house"
    data = payload.model_dump()
    contact_id = data.pop("contact_id", None)
    # fixes51 §2.2: language is multi-select, handled separately from the
    # scalar picklist fields below.
    language_values = data.pop("language", None) or []
    for value in language_values:
        validate_picklist_value(db, org_id, _APARTMENT_LANGUAGE_FIELD_KEY, value)
    picklist_changes = _split_picklist_changes(data)
    _validate_picklist_changes(picklist_changes, org_id, db)
    custom_field_changes = _split_custom_field_changes(data)
    _validate_report_number(data, org_id, db)
    a = models.Apartment(
        **data, organization_id=org_id, campaign_id=get_active_campaign_id(db, org_id)
    )
    db.add(a)
    db.flush()
    for field_key, value in picklist_changes.items():
        if value is not None:
            picklist_utils.set_value(db, org_id, "apartments", a.id, field_key, value)
    if language_values:
        picklist_utils.set_multi_values(
            db, org_id, "apartments", a.id, _APARTMENT_LANGUAGE_FIELD_KEY, language_values
        )
    for field_key, value in custom_field_changes.items():
        if value is not None:
            custom_field_utils.set_value(db, org_id, "apartment", a.id, field_key, value)
    # fixes71 §C.2: "new apartments get the same [to_knock] default when
    # their status is set" — a brand-new apartment has no prior to_knock to
    # protect, so this always runs, including when no status was given at all.
    _sync_to_knock(db, org_id, a.id, picklist_changes.get(_APARTMENT_PICKLISTS["jewish_status"]))

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
    new_apartments: list[models.Apartment] = []
    active_campaign_id = get_active_campaign_id(db, org_id)
    for floor in floors:
        for label in labels:
            if (floor.name, label) in existing:
                skipped += 1
                continue
            apt = models.Apartment(
                organization_id=org_id,
                building_id=building.id,
                apartment_name=label,
                floor=floor.name,
                campaign_id=active_campaign_id,
            )
            db.add(apt)
            new_apartments.append(apt)
            created += 1
    # fixes71 §C.2: every apartment created here has no jewish_status at all,
    # so to_knock is always true — bulk-insert the CustomFieldValue rows
    # directly (one definition lookup total) rather than N _sync_to_knock
    # calls, since this matrix can create many rows in one request.
    if new_apartments:
        db.flush()  # assign ids
        definition = (
            db.query(models.CustomFieldDefinition)
            .filter(
                models.CustomFieldDefinition.organization_id == org_id,
                models.CustomFieldDefinition.entity_type == "apartment",
                models.CustomFieldDefinition.field_key == _TO_KNOCK_FIELD_KEY,
            )
            .first()
        )
        if definition is not None:
            for apt in new_apartments:
                db.add(
                    models.CustomFieldValue(
                        organization_id=org_id,
                        entity_table="apartments",
                        entity_id=apt.id,
                        definition_id=definition.id,
                        checked=True,
                        value=None,
                    )
                )
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
    custom_field_filter: Optional[list[str]] = Query(None),
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
    custom_field_filters: dict[str, str] = {}
    for entry in custom_field_filter or []:
        key, sep, value = entry.partition(":")
        if sep:
            custom_field_filters[key] = value
    query = _apply_apartment_filters(
        query,
        db,
        current_user.organization_id,
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
        custom_field_filters=custom_field_filters,
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
    picklist_changes: dict,
    custom_field_changes: dict,
    language_values: Optional[list[str]],
) -> int:
    """Apply `changes`/`picklist_changes`/`custom_field_changes`/
    `language_values` to a list of active apartments as fixes19 §3 versioned
    edits, in a single transaction: retire each current row and insert its
    successor carrying the change, re-pointing any mekurav link. fixes52
    §2.3: mirrors `_apply_versioned_update`'s per-row body (picklist/custom-
    field/language handling included, not just real columns) — kept as its
    own function rather than merged with the single-row version since one
    commits per row in a loop and the other doesn't; that's a control-flow
    difference, not duplicated logic. Returns the number of apartments
    updated."""
    # fixes71 §C.2: `picklist_changes` is the same dict applied to every row
    # in this batch, so the membership check only needs evaluating once.
    jewish_status_touched = _APARTMENT_PICKLISTS["jewish_status"] in picklist_changes
    # fixes72 §B: likewise, every row in this batch shares the same
    # "currently active campaign" — resolve it once, not per row.
    active_campaign_id = (
        get_active_campaign_id(db, apartments[0].organization_id) if apartments else None
    )
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
            campaign_id=active_campaign_id,
        )
        db.add(new)
        db.flush()
        db.query(models.ContactMekurav).filter(
            models.ContactMekurav.apartment_id == active.id
        ).update(
            {models.ContactMekurav.apartment_id: new.id}, synchronize_session=False
        )
        db.query(models.VisitHistory).filter(
            models.VisitHistory.apartment_id == active.id
        ).update(
            {models.VisitHistory.apartment_id: new.id}, synchronize_session=False
        )
        picklist_utils.copy_links(db, "apartments", active.id, new.id)
        for field_key, value in picklist_changes.items():
            picklist_utils.set_value(
                db, active.organization_id, "apartments", new.id, field_key, value
            )
        if language_values is not None:
            picklist_utils.set_multi_values(
                db, active.organization_id, "apartments", new.id,
                _APARTMENT_LANGUAGE_FIELD_KEY, language_values,
            )
        custom_field_utils.copy_values(db, "apartments", active.id, new.id)
        for field_key, value in custom_field_changes.items():
            custom_field_utils.set_value(
                db, active.organization_id, "apartment", new.id, field_key, value
            )
        # fixes71 §C.2/§C.3: only recompute to_knock when the status itself
        # changed — copy_values above already carried the prior value
        # forward for edits that don't touch it (protects a manual override).
        if jewish_status_touched:
            _sync_to_knock(
                db,
                active.organization_id,
                new.id,
                picklist_changes[_APARTMENT_PICKLISTS["jewish_status"]],
            )
    db.commit()
    return len(apartments)


@router.post("/bulk-update", response_model=ApartmentBulkUpdateResult)
def bulk_update_apartments(
    payload: ApartmentBulkUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes23 §3, expanded fixes52 §2.3: apply a change to every active
    apartment matching the page's current filters, as versioned edits. The
    filter block mirrors GET /api/apartments/list, so "all apartments
    currently matching the active filters" resolves to the exact same rows
    the user sees. Shliach users only touch apartments assigned to them.
    `apartment_name`/`building_id` are never bulk-editable — they simply
    aren't fields on `ApartmentBulkChanges`."""
    org_id = current_user.organization_id
    data = payload.changes.model_dump(exclude_unset=True)
    language_values = data.pop("language", None)
    if language_values is not None:
        for value in language_values:
            validate_picklist_value(db, org_id, _APARTMENT_LANGUAGE_FIELD_KEY, value)
    picklist_changes = _split_picklist_changes(data)
    _validate_picklist_changes(picklist_changes, org_id, db)
    custom_field_changes = _split_custom_field_changes(data)
    _validate_report_number(data, org_id, db)
    if not data and not picklist_changes and not custom_field_changes and language_values is None:
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
    custom_picklists: dict[str, list[str]] = {}
    for entry in payload.picklist or []:
        key, sep, value = entry.partition(":")
        if sep:
            custom_picklists.setdefault(key, []).append(value)
    custom_field_filters: dict[str, str] = {}
    for entry in payload.custom_field_filter or []:
        key, sep, value = entry.partition(":")
        if sep:
            custom_field_filters[key] = value
    query = _apply_apartment_filters(
        query,
        db,
        org_id,
        building_ids=payload.building_ids,
        area_ids=payload.area_ids,
        report_number_ids=payload.report_number_ids,
        q=payload.q,
        jewish_status=payload.jewish_status,
        mezuzah_status=payload.mezuzah_status,
        campaign_status=payload.campaign_status,
        language=payload.language,
        custom_picklists=custom_picklists,
        custom_field_filters=custom_field_filters,
    )
    apartments = query.all()
    updated = _bulk_versioned_update(
        db, apartments, data, current_user,
        picklist_changes, custom_field_changes, language_values,
    )
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
    # Instinct phase 2: a draft stays a draft (and keeps its origin) across
    # an edit — only an explicit status change approves it.
    "source",
    "status",
)


@router.get("/{apartment_id}/history", response_model=list[ApartmentVersionOut])
def apartment_history(
    apartment_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin_or_campaign_manager),
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
# should not silently move an apartment to a different building). Covers the
# real versioned columns, the fixed scalar picklist fields (fixes32), and
# (fixes51 §2.2) the multi-select language field.
_RESTORABLE_FIELDS = (
    tuple(c for c in _VERSIONED_COLUMNS if c != "building_id")
    + tuple(_APARTMENT_PICKLISTS.keys())
    + ("language",)
)


@router.post("/{apartment_id}/restore-field", response_model=ApartmentOut)
def restore_apartment_field(
    apartment_id: int,
    payload: ApartmentRestoreField,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin_or_campaign_manager),
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
    language_values: Optional[list[str]] = None
    if payload.field == "language":
        language_values = picklist_utils.get_multi_values(
            db, org_id, "apartments", version.id, _APARTMENT_LANGUAGE_FIELD_KEY
        )
    elif payload.field in _APARTMENT_PICKLISTS:
        field_key = _APARTMENT_PICKLISTS[payload.field]
        picklist_changes[field_key] = picklist_utils.get_values(
            db, org_id, "apartments", version.id, [field_key]
        )[field_key]
    else:
        changes[payload.field] = getattr(version, payload.field)
    _validate_picklist_changes(picklist_changes, org_id, db)
    _validate_report_number(changes, org_id, db)
    return _apartment_out(
        db,
        _apply_versioned_update(
            db, active, changes, picklist_changes, admin, language_values=language_values
        ),
    )


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
    language_values: Optional[list[str]] = None,
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
        # fixes72 §B: stamped fresh (not carried forward) — whichever
        # campaign is active NOW, at the moment of this specific edit.
        campaign_id=get_active_campaign_id(db, org_id),
    )
    db.add(new)
    db.flush()
    db.query(models.ContactMekurav).filter(
        models.ContactMekurav.apartment_id == active.id
    ).update({models.ContactMekurav.apartment_id: new.id}, synchronize_session=False)
    db.query(models.VisitHistory).filter(
        models.VisitHistory.apartment_id == active.id
    ).update({models.VisitHistory.apartment_id: new.id}, synchronize_session=False)
    picklist_utils.copy_links(db, "apartments", active.id, new.id)
    for field_key, value in picklist_changes.items():
        picklist_utils.set_value(db, org_id, "apartments", new.id, field_key, value)
    # fixes51 §2.2: None = no change requested — the languages `copy_links`
    # just carried forward stand as-is; anything else (including []) replaces
    # them outright.
    if language_values is not None:
        picklist_utils.set_multi_values(
            db, org_id, "apartments", new.id, _APARTMENT_LANGUAGE_FIELD_KEY, language_values
        )
    custom_field_utils.copy_values(db, "apartments", active.id, new.id)
    for field_key, value in (custom_field_changes or {}).items():
        custom_field_utils.set_value(db, org_id, "apartment", new.id, field_key, value)
    # fixes71 §C.2/§C.3: only recompute to_knock when the status itself
    # changed — copy_values above already carried the prior value forward
    # for edits that don't touch it (protects a manual override). Covers both
    # update_apartment's PUT and record_door_outcome, which both call this.
    jewish_status_key = _APARTMENT_PICKLISTS["jewish_status"]
    if jewish_status_key in picklist_changes:
        _sync_to_knock(db, org_id, new.id, picklist_changes[jewish_status_key])
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
    # fixes51 §2.1: apartment_name (מספר דירה) is never shliach-editable, even
    # on an apartment assigned to them.
    if (
        current_user.role == "shliach"
        and "apartment_name" in data
        and data["apartment_name"] != a.apartment_name
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Shliach users cannot edit the apartment number"
        )
    if "building_id" in data and data["building_id"] is not None:
        _validate_building(data["building_id"], org_id, db)
    # fixes51 §2.2: pop language out before `data` becomes the real-column
    # `changes` dict below — it isn't a column any more (PicklistLink), and
    # it's multi-select so it doesn't fit `_split_picklist_changes`'s scalar
    # map either. Absent from `data` (exclude_unset) => no change requested.
    language_values = data.pop("language", None)
    if language_values is not None:
        for value in language_values:
            validate_picklist_value(db, org_id, _APARTMENT_LANGUAGE_FIELD_KEY, value)
    picklist_changes = _split_picklist_changes(data)
    _validate_picklist_changes(picklist_changes, org_id, db)
    custom_field_changes = _split_custom_field_changes(data)
    _validate_report_number(data, org_id, db)
    return _apartment_out(
        db,
        _apply_versioned_update(
            db, a, data, picklist_changes, current_user, custom_field_changes,
            language_values=language_values,
        ),
    )


# fixes68 §3/§B2: "jewish"/"not_jewish" are recorded as door_outcome
# "answered" (the door WAS answered) plus a Jewish-status change.
_DOOR_OUTCOME_TO_JEWISH_STATUS = {"jewish": "jewish", "not_jewish": "not_jewish"}


@router.post("/{apartment_id}/door-outcome", response_model=DoorOutcomeOut)
def record_door_outcome(
    apartment_id: int,
    payload: DoorOutcomeIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes68 §3/§8/§B2: one tap from the activist route — logs a door visit
    and, for jewish/not_jewish, updates the apartment's Jewish status too.

    Idempotent on client_uuid (fixes68 §8's offline outbox retries a POST
    whose response was lost, e.g. a stairwell dropping mid-flush): a repeat
    is matched and returned as-is rather than logged twice.

    A jewish/not_jewish mark goes through the normal versioned apartment
    update (`_apply_versioned_update`), not a bare in-place picklist write —
    apartments are versioned (fixes19 §3) and the admin dashboard's "recent
    Jewish-status changes" panel (routers/dashboard.py::_jewish_status_changes)
    detects a change by diffing a retired row against its successor. A
    direct write would update the value correctly but leave it invisible to
    that panel and with no editor_id/last_edit audit stamp — the spec's own
    wording ("via the existing _apply_picklist_fields path") undersells this;
    that helper is read-only serialization, not a write path.

    The route's cached `apartment_id` can go stale mid-session: a jewish/
    not_jewish mark retires the row and hands the client a new one (see
    lib/activistRoute.ts's `applyLocalOutcome` — it patches the cached
    item's outcome fields in place, it never rewrites `id`), and a second
    mark on the same door before the next full route refresh — e.g. the
    activist correcting a jewish/not_jewish tap, or reopening at the door
    they left via "back" — would otherwise resubmit the retired id. Resolve
    forward to the lineage's current active row first (same lineage lookup
    `delete_apartment` uses), the same way the system already forwards
    VisitHistory/ContactMekurav references on every versioned update —
    never operate on a retired snapshot, which would silently mint a second
    is_display=True row for the lineage instead of updating the real one."""
    org_id = current_user.organization_id
    a = _get_or_404(apartment_id, org_id, db)
    if not a.is_display:
        root_id = a.root_id or a.id
        a = (
            db.query(models.Apartment)
            .filter(
                models.Apartment.organization_id == org_id,
                models.Apartment.is_display.is_(True),
                or_(models.Apartment.root_id == root_id, models.Apartment.id == root_id),
            )
            .first()
        ) or a
    if current_user.role == "shliach" and a.id not in _shliach_apartment_ids(
        db, current_user
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your apartment")

    existing = (
        db.query(models.VisitHistory)
        .filter(
            models.VisitHistory.organization_id == org_id,
            models.VisitHistory.client_uuid == payload.client_uuid,
        )
        .first()
    )
    if existing is not None:
        values = picklist_utils.get_values(db, org_id, "visit_history", existing.id)
        return DoorOutcomeOut(
            id=existing.id,
            apartment_id=existing.apartment_id or a.id,
            client_uuid=existing.client_uuid,
            outcome=values.get("visit.door_outcome") or payload.outcome,
            visit_date=existing.visit_date,
        )

    door_outcome = "answered" if payload.outcome in _DOOR_OUTCOME_TO_JEWISH_STATUS else payload.outcome
    validate_picklist_value(db, org_id, "visit.door_outcome", door_outcome)
    jewish_status = _DOOR_OUTCOME_TO_JEWISH_STATUS.get(payload.outcome)
    target = a
    if jewish_status:
        validate_picklist_value(db, org_id, "apartment.Jewish_status", jewish_status)
        target = _apply_versioned_update(
            db, a, {}, {"apartment.Jewish_status": jewish_status}, current_user
        )

    mekurav = target.mekuravim[0] if target.mekuravim else None
    v = models.VisitHistory(
        organization_id=org_id,
        apartment_id=target.id,
        contact_id=mekurav.contact_id if mekurav else None,
        visit_date=datetime.datetime.utcnow(),
        notes=payload.notes,
        client_uuid=payload.client_uuid,
    )
    db.add(v)
    db.flush()
    picklist_utils.set_value(db, org_id, "visit_history", v.id, "visit.type", "home")
    picklist_utils.set_value(
        db, org_id, "visit_history", v.id, "visit.door_outcome", door_outcome
    )
    db.commit()
    db.refresh(v)
    return DoorOutcomeOut(
        id=v.id,
        apartment_id=target.id,
        client_uuid=v.client_uuid,
        outcome=door_outcome,
        visit_date=v.visit_date,
    )


@router.delete("/{apartment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_apartment(
    apartment_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin_or_campaign_manager),
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
