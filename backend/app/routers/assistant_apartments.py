"""fixes114: edit an apartment from the chat (`/api/assistant/apartments`).

JWT only, like the contact proposals in routers/assistant.py (fixes113): the
user and organization come from the token, never from the body. Reads follow
the dashboard's visibility rules (routers/apartments.py list_apartments):
active versions only, status="active" only (Instinct drafts stay out), and a
shliach sees only the apartments assigned to them. Writes follow the
dashboard PUT's rules plus the admin's activist edit locks
(shliach_view_config: disable_edit / apartment_edit_locked_fields, the
shliach-config page), and go through the same versioned update, so the
editor is stamped and to_knock stays in sync.

- `GET  /fields`                     — the fields this user may edit here,
  each with the org's active options. Admin-controlled, not a fixed list.
- `GET  /search?q=`                  — building address / apartment number /
  resident name, at most 20 (same matching as the Instinct search).
- `GET  /by-lineage/{lineage_id}`    — the lineage's current version (the
  re-resolution read after a timeout, 404 or 409; an apartment's id changes
  on every edit, its lineage id never does).
- `POST /{apartment_id}/update`      — {field, value}. Claims the current
  version with a conditional UPDATE (id AND is_display) before writing, so of
  two concurrent edits only one retires the row; the other gets 409 and
  re-resolves. Sending the current value again creates no new version
  ("unchanged").

This phase writes only the picklist fields in EDITABLE_FIELDS.
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models, picklist_utils
from app.database import get_db
from app.deps import get_current_user
from app.routers.apartments import (
    _APARTMENT_LANGUAGE_FIELD_KEY,
    _APARTMENT_PICKLISTS,
    _apply_versioned_update,
    _shliach_apartment_ids,
)

router = APIRouter(prefix="/api/assistant/apartments", tags=["assistant"])

SEARCH_LIMIT = 20

# field -> (picklist field_key, "single" | "multi"). The lock keys on the
# shliach-config page are these same field names (APARTMENT_FIELD_KEYS there).
EDITABLE_FIELDS = {
    "jewish_status": (_APARTMENT_PICKLISTS["jewish_status"], "single"),
    "language": (_APARTMENT_LANGUAGE_FIELD_KEY, "multi"),
}


class FieldUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    # str for a single-value field, list[str] for a multi-value one; checked
    # per field below so a wrong shape is a 422 naming the field.
    value: Any = None


def _invalid(field: str, code: str, value: Any = None) -> HTTPException:
    item = {"field": field, "code": code}
    if value is not None:
        item["value"] = value
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"status": "invalid", "invalid_fields": [item]},
    )


def _locked_for(db: Session, user: models.User) -> Optional[set[str]]:
    """The admin's activist edit locks: None = editing disabled entirely."""
    if user.role != "shliach":
        return set()
    org = db.get(models.Organization, user.organization_id)
    cfg = org.shliach_view_config if org and isinstance(org.shliach_view_config, dict) else {}
    if cfg.get("disable_edit"):
        return None
    return set(cfg.get("apartment_edit_locked_fields") or [])


def _is_editable(field: str, locked: Optional[set[str]]) -> bool:
    if locked is None:
        return False
    return field not in locked and EDITABLE_FIELDS[field][0] not in locked


def _options(db: Session, org_id: int, field_key: str) -> list[models.PicklistValue]:
    return (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == field_key,
            models.PicklistValue.is_active.is_(True),
        )
        .order_by(models.PicklistValue.sort_order, models.PicklistValue.id)
        .all()
    )


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


def _summaries(db: Session, org_id: int, rows: list[models.Apartment]) -> list[dict]:
    ids = [a.id for a in rows]
    js_key = EDITABLE_FIELDS["jewish_status"][0]
    values = picklist_utils.get_values_bulk(db, org_id, "apartments", ids)
    languages = picklist_utils.get_multi_values_bulk(
        db, org_id, "apartments", ids, _APARTMENT_LANGUAGE_FIELD_KEY
    )
    return [
        {
            "apartment_id": a.id,
            "lineage_id": a.root_id or a.id,
            "building_address": a.building.building_address if a.building else None,
            "apartment_name": a.apartment_name,
            "floor": a.floor,
            "resident_name": a.name,
            "jewish_status": values.get(a.id, {}).get(js_key),
            "language": languages.get(a.id, []),
        }
        for a in rows
    ]


@router.get("/fields")
def editable_fields(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    locked = _locked_for(db, current_user)
    out = []
    for field, (field_key, kind) in EDITABLE_FIELDS.items():
        if not _is_editable(field, locked):
            continue
        options = _options(db, org_id, field_key)
        if not options:
            continue  # nothing to pick from (the admin hasn't set options up)
        definition = (
            db.query(models.PicklistDefinition)
            .filter(
                models.PicklistDefinition.organization_id == org_id,
                models.PicklistDefinition.system_name == field_key,
            )
            .first()
        )
        out.append({
            "field": field,
            "field_key": field_key,
            "type": kind,
            "label_he": definition.hebrew_display_name if definition else field,
            "label_en": (definition.english_display_name if definition else None) or field,
            "options": [
                {"value": o.value, "label_he": o.hebrew_label, "label_en": o.english_value or o.value}
                for o in options
            ],
        })
    return {"fields": out}


@router.get("/search")
def search_apartments(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = q.strip()
    if not q:
        raise _invalid("q", "required")
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
        "results": _summaries(db, current_user.organization_id, rows[:SEARCH_LIMIT]),
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
    return _summaries(db, current_user.organization_id, [row])[0]


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
    if body.field not in EDITABLE_FIELDS:
        raise _invalid(body.field, "field_not_supported")
    if not _is_editable(body.field, _locked_for(db, current_user)):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your organization does not let activists edit this field"
        )

    field_key, kind = EDITABLE_FIELDS[body.field]
    if kind == "single":
        if not isinstance(body.value, str) or not body.value.strip():
            raise _invalid(body.field, "expected_text")
        values = [body.value.strip()]
    else:
        if not isinstance(body.value, list) or not all(isinstance(v, str) for v in body.value):
            raise _invalid(body.field, "expected_list")
        values = list(dict.fromkeys(v.strip() for v in body.value if v.strip()))
    allowed = {o.value for o in _options(db, org_id, field_key)}
    if not allowed:
        raise _invalid(body.field, "no_options")
    for value in values:
        if value not in allowed:
            raise _invalid(body.field, "value_not_allowed", value)

    lineage_id = active.root_id or active.id
    before = _summaries(db, org_id, [active])[0]
    current = before[body.field]
    if (kind == "single" and current == values[0]) or (
        kind == "multi" and sorted(current or []) == sorted(values)
    ):
        return {
            "status": "unchanged",
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
        if kind == "single":
            new = _apply_versioned_update(db, active, {}, {field_key: values[0]}, current_user)
        else:
            new = _apply_versioned_update(
                db, active, {}, {}, current_user, language_values=values
            )
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise

    # Read back what was stored — the answer is the server's state, not the request.
    db.expire_all()
    saved = db.get(models.Apartment, new.id)
    return {
        "status": "updated",
        "apartment_id": saved.id,
        "previous_apartment_id": active.id,
        "lineage_id": lineage_id,
        "apartment": _summaries(db, org_id, [saved])[0],
    }
