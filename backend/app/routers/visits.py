"""Visit history (היסטורית ביקורים).

Two routers over the same `VisitHistory` entity:
- `router`      — per-contact sub-resource (/api/contacts/{id}/visits), open to any
                  authenticated org member; powers the contact page's visit section.
- `all_router`  — top-level (/api/visits): CRUD is **admin-only** (the org-wide
                  visits page); the custom-fields sub-resource is open to any org
                  member (it backs the contact-page visit editor too).

fixes25: a visit carries the engagement data that used to live on the contact —
an `interactions` JSON log (picklist `interaction.category`), the Mivtzoim
boolean flags, `torah_thought` (picklist `checklist.torah_thought`) and
`connection_to_rebbe`. Custom-field values attach to visits
(`/api/visits/{id}/custom-fields`).
"""
import datetime

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.picklist_utils import validate_picklist_value
from app.schemas import (
    ContactCustomFieldOut,
    CustomFieldValueIn,
    VisitCreate,
    VisitOut,
    VisitUpdate,
)

router = APIRouter(prefix="/api/contacts", tags=["visits"])
all_router = APIRouter(prefix="/api/visits", tags=["visits"])

# Visit fields settable straight from a payload dict (picklist-validated ones
# are handled explicitly).
_MIVTZOIM_FLAGS = (
    "tefillin",
    "tzedakah",
    "shabbat_candles",
    "torah_pamphlet",
    "letter_in_torah",
)


def _out(v: models.VisitHistory) -> VisitOut:
    contact = v.contact
    name = f"{contact.name} {contact.last_name or ''}".strip() if contact else None
    return VisitOut(
        id=v.id,
        guid=v.guid,
        contact_id=v.contact_id,
        contact_name=name,
        visit_date=v.visit_date,
        visit_type=v.visit_type,
        location=v.location,
        notes=v.notes,
        interactions=v.interactions or [],
        tefillin=v.tefillin,
        tzedakah=v.tzedakah,
        shabbat_candles=v.shabbat_candles,
        torah_pamphlet=v.torah_pamphlet,
        letter_in_torah=v.letter_in_torah,
        torah_thought=v.torah_thought,
        connection_to_rebbe=v.connection_to_rebbe,
    )


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
    """Set validated payload fields on a visit (shared by create/update)."""
    if "visit_type" in data:
        validate_picklist_value(db, org_id, "visit.type", data["visit_type"])
    if "torah_thought" in data:
        validate_picklist_value(
            db, org_id, "checklist.torah_thought", data["torah_thought"]
        )
    interactions = data.pop("interactions", None)
    if interactions is not None:
        v.interactions = interactions  # already normalized by the caller
    for field, value in data.items():
        setattr(v, field, value)


# --- Per-contact sub-resource (contact page) -------------------------------
@router.get("/{contact_id}/visits", response_model=list[VisitOut])
def list_visits(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
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
    return [_out(v) for v in rows]


@router.post("/{contact_id}/visits", response_model=VisitOut, status_code=status.HTTP_201_CREATED)
def add_visit(
    contact_id: int,
    payload: VisitCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    _contact_or_404(contact_id, org_id, db)
    data = payload.model_dump()
    data["contact_id"] = contact_id  # locked to the path
    data["interactions"] = _prepare_interactions(
        payload.interactions, db, org_id, current_user
    )
    v = models.VisitHistory(organization_id=org_id)
    _apply_payload(v, data, db, org_id, current_user)
    db.add(v)
    db.commit()
    db.refresh(v)
    return _out(v)


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
    return _out(v)


@router.delete("/{contact_id}/visits/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_visit(
    contact_id: int,
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    v = _visit_or_404(visit_id, current_user.organization_id, db, contact_id=contact_id)
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
    return [_out(v) for v in rows]


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
    _apply_payload(v, data, db, org_id, admin)
    db.add(v)
    db.commit()
    db.refresh(v)
    return _out(v)


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
    return _out(v)


@all_router.delete("/{visit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_any_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    v = _visit_or_404(visit_id, admin.organization_id, db)
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
        .filter(models.CustomFieldDefinition.organization_id == org_id)
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
                    visit_id=v.id,
                    definition_id=item.definition_id,
                    checked=item.checked,
                    note=item.note,
                )
            )
    db.commit()
    return get_visit_custom_fields(visit_id, db, current_user)
