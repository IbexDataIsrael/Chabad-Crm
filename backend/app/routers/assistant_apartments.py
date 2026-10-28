"""fixes114/fixes115: edit an apartment from the chat (`/api/assistant/apartments`).

JWT only, like the contact proposals in routers/assistant.py (fixes113): the
user and organization come from the token, never from the body. Reads follow
the dashboard's visibility rules (routers/apartments.py list_apartments):
active versions only, status="active" only (Instinct drafts stay out), and a
shliach sees only the apartments assigned to them.

Which fields a user may edit is decided by app/apartment_edit_rules.py (org
field settings, the active campaign's hide flags and the activist locks),
never by the chat: every apartment comes back with its `editable_fields`, and
an update recomputes that set before writing.

- `GET  /search?q=`                  — building address / apartment number /
  resident name, at most 20 (same matching as the Instinct search).
- `GET  /by-lineage/{lineage_id}`    — the lineage's current version (the
  re-resolution read after a timeout, 404 or 409; an apartment's id changes
  on every edit, its lineage id never does).
- `POST /{apartment_id}/update`      — {field_key, value}. A field that is
  hidden, locked, unknown or internal is the same 403, so hidden fields are
  not revealed. Claims the current version with a conditional UPDATE (id AND
  is_display) before writing, so of two concurrent edits only one retires
  the row; the other gets 409 and re-resolves. Sending the current value
  again creates no new version ("unchanged").
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.apartment_edit_rules import (
    COLUMNS,
    CUSTOM_PREFIX,
    LANGUAGE_KEY,
    apartment_views,
    invalid,
    parse_value,
    same_value,
)
from app.database import get_db
from app.deps import get_current_user
from app.routers.apartments import _apply_versioned_update, _shliach_apartment_ids

router = APIRouter(prefix="/api/assistant/apartments", tags=["assistant"])

SEARCH_LIMIT = 20


class FieldUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: str
    # Checked per field kind (apartment_edit_rules.parse_value), so a wrong
    # shape is a 422 naming the field.
    value: Any = None


def _visible_query(db: Session, user: models.User):
    """Dashboard visibility (list_apartments): None when a shliach has nothing."""
    query = db.query(models.Apartment).filter(
        models.Apartment.organization_id == user.organization_id,
        models.Apartment.is_display.is_(True),
        models.Apartment.status == "active",
    )
    if user.role == "shliach":
        ids = _shliach_apartment_ids(db, user)
        if not ids:
            return None
        query = query.filter(models.Apartment.id.in_(ids))
    return query


def _views(db: Session, user: models.User, rows: list[models.Apartment]) -> list[dict]:
    return apartment_views(db, user, rows)


@router.get("/search")
def search_apartments(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = q.strip()
    if not q:
        raise invalid("q", "required")
    query = _visible_query(db, current_user)
    if query is None:
        return {"results": [], "truncated": False}
    A, B = models.Apartment, models.Building
    rows = (
        query.join(B, B.id == A.building_id)
        .filter(
            or_(
                B.building_address.icontains(q, autoescape=True),
                A.apartment_name.icontains(q, autoescape=True),
                A.name.icontains(q, autoescape=True),
            )
        )
        .order_by(B.building_address, A.apartment_name, A.id)
        .limit(SEARCH_LIMIT + 1)
        .all()
    )
    return {
        "results": _views(db, current_user, rows[:SEARCH_LIMIT]),
        "truncated": len(rows) > SEARCH_LIMIT,
    }


@router.get("/by-lineage/{lineage_id}")
def get_by_lineage(
    lineage_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = _visible_query(db, current_user)
    row = None
    if query is not None:
        row = query.filter(
            or_(models.Apartment.root_id == lineage_id, models.Apartment.id == lineage_id)
        ).first()
    if row is None:
        # Not found and not visible look the same: existence isn't disclosed.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    return _views(db, current_user, [row])[0]


@router.post("/{apartment_id}/update")
def update_apartment_field(
    apartment_id: int,
    body: FieldUpdateIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    active = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.id == apartment_id,
            models.Apartment.organization_id == org_id,
            models.Apartment.status == "active",
        )
        .first()
    )
    if active is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")
    if not active.is_display:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This apartment was changed meanwhile — load it again"
        )
    if current_user.role == "shliach" and active.id not in _shliach_apartment_ids(
        db, current_user
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You can only edit apartments assigned to you"
        )

    # Recomputed here, never trusted from the chat.
    before = _views(db, current_user, [active])[0]
    entry = next(
        (f for f in before["editable_fields"] if f["field_key"] == body.field_key), None
    )
    if entry is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This field cannot be edited here")
    value = parse_value(entry, body.value)

    lineage_id = active.root_id or active.id
    if same_value(entry["kind"], entry["current_value"], value):
        return {
            "status": "unchanged",
            "field_key": body.field_key,
            "value": entry["current_value"],
            "apartment_id": active.id,
            "previous_apartment_id": None,
            "lineage_id": lineage_id,
            "apartment": before,
        }

    try:
        # The claim: only one concurrent edit can retire this version.
        claimed = (
            db.query(models.Apartment)
            .filter(models.Apartment.id == active.id, models.Apartment.is_display.is_(True))
            .update({models.Apartment.is_display: False}, synchronize_session=False)
        )
        if claimed != 1:
            db.rollback()
            raise HTTPException(
                status.HTTP_409_CONFLICT, "This apartment was changed meanwhile — load it again"
            )
        new = _write(db, active, body.field_key, value, current_user)
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise

    # Read back what was stored — the answer is the server's state, not the request.
    db.expire_all()
    saved = _views(db, current_user, [db.get(models.Apartment, new.id)])[0]
    saved_entry = next(
        (f for f in saved["editable_fields"] if f["field_key"] == body.field_key), None
    )
    return {
        "status": "updated",
        "field_key": body.field_key,
        # None only if the saved value left the field uneditable (e.g. an
        # option deactivated meanwhile); the apartment itself is still current.
        "value": saved_entry["current_value"] if saved_entry else None,
        "apartment_id": new.id,
        "previous_apartment_id": active.id,
        "lineage_id": lineage_id,
        "apartment": saved,
    }


def _write(db: Session, active: models.Apartment, field_key: str, value: Any, user: models.User):
    """The dashboard's own versioned write for each kind of field."""
    if field_key == LANGUAGE_KEY:
        return _apply_versioned_update(db, active, {}, {}, user, language_values=value)
    if field_key in COLUMNS:
        return _apply_versioned_update(db, active, {COLUMNS[field_key]: value}, {}, user)
    if field_key.startswith(CUSTOM_PREFIX):
        return _apply_versioned_update(
            db, active, {}, {}, user, {field_key[len(CUSTOM_PREFIX):]: value}
        )
    return _apply_versioned_update(db, active, {}, {field_key: value}, user)
