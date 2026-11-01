"""fixes114/fixes115/fixes118: edit an apartment's status fields from the chat
(`/api/assistant/apartments`).

JWT only, like the contact proposals in routers/assistant.py (fixes113): the
user and organization come from the token, never from the body; the platform
superadmin is refused. Reads follow the dashboard's visibility rules
(routers/apartments.py list_apartments): active versions only,
status="active" only (Instinct drafts stay out), and a shliach sees only the
apartments assigned to them. Not visible and not found are the same 404.

Which fields a user may edit is decided by app/apartment_edit_rules.py
(apartment fields only; every role edits like an activist), never by the chat:
every apartment comes back with its `editable_fields`, and an update
recomputes that set before writing.

- `GET  /search?q=`                  — building address / apartment number /
  resident name, at most 20 (same matching as the Instinct search).
- `GET  /getapartment?id={lineage_id}` — the lineage's current version (the
  open / re-read after a timeout, 404 or 409; an apartment's id changes on
  every edit, its lineage id never does). `GET /by-lineage/{lineage_id}` is
  the same read, kept as an alias.
- `POST /{apartment_id}/update`      — {field_key, value, request_id?}. A
  field that is hidden, locked, unknown or not an apartment field is the same
  403, so hidden fields are not revealed. Claims the current version with a
  conditional UPDATE (id AND is_display) before writing, so of two
  concurrent edits only one retires the row; the other gets 409 and
  re-resolves. Sending the current value again creates no new version
  ("unchanged"). An optional `request_id` is recorded in the same
  transaction as the write (models.AssistantRequest): the same request_id
  again replays the original answer (`replayed: true`) and writes nothing —
  the helper's proof that a write whose answer was lost did happen.
"""
import hashlib
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.apartment_edit_rules import (
    CUSTOM_PREFIX,
    LANGUAGE_KEY,
    apartment_views,
    invalid,
    parse_value,
    same_value,
)
from app.database import get_db
from app.deps import require_org_user
from app.routers.apartments import _apply_versioned_update, _shliach_apartment_ids

router = APIRouter(prefix="/api/assistant/apartments", tags=["assistant"])

SEARCH_LIMIT = 20
ACTION_UPDATE = "apartment_update"


class FieldUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: str
    # Checked per field kind (apartment_edit_rules.parse_value), so a wrong
    # shape is a 422 naming the field.
    value: Any = None
    request_id: Optional[str] = Field(default=None, min_length=1, max_length=64)


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


def _current_of_lineage(db: Session, user: models.User, lineage_id: int):
    """The lineage's current version, if this user may see it."""
    query = _visible_query(db, user)
    if query is None:
        return None
    return query.filter(
        or_(models.Apartment.root_id == lineage_id, models.Apartment.id == lineage_id)
    ).first()


def _views(db: Session, user: models.User, rows: list[models.Apartment]) -> list[dict]:
    return apartment_views(db, user, rows)


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Apartment not found")


@router.get("/search")
def search_apartments(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
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


def _read(db: Session, user: models.User, lineage_id: int) -> dict:
    row = _current_of_lineage(db, user, lineage_id)
    if row is None:
        # Not found and not visible look the same: existence isn't disclosed.
        raise _not_found()
    return _views(db, user, [row])[0]


@router.get("/getapartment")
def get_apartment(
    id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    return _read(db, current_user, id)


@router.get("/by-lineage/{lineage_id}")
def get_by_lineage(
    lineage_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    return _read(db, current_user, lineage_id)


def _request_hash(apartment_id: int, body: FieldUpdateIn) -> str:
    raw = json.dumps(
        [ACTION_UPDATE, apartment_id, body.field_key, body.value],
        sort_keys=True, ensure_ascii=False, default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _find_request(db: Session, user: models.User, request_id: str):
    return (
        db.query(models.AssistantRequest)
        .filter(
            models.AssistantRequest.user_id == user.id,
            models.AssistantRequest.organization_id == user.organization_id,
            models.AssistantRequest.request_id == request_id,
        )
        .first()
    )


def _answer(
    db: Session,
    user: models.User,
    outcome: str,
    field_key: str,
    version: models.Apartment,
    previous_id: Optional[int],
    replayed: bool,
) -> dict:
    """The answer is the server's state, read back from the database."""
    view = _views(db, user, [version])[0]
    entry = next((f for f in view["editable_fields"] if f["field_key"] == field_key), None)
    return {
        "status": outcome,
        "replayed": replayed,
        "field_key": field_key,
        # None only if the saved value left the field uneditable (e.g. an
        # option deactivated meanwhile); the apartment itself is still current.
        "value": entry["current_value"] if entry else None,
        "apartment_id": version.id,
        "previous_apartment_id": previous_id,
        "lineage_id": version.root_id or version.id,
        "apartment": view,
    }


def _replay(db: Session, user: models.User, record: models.AssistantRequest, field_key: str) -> dict:
    version = db.get(models.Apartment, record.result_id)
    if version is None:  # pragma: no cover — apartments are versioned, not deleted
        raise _not_found()
    previous = record.target_id if record.outcome == "updated" else None
    return _answer(db, user, record.outcome, field_key, version, previous, replayed=True)


def _record(db: Session, user: models.User, body: FieldUpdateIn, request_hash: str,
            outcome: str, target_id: int, result_id: int) -> None:
    db.add(models.AssistantRequest(
        organization_id=user.organization_id, user_id=user.id, request_id=body.request_id,
        action=ACTION_UPDATE, request_hash=request_hash, outcome=outcome,
        target_id=target_id, result_id=result_id,
    ))


@router.post("/{apartment_id}/update")
def update_apartment_field(
    apartment_id: int,
    body: FieldUpdateIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    request_hash = _request_hash(apartment_id, body)
    if body.request_id:
        record = _find_request(db, current_user, body.request_id)
        if record is not None:
            if record.request_hash != request_hash:
                raise invalid("request_id", "request_id_reused")
            return _replay(db, current_user, record, body.field_key)

    active = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.id == apartment_id,
            models.Apartment.organization_id == current_user.organization_id,
            models.Apartment.status == "active",
        )
        .first()
    )
    if active is None:
        raise _not_found()
    # An apartment this user may not see (an activist's unassigned one,
    # retired version or not) is the same 404 as a missing one.
    if _current_of_lineage(db, current_user, active.root_id or active.id) is None:
        raise _not_found()
    if not active.is_display:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This apartment was changed meanwhile — load it again"
        )

    # Recomputed here, never trusted from the chat.
    before = _views(db, current_user, [active])[0]
    entry = next(
        (f for f in before["editable_fields"] if f["field_key"] == body.field_key), None
    )
    if entry is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This field cannot be edited here")
    value = parse_value(entry, body.value)

    if same_value(entry["kind"], entry["current_value"], value):
        if body.request_id:
            try:
                _record(db, current_user, body, request_hash, "unchanged", active.id, active.id)
                db.commit()
            except IntegrityError:
                return _after_duplicate(db, current_user, body, request_hash)
        return _answer(db, current_user, "unchanged", body.field_key, active, None, replayed=False)

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
        if body.request_id:
            _record(db, current_user, body, request_hash, "updated", active.id, new.id)
        db.commit()
    except HTTPException:
        raise
    except IntegrityError:
        if body.request_id:
            # The same request_id committed first (a concurrent retry): our
            # write was rolled back with it — answer with the one that won.
            return _after_duplicate(db, current_user, body, request_hash)
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    db.expire_all()
    new = db.get(models.Apartment, new.id)
    return _answer(db, current_user, "updated", body.field_key, new, active.id, replayed=False)


def _after_duplicate(db: Session, user: models.User, body: FieldUpdateIn, request_hash: str) -> dict:
    db.rollback()
    record = _find_request(db, user, body.request_id)
    if record is None:  # pragma: no cover — the IntegrityError came from elsewhere
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This apartment was changed meanwhile — load it again"
        )
    if record.request_hash != request_hash:
        raise invalid("request_id", "request_id_reused")
    return _replay(db, user, record, body.field_key)


def _write(db: Session, active: models.Apartment, field_key: str, value: Any, user: models.User):
    """The dashboard's own versioned write, in the caller's transaction."""
    if field_key == LANGUAGE_KEY:
        return _apply_versioned_update(db, active, {}, {}, user, language_values=value, commit=False)
    if field_key.startswith(CUSTOM_PREFIX):
        return _apply_versioned_update(
            db, active, {}, {}, user, {field_key[len(CUSTOM_PREFIX):]: value}, commit=False
        )
    return _apply_versioned_update(db, active, {}, {field_key: value}, user, commit=False)
