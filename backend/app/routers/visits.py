"""Visit history (היסטורית ביקורים).

Two routers over the same `VisitHistory` entity:
- `router`      — per-contact sub-resource (/api/contacts/{id}/visits), open to any
                  authenticated org member; powers the contact page's visit section.
- `all_router`  — top-level (/api/visits): CRUD is **admin-only** (the org-wide
                  visits page); the custom-fields sub-resource is open to any org
                  member (it backs the contact-page visit editor too).

fixes25: a visit carries the engagement data that used to live on the contact —
an `interactions` JSON log (picklist `interaction.category`) and
`torah_thought` (picklist `checklist.torah_thought`). fixes39: the Mivtzoim
boolean flags and `connection_to_rebbe` moved from dedicated columns onto
custom-field values attached to the visit
(`/api/visits/{id}/custom-fields` for the booleans; `custom_field_values` on
the visit payload for `connection_to_rebbe`, now a text-type field).
"""
import datetime

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import custom_field_utils, models, picklist_utils
from app.database import get_db
from app.deps import forbid_campaign_manager, get_current_user, require_admin
from app.picklist_utils import validate_picklist_value
from app.schemas import (
    ContactCustomFieldOut,
    CustomFieldValueIn,
    VisitCreate,
    VisitOut,
    VisitSummaryCategory,
    VisitSummaryItem,
    VisitSummaryOut,
    VisitUpdate,
)

router = APIRouter(prefix="/api/contacts", tags=["visits"])
all_router = APIRouter(prefix="/api/visits", tags=["visits"])

# The 2 picklist-backed visit fields (fixes32 — no longer real columns).
_VISIT_PICKLIST_FIELD_KEYS = ["visit.type", "checklist.torah_thought"]


def _out(
    v: models.VisitHistory,
    picklist_map: dict[str, Optional[str]],
    custom_field_map: Optional[dict] = None,
) -> VisitOut:
    contact = v.contact
    name = f"{contact.name} {contact.last_name or ''}".strip() if contact else None
    return VisitOut(
        id=v.id,
        guid=v.guid,
        contact_id=v.contact_id,
        contact_name=name,
        visit_date=v.visit_date,
        visit_type=picklist_map.get("visit.type"),
        location=v.location,
        notes=v.notes,
        interactions=v.interactions or [],
        torah_thought=picklist_map.get("checklist.torah_thought"),
        custom_field_values=custom_field_map or {},
        # fixes35 §5: any visit-scoped select custom field beyond the 2
        # fixed ones above — mirrors ApartmentOut.picklist_values.
        picklist_values={
            k: val for k, val in picklist_map.items() if k not in _VISIT_PICKLIST_FIELD_KEYS
        },
    )


def _out_one(db: Session, v: models.VisitHistory) -> VisitOut:
    """`_out` for a single visit (create/update endpoints)."""
    values = picklist_utils.get_values(db, v.organization_id, "visit_history", v.id)
    custom_values = custom_field_utils.get_values(
        db, v.organization_id, "visit", v.id
    )
    return _out(v, values, custom_values)


def _out_many(db: Session, org_id: int, rows: list[models.VisitHistory]) -> list[VisitOut]:
    """`_out` for a list of visits, resolving every picklist value in one query."""
    picklist_map = picklist_utils.get_values_bulk(
        db, org_id, "visit_history", [v.id for v in rows]
    )
    custom_field_map = custom_field_utils.get_values_bulk(
        db, org_id, "visit", [v.id for v in rows]
    )
    return [_out(v, picklist_map.get(v.id, {}), custom_field_map.get(v.id, {})) for v in rows]


def _contact_or_404(contact_id: int, org_id: int, db: Session) -> models.Contact:
    c = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == contact_id,
            models.Contact.organization_id == org_id,
        )
        .first()
    )
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return c


def _validate_contact(contact_id: Optional[int], org_id: int, db: Session) -> None:
    """Contact is optional; if given it must belong to the caller's org."""
    if contact_id is not None:
        _contact_or_404(contact_id, org_id, db)


def _visit_or_404(
    visit_id: int, org_id: int, db: Session, contact_id: Optional[int] = None
) -> models.VisitHistory:
    q = db.query(models.VisitHistory).filter(
        models.VisitHistory.id == visit_id,
        models.VisitHistory.organization_id == org_id,
    )
    if contact_id is not None:
        q = q.filter(models.VisitHistory.contact_id == contact_id)
    v = q.first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Visit not found")
    return v


def _prepare_interactions(
    entries, db: Session, org_id: int, current_user: models.User
) -> list[dict]:
    """Validate + normalize an interactions payload into the stored JSON shape.
    Missing timestamps/author names are stamped from the current request."""
    now = datetime.datetime.utcnow().isoformat()
    out = []
    for e in entries:
        validate_picklist_value(db, org_id, "interaction.category", e.category)
        out.append(
            {
                "category": e.category,
                "note": e.note,
                "created_at": e.created_at or now,
                "author_name": e.author_name or current_user.full_name,
            }
        )
    return out


def _apply_payload(
    v: models.VisitHistory,
    data: dict,
    db: Session,
    org_id: int,
    current_user: models.User,
) -> None:
    """Set validated payload fields on a visit (shared by create/update).
    visit_type/torah_thought are PicklistLink-backed (fixes32) and need `v.id`
    to attach to — every plain field is set first, then the session is
    flushed (a no-op if `v` was already persisted, i.e. an update) before
    writing the picklist links."""
    has_visit_type = "visit_type" in data
    visit_type = data.pop("visit_type", None)
    if has_visit_type:
        validate_picklist_value(db, org_id, "visit.type", visit_type)
    has_torah_thought = "torah_thought" in data
    torah_thought = data.pop("torah_thought", None)
    if has_torah_thought:
        validate_picklist_value(db, org_id, "checklist.torah_thought", torah_thought)
    interactions = data.pop("interactions", None)
    if interactions is not None:
        v.interactions = interactions  # already normalized by the caller
    custom_field_changes = data.pop("custom_field_values", None) or {}
    # fixes35 §5: any visit-scoped select custom field beyond the 2 fixed ones.
    dynamic_picklist_changes = data.pop("picklist_values", None) or {}
    for field, value in data.items():
        setattr(v, field, value)
    if has_visit_type or has_torah_thought or custom_field_changes or dynamic_picklist_changes:
        db.flush()  # ensure v.id exists for the picklist links / custom values
    if has_visit_type:
        picklist_utils.set_value(db, org_id, "visit_history", v.id, "visit.type", visit_type)
    if has_torah_thought:
        picklist_utils.set_value(
            db, org_id, "visit_history", v.id, "checklist.torah_thought", torah_thought
        )
    for field_key, value in dynamic_picklist_changes.items():
        picklist_utils.set_value(db, org_id, "visit_history", v.id, field_key, value)
    for field_key, value in custom_field_changes.items():
        custom_field_utils.set_value(db, org_id, "visit", v.id, field_key, value)


# --- Per-contact sub-resource (contact page) -------------------------------
@router.get("/{contact_id}/visits", response_model=list[VisitOut])
def list_visits(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
):
    _contact_or_404(contact_id, current_user.organization_id, db)
    rows = (
        db.query(models.VisitHistory)
        .filter(
            models.VisitHistory.contact_id == contact_id,
            models.VisitHistory.organization_id == current_user.organization_id,
        )
        .order_by(models.VisitHistory.visit_date.desc())
        .all()
    )
    return _out_many(db, current_user.organization_id, rows)


@router.post("/{contact_id}/visits", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def add_visit(
    contact_id: int,
    payload: VisitCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
):
    org_id = current_user.organization_id
    _contact_or_404(contact_id, org_id, db)
    data = payload.model_dump()
    data["contact_id"] = contact_id  # locked to the path
    data["interactions"] = _prepare_interactions(
        payload.interactions, db, org_id, current_user
    )
    v = models.VisitHistory(organization_id=org_id)
    db.add(v)
    _apply_payload(v, data, db, org_id, current_user)
    db.commit()
    db.refresh(v)
    return _out_one(db, v)


# PATCH aliases (fixes26 §2): the handlers are already partial via
# exclude_unset; inline-editing autosave sends one field at a time.
@router.put("/{contact_id}/visits/{visit_id}", response_model=VisitOut)
@router.patch("/{contact_id}/visits/{visit_id}", response_model=VisitOut)
def update_visit(
    contact_id: int,
    visit_id: int,
    payload: VisitUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
):
    org_id = current_user.organization_id
    v = _visit_or_404(visit_id, org_id, db, contact_id=contact_id)
    data = payload.model_dump(exclude_unset=True)
    # contact_id stays locked to the path on the sub-resource.
    data.pop("contact_id", None)
    if payload.interactions is not None:
        data["interactions"] = _prepare_interactions(
            payload.interactions, db, org_id, current_user
        )
    _apply_payload(v, data, db, org_id, current_user)
    db.commit()
    db.refresh(v)
    return _out_one(db, v)


@router.delete("/{contact_id}/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(
    contact_id: int,
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
):
    v = _visit_or_404(visit_id, current_user.organization_id, db, contact_id=contact_id)
    picklist_utils.delete_links(db, "visit_history", v.id)
    db.delete(v)
    db.commit()


# --- Top-level entity (admin-only org-wide visits page) --------------------
@all_router.get("", response_model=list[VisitOut])
def list_all_visits(
    contact_id: Optional[int] = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    q = db.query(models.VisitHistory).filter(
        models.VisitHistory.organization_id == admin.organization_id
    )
    if contact_id is not None:
        q = q.filter(models.VisitHistory.contact_id == contact_id)
    rows = q.order_by(models.VisitHistory.visit_date.desc()).all()
    return _out_many(db, admin.organization_id, rows)


@all_router.get("/summary", response_model=VisitSummaryOut)
def visits_summary(
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    contact_id: Optional[int] = None,
    assigned_user_id: Optional[str] = None,
    scope_all: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes38 §1.2/§1.3: "Summary of Visits" report + per-contact Visit
    Summary — total count + per-category breakdown, scoped to the caller's
    assigned contacts unless a specific contact is requested or the caller
    opted into `scope_all`.

    fixes39 §2: the breakdown is dynamic — every active
    entity_type="visit" boolean custom field (the 6 former Mivtzoim columns
    plus any org-added checklist item, e.g. "mezuzah"), not a fixed tuple.

    fixes40 §3: `assigned_user_id` scopes to one specific user's contacts
    (the "Filter by contact owner" control) — takes priority over
    `scope_all`/the default self-scoping, but only for a non-shliach caller.
    A shliach account is never allowed to self-serve another user's data
    through this param — same guarantee the default branch already gave
    them (they only ever fell into the self-scoping "else" below), just
    made explicit now that a second, caller-suppliable scoping path exists.

    fixes50 §3.1: `date_from`/`date_to` are optional — omitting either side
    leaves that end of the range open (the "show all dates" control sends
    neither). fixes50 §3.2: `scope_all` is no longer admin-exclusive — any
    non-shliach caller may request it, same guard `assigned_user_id` already
    used above; a shliach is still always confined to their own contacts.
    """
    org_id = current_user.organization_id
    q = db.query(models.VisitHistory).filter(
        models.VisitHistory.organization_id == org_id
    )
    if date_from is not None:
        q = q.filter(
            models.VisitHistory.visit_date
            >= datetime.datetime.combine(date_from, datetime.time.min)
        )
    if date_to is not None:
        q = q.filter(
            models.VisitHistory.visit_date
            <= datetime.datetime.combine(date_to, datetime.time.max)
        )
    if contact_id is not None:
        q = q.filter(models.VisitHistory.contact_id == contact_id)
    elif current_user.role != "shliach" and assigned_user_id is not None:
        q = q.join(
            models.Contact, models.VisitHistory.contact_id == models.Contact.id
        ).filter(models.Contact.assigned_user_id == assigned_user_id)
    elif not (current_user.role != "shliach" and scope_all):
        # Standard user (or admin/staff without the "all" toggle): only
        # visits for contacts assigned to them. The inner join drops
        # unlinked visits.
        q = q.join(
            models.Contact, models.VisitHistory.contact_id == models.Contact.id
        ).filter(models.Contact.assigned_user_id == current_user.guid)
    rows = q.order_by(models.VisitHistory.visit_date.desc()).all()

    defs = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_type == "boolean",
            models.CustomFieldDefinition.is_active.is_(True),
        )
        .order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id)
        .all()
    )
    visit_ids = [v.id for v in rows]
    checked_visit_ids_by_def: dict[int, set[int]] = {}
    if defs and visit_ids:
        checked_rows = db.query(
            models.CustomFieldValue.definition_id, models.CustomFieldValue.visit_id
        ).filter(
            models.CustomFieldValue.definition_id.in_([d.id for d in defs]),
            models.CustomFieldValue.visit_id.in_(visit_ids),
            models.CustomFieldValue.checked.is_(True),
        )
        for definition_id, visit_id in checked_rows:
            checked_visit_ids_by_def.setdefault(definition_id, set()).add(visit_id)

    categories = []
    for d in defs:
        checked_ids = checked_visit_ids_by_def.get(d.id, set())
        matching = [v for v in rows if v.id in checked_ids and v.contact_id]
        categories.append(
            VisitSummaryCategory(
                key=d.field_key,
                hebrew_label=d.hebrew_label,
                english_label=d.english_label,
                count=len(matching),
                items=[
                    VisitSummaryItem(
                        visit_id=v.id,
                        visit_date=v.visit_date,
                        contact_id=v.contact_id,
                        contact_name=f"{v.contact.name} {v.contact.last_name or ''}".strip(),
                    )
                    for v in matching
                ],
            )
        )
    return VisitSummaryOut(total=len(rows), categories=categories)


@all_router.post("", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def create_visit(
    payload: VisitCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    _validate_contact(payload.contact_id, org_id, db)
    data = payload.model_dump()
    data["interactions"] = _prepare_interactions(
        payload.interactions, db, org_id, admin
    )
    v = models.VisitHistory(organization_id=org_id)
    db.add(v)
    _apply_payload(v, data, db, org_id, admin)
    db.commit()
    db.refresh(v)
    return _out_one(db, v)


@all_router.put("/{visit_id}", response_model=VisitOut)
@all_router.patch("/{visit_id}", response_model=VisitOut)
def update_any_visit(
    visit_id: int,
    payload: VisitUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    v = _visit_or_404(visit_id, org_id, db)
    data = payload.model_dump(exclude_unset=True)
    if "contact_id" in data:
        _validate_contact(data["contact_id"], org_id, db)
    if payload.interactions is not None:
        data["interactions"] = _prepare_interactions(
            payload.interactions, db, org_id, admin
        )
    _apply_payload(v, data, db, org_id, admin)
    db.commit()
    db.refresh(v)
    return _out_one(db, v)


@all_router.delete("/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_any_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    v = _visit_or_404(visit_id, admin.organization_id, db)
    picklist_utils.delete_links(db, "visit_history", v.id)
    db.delete(v)
    db.commit()


# --- Custom fields (per-visit values, fixes25) ------------------------------
@all_router.get("/{visit_id}/custom-fields", response_model=list[ContactCustomFieldOut])
def get_visit_custom_fields(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    v = _visit_or_404(visit_id, org_id, db)
    defs = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.is_active.is_(True),
            # fixes35: this endpoint is the legacy boolean+note contract —
            # scope it to exactly the fields it always covered, now that
            # CustomFieldDefinition also holds apartment/contact fields.
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_type == "boolean",
        )
        .order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id)
        .all()
    )
    values = {val.definition_id: val for val in v.custom_values}
    result = []
    for d in defs:
        val = values.get(d.id)
        result.append(
            ContactCustomFieldOut(
                definition_id=d.id,
                field_key=d.field_key,
                hebrew_label=d.hebrew_label,
                checked=val.checked if val else False,
                note=val.note if val else None,
            )
        )
    return result


@all_router.put("/{visit_id}/custom-fields", response_model=list[ContactCustomFieldOut])
def set_visit_custom_fields(
    visit_id: int,
    payload: list[CustomFieldValueIn],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    v = _visit_or_404(visit_id, org_id, db)
    valid_ids = {
        d.id
        for d in db.query(models.CustomFieldDefinition.id)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_type == "boolean",
        )
        .all()
    }
    existing = {val.definition_id: val for val in v.custom_values}
    for item in payload:
        if item.definition_id not in valid_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"definition_id {item.definition_id} does not exist",
            )
        val = existing.get(item.definition_id)
        if val:
            val.checked = item.checked
            val.note = item.note
        else:
            db.add(
                models.CustomFieldValue(
                    organization_id=org_id,
                    entity_table="visit_history",
                    entity_id=v.id,
                    visit_id=v.id,
                    definition_id=item.definition_id,
                    checked=item.checked,
                    note=item.note,
                )
            )
    db.commit()
    return get_visit_custom_fields(visit_id, db, current_user)
