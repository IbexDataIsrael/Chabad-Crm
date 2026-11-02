"""fixes117: a contact in the chat helper (`/api/assistant/contacts`).

JWT only: the user and organization come from the token; the platform
superadmin is refused (403). Only admin and staff reach contacts here, and
only prospect (mekurav) contacts in their own organization — an activist or
campaign manager, an activist contact, another org's contact and a missing
contact all answer the same 404. No delete, ever.

Which fields may be read, edited or filled on a new visit is decided by
app/contact_edit_rules.py from the org's own settings, never by the helper.

- `GET  /{contact_id}`         — the contact: visible core values,
  `editable_fields`, the last 5 visits (`recent_visits`), the fields a new
  visit takes (`new_visit_fields`) and `can_add_visit` (false on a draft).
- `POST /{contact_id}/update`  — {field_key, value, request_id?}: one field
  per call, through the dashboard's own contact update. A field that is
  hidden, unknown or not editable here is the same 403; a bad value is a 422
  naming the field; the current value again is "unchanged". Contacts keep a
  stable id on save (no versions), so `contact_id` never changes.
- `POST /{contact_id}/visits`  — {values, request_id?}: one new visit, the
  whole visit in one call, through the dashboard's own visit write. Active
  contacts only (a draft is a 409).

`request_id` (fixes118): recorded in the same transaction as the write
(core/assistant_requests.py); the same request_id again replays the original
answer (`replayed: true`) and writes nothing; with a different request it is
a 422 `request_id_reused`.
"""
import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import contact_edit_rules as rules
from app import custom_field_utils, models, picklist_utils
from app.apartment_edit_rules import invalid
from app.core import assistant_requests
from app.core.user_locale import pick, user_locale
from app.database import get_db
from app.deps import require_org_user
from app.routers.contacts import update_contact
from app.routers.visits import _apply_payload, _prepare_interactions
from app.schemas import ContactUpdate, MekuravData, VisitInteraction

router = APIRouter(prefix="/api/assistant/contacts", tags=["assistant"])

CONTACT_ROLES = ("admin", "staff")
RECENT_VISITS = 5
ACTION_UPDATE = "contact_update"
ACTION_VISIT = "visit_create"
DRAFT_LABEL_KEY = "contacts.draft_badge"
_CORE_COLUMNS = ("name", "last_name", "phone", "email", "address")


class FieldUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_key: str
    value: Any = None  # checked per field kind (contact_edit_rules)
    request_id: Optional[str] = Field(default=None, min_length=1, max_length=64)


class VisitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: dict[str, Any] = {}
    request_id: Optional[str] = Field(default=None, min_length=1, max_length=64)


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")


def _forbidden_field() -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, "This field cannot be edited here")


def _contact_or_404(db: Session, user: models.User, contact_id: int) -> models.Contact:
    """Hidden and missing look the same: existence is never disclosed."""
    if user.role not in CONTACT_ROLES:
        raise _not_found()
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == contact_id,
            models.Contact.organization_id == user.organization_id,
            models.Contact.contact_type == "mekurav",
        )
        .first()
    )
    if contact is None:
        raise _not_found()
    return contact


def _draft_label(db: Session, locale: str) -> str:
    row = (
        db.query(models.FieldLocalization)
        .filter(models.FieldLocalization.technical_name == DRAFT_LABEL_KEY)
        .first()
    )
    he, en = (row.hebrew_label, row.english_label) if row else ("טיוטה", "Draft")
    return pick(locale, he, en)


# --- Read -------------------------------------------------------------------
def _option_labels(db: Session, org_id: int, keys: list[str], locale: str) -> dict:
    """{picklist: {value: label}}, deactivated options included, so an old
    visit still shows the label it was saved with."""
    out: dict[str, dict] = {k: {} for k in keys}
    if not keys:
        return out
    rows = db.query(models.PicklistValue).filter(
        models.PicklistValue.organization_id == org_id,
        models.PicklistValue.field_key.in_(keys),
    )
    for o in rows:
        out[o.field_key][o.value] = pick(locale, o.hebrew_label, o.english_value) or o.value
    return out


def _visit_views(
    db: Session, org_id: int, visits: list[models.VisitHistory], specs: list[rules.Spec], locale: str
) -> list[dict]:
    ids = [v.id for v in visits]
    links = picklist_utils.get_values_bulk(db, org_id, "visit_history", ids)
    custom = custom_field_utils.get_values_bulk(db, org_id, "visit", ids)
    labels = _option_labels(db, org_id, [s.picklist for s in specs if s.picklist], locale)
    by_key = {s.field_key: s for s in specs}

    def option(s: rules.Spec, value):
        return labels[s.picklist].get(value, value) if value is not None else None

    out = []
    for v in visits:
        picked = links.get(v.id, {})
        values = custom.get(v.id, {})
        done = []
        for s in specs:
            if s.target == "visit_select" or s.field_key == rules.TORAH_KEY:
                value = picked.get(s.picklist)
                if value is not None:
                    done.append(f"{s.label}: {option(s, value)}")
            elif s.target == "custom":
                value = values.get(s.key)
                if s.kind == "yes_no":
                    if value:
                        done.append(s.label)
                elif value not in (None, ""):
                    if isinstance(value, float) and value.is_integer():
                        value = int(value)
                    done.append(f"{s.label}: {value}")
        view = {
            "visit_id": v.id,
            "visit_date": v.visit_date.date().isoformat() if v.visit_date else None,
            "visit_type": (
                option(by_key[rules.VISIT_TYPE_KEY], picked.get("visit.type"))
                if rules.VISIT_TYPE_KEY in by_key else None
            ),
            "done": done,
            "notes": v.notes,
        }
        if rules.LOCATION_KEY in by_key:
            view["location"] = v.location
        if rules.INTERACTIONS_KEY in by_key:
            s = by_key[rules.INTERACTIONS_KEY]
            view["interactions"] = [
                {"category": option(s, i.get("category")), "note": i.get("note")}
                for i in (v.interactions or [])
            ]
        out.append(view)
    return out


def _contact_view(db: Session, user: models.User, contact: models.Contact) -> dict:
    locale = user_locale(db, user)
    specs = rules.contact_specs(db, user, locale)
    current = rules.contact_current_values(db, contact, specs)
    visit_specs = rules.new_visit_specs(db, user, locale)
    visits = (
        db.query(models.VisitHistory)
        .filter(
            models.VisitHistory.organization_id == contact.organization_id,
            models.VisitHistory.contact_id == contact.id,
        )
        .order_by(models.VisitHistory.visit_date.desc(), models.VisitHistory.id.desc())
        .limit(RECENT_VISITS)
        .all()
    )
    view: dict[str, Any] = {
        "contact_id": contact.id,
        "status": contact.status,
        "status_label": _draft_label(db, locale) if contact.status == "draft" else None,
    }
    # Only what this user may see: a field hidden by the org is not sent.
    shown = {s.key for s in specs if s.target == "column"}
    for column in _CORE_COLUMNS:
        if column in shown:
            view[column] = getattr(contact, column)
    view.update({
        "web_path": f"/dashboard/contacts/{contact.id}",
        "editable_fields": [rules.entry(s, current[s.field_key]) for s in specs],
        "can_add_visit": contact.status == "active",
        "new_visit_fields": [rules.visit_field_entry(s) for s in visit_specs],
        "recent_visits": _visit_views(db, contact.organization_id, visits, visit_specs, locale),
    })
    return view


@router.get("/{contact_id}")
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    return _contact_view(db, current_user, _contact_or_404(db, current_user, contact_id))


# --- Update one field ---------------------------------------------------------
def _update_answer(
    db: Session, user: models.User, contact_id: int, outcome: str, field_key: str, replayed: bool
) -> dict:
    """Read back from the database: the answer is the server's state."""
    db.expire_all()
    contact = _contact_or_404(db, user, contact_id)
    view = _contact_view(db, user, contact)
    entry = next((f for f in view["editable_fields"] if f["field_key"] == field_key), None)
    return {
        "status": outcome,
        "replayed": replayed,
        "field_key": field_key,
        "value": entry["current_value"] if entry else None,
        "contact_id": contact.id,
        "contact": view,
    }


def _replayed_update(db: Session, user: models.User, contact_id: int, body: FieldUpdateIn, hashed: str):
    db.rollback()
    record = assistant_requests.find(db, user, body.request_id)
    if record is None:
        return None
    if record.request_hash != hashed:
        raise invalid("request_id", "request_id_reused")
    return _update_answer(db, user, contact_id, record.outcome, body.field_key, replayed=True)


def _payload(spec: rules.Spec, value: Any) -> ContactUpdate:
    if spec.target == "column":
        return ContactUpdate(**{spec.key: value})
    if spec.target == "next_step":
        return ContactUpdate(mekurav=MekuravData(potential_next_step=value))
    if spec.target == "custom":
        return ContactUpdate(custom_field_values={spec.key: value})
    if spec.key == "contact.pipeline_status":
        return ContactUpdate(pipeline_status=value)
    if spec.key == "contact.color_tag":
        return ContactUpdate(color_tag=value)
    return ContactUpdate(picklist_values={spec.key: value})


@router.post("/{contact_id}/update")
def update_contact_field(
    contact_id: int,
    body: FieldUpdateIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    hashed = assistant_requests.request_hash(ACTION_UPDATE, contact_id, body.field_key, body.value)
    if body.request_id:
        record = assistant_requests.find(db, current_user, body.request_id)
        if record is not None:
            if record.request_hash != hashed or record.target_id != contact_id:
                raise invalid("request_id", "request_id_reused")
            _contact_or_404(db, current_user, contact_id)
            return _update_answer(db, current_user, contact_id, record.outcome,
                                  body.field_key, replayed=True)

    contact = _contact_or_404(db, current_user, contact_id)
    # Recomputed here, never trusted from the chat.
    specs = rules.contact_specs(db, current_user, user_locale(db, current_user))
    spec = next((s for s in specs if s.field_key == body.field_key), None)
    if spec is None:
        raise _forbidden_field()
    value = rules.parse_contact_value(db, contact, spec, body.value)
    current = rules.contact_current_values(db, contact, [spec])[spec.field_key]

    outcome = "unchanged" if rules.same(spec.kind, current, value) else "updated"
    try:
        if body.request_id:
            assistant_requests.record(db, current_user, body.request_id, ACTION_UPDATE, hashed,
                                      outcome, contact.id, contact.id)
        if outcome == "unchanged":
            db.commit()
        else:
            # The dashboard's own contact update; it commits our record with it.
            update_contact(contact_id=contact.id, payload=_payload(spec, value), db=db,
                           current_user=current_user, _forbid=current_user)
    except IntegrityError:
        if body.request_id:
            answer = _replayed_update(db, current_user, contact.id, body, hashed)
            if answer is not None:
                return answer
        db.rollback()
        # The only other unique rule on this write: the phone, taken meanwhile.
        raise invalid(spec.field_key, "phone_taken", value)
    except Exception:
        db.rollback()
        raise
    return _update_answer(db, current_user, contact.id, outcome, body.field_key, replayed=False)


# --- New visit ----------------------------------------------------------------
def _visit_answer(
    db: Session, user: models.User, contact: models.Contact, visit_id: int, replayed: bool
) -> dict:
    db.expire_all()
    visit = db.get(models.VisitHistory, visit_id)
    view = None
    if visit is not None:  # deleted on the dashboard since (a replay)
        locale = user_locale(db, user)
        specs = rules.new_visit_specs(db, user, locale)
        view = _visit_views(db, user.organization_id, [visit], specs, locale)[0]
    return {
        "status": "created",
        "replayed": replayed,
        "visit_id": visit_id,
        "contact_id": contact.id,
        "visit": view,
    }


def _visit_data(specs: list[rules.Spec], values: dict) -> dict:
    by_key = {s.field_key: s for s in specs}
    for key in values:
        if key not in by_key:
            raise _forbidden_field()
    parsed = {key: rules.parse_visit_value(by_key[key], value) for key, value in values.items()}
    day = parsed.get(rules.VISIT_DATE_KEY) or datetime.date.today().isoformat()
    data: dict[str, Any] = {
        "visit_date": datetime.datetime.combine(datetime.date.fromisoformat(day), datetime.time()),
        "custom_field_values": {},
        "picklist_values": {},
        "interactions": [],
    }
    for key, value in parsed.items():
        s = by_key[key]
        if key == rules.VISIT_DATE_KEY or value is None:
            continue
        if s.target == "visit_column":
            data[s.key] = value
        elif s.target == "visit_picklist":
            data[s.key] = value
        elif s.target == "visit_select":
            data["picklist_values"][s.picklist] = value
        elif s.target == "custom":
            if value is not False:  # an unticked mitzva is simply not stored
                data["custom_field_values"][s.key] = value
        elif s.target == "interactions":
            data["interactions"] = value
    return data


@router.post("/{contact_id}/visits", status_code=status.HTTP_201_CREATED)
def add_visit(
    contact_id: int,
    body: VisitIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    hashed = assistant_requests.request_hash(ACTION_VISIT, contact_id, body.values)
    contact = _contact_or_404(db, current_user, contact_id)
    if body.request_id:
        record = assistant_requests.find(db, current_user, body.request_id)
        if record is not None:
            if record.request_hash != hashed or record.target_id != contact_id:
                raise invalid("request_id", "request_id_reused")
            return _visit_answer(db, current_user, contact, record.result_id, replayed=True)
    if contact.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "Approve the contact first")

    specs = rules.new_visit_specs(db, current_user, user_locale(db, current_user))
    data = _visit_data(specs, body.values)
    org_id = current_user.organization_id
    data["contact_id"] = contact.id
    data["interactions"] = _prepare_interactions(
        [VisitInteraction(**i) for i in data["interactions"]], db, org_id, current_user
    )
    try:
        visit = models.VisitHistory(organization_id=org_id)
        db.add(visit)
        # The dashboard's own visit write (routers/visits.py add_visit).
        _apply_payload(visit, data, db, org_id, current_user)
        db.flush()
        if body.request_id:
            assistant_requests.record(db, current_user, body.request_id, ACTION_VISIT, hashed,
                                      "created", contact.id, visit.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        record = assistant_requests.find(db, current_user, body.request_id) if body.request_id else None
        if record is None:
            raise
        if record.request_hash != hashed:
            raise invalid("request_id", "request_id_reused")
        return _visit_answer(db, current_user, contact, record.result_id, replayed=True)
    except Exception:
        db.rollback()
        raise
    return _visit_answer(db, current_user, contact, visit.id, replayed=False)
