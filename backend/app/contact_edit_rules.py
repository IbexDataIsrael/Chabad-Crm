"""fixes117: which contact fields and which new-visit fields the chat helper
may use, decided on the server (the contact counterpart of
apartment_edit_rules.py).

Only admin and staff reach contacts through the helper, and only prospect
(mekurav) contacts — activist contacts are out of the helper entirely
(owner decision, round 4). Both roles may edit every visible field, so the
set below is "the contact page's fields, minus what the org hides":

- Core: first name (never hidden, never cleared), last name, phone, email,
  address, pipeline status, color tag, priority score — each hideable on the
  Fields page under its own `contacts.*` key.
- The prospect section (`contact_mekurav.section`, hidden by default):
  next step, the org's prospect picklists (Jewish status, affiliation,
  language and any admin-added one) and the prospect custom fields
  (yes/no, text, number, date). Recommendations, background, tzedaka
  potential, admin area, apartment link and first visit are never edited
  here.

New visit (`new_visit_specs`): every field of the dashboard visit form —
date, visit type, location, Torah thought, the org's visit custom fields
(the Mivtzoim yes/no fields, text such as connection to the Rebbe, numbers,
dates, lists), notes and the interactions log — minus what the org hides.

One label per field and option, in the user's language (core/user_locale).
"""
import datetime
from dataclasses import dataclass, field as dc_field
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import custom_field_utils, models, picklist_utils
from app.apartment_edit_rules import _hidden_by_org, _labels, _picklist_options, invalid
from app.core.user_locale import pick
from app.schemas import _normalize_email, _validate_phone

MEKURAV = "contact_mekurav"
SECTION_KEY = "contact_mekurav.section"
NEXT_STEP_KEY = "contact_mekurav.potential_next_step"
NEXT_STEP_PICKLIST = "contact.potential_next_step"
CONTACT_CUSTOM_PREFIX = "customfield.contact_mekurav."
VISIT_CUSTOM_PREFIX = "customfield.visit."

# The prospect picklists that are core columns or have their own row above.
_FIXED_CONTACT_PICKLISTS = {
    "contact.contact_type", "contact.pipeline_status", "contact.color_tag", NEXT_STEP_PICKLIST,
}
# (field_key = Fields-page key, label key, kind, column, picklist)
_CORE = [
    ("contacts.name", "contacts.name", "text", "name", None),
    ("contacts.last_name", "contacts.last_name", "text", "last_name", None),
    ("contacts.phone", "contacts.phone", "text", "phone", None),
    ("contacts.email", "contacts.email", "text", "email", None),
    ("contacts.address", "contacts.address", "text", "address", None),
    ("contacts.pipeline_status", "contacts.pipeline_status", "single_option", None, "contact.pipeline_status"),
    ("contacts.color_tag", "contacts.color_tag", "single_option", None, "contact.color_tag"),
    ("contacts.priority_score", "contacts.priority_score", "number", "priority_score", None),
]
NAME_KEY = "contacts.name"
PHONE_KEY = "contacts.phone"
EMAIL_KEY = "contacts.email"
_MAX_LENGTH = {"name": 150, "last_name": 100, "phone": 50, "email": 255}
_CUSTOM_KIND = {"boolean": "yes_no", "text": "text", "number": "number", "date": "date"}

# Labels used when the localization row is missing (fresh test DBs).
_FALLBACK = {
    "contacts.name": ("שם פרטי", "First name"),
    "contacts.last_name": ("שם משפחה", "Last name"),
    "contacts.phone": ("טלפון", "Phone"),
    "contacts.email": ("אימייל", "Email"),
    "contacts.address": ("כתובת", "Address"),
    "contacts.pipeline_status": ("סטטוס", "Status"),
    "contacts.color_tag": ("צבע", "Color"),
    "contacts.priority_score": ("ציון עדיפות", "Priority score"),
    "contact_mekurav.potential_next_step": ("צעד הבא", "Next step"),
    "visit.date": ("תאריך", "Date"),
    "visits.visit_type": ("סוג ביקור", "Visit type"),
    "visits.location": ("מיקום", "Location"),
    "visits.torah_thought": ("דבר תורה", "Torah thought"),
    "visit.notes": ("הערות", "Notes"),
    "visits.interactions": ("אינטראקציות", "Interactions"),
}

# New-visit fields: (field_key, label key, kind, Fields-page hide key or None)
VISIT_DATE_KEY = "visits.visit_date"
VISIT_TYPE_KEY = "visits.visit_type"
LOCATION_KEY = "visits.location"
TORAH_KEY = "visits.torah_thought"
NOTES_KEY = "visits.notes"
INTERACTIONS_KEY = "visits.interactions"
VISIT_PICKLIST = {VISIT_TYPE_KEY: "visit.type", TORAH_KEY: "checklist.torah_thought"}


@dataclass
class Spec:
    field_key: str
    label: str
    kind: str  # text | number | date | yes_no | single_option | entries
    target: str  # column | contact_picklist | next_step | custom | visit_column | visit_picklist | interactions
    key: str  # column name / picklist system_name / custom field_key
    picklist: Optional[str] = None  # where the options come from
    default: Any = None
    options: list[dict] = dc_field(default_factory=list)


def _label(labels: dict, locale: str, key: str) -> str:
    he, en = labels.get(key) or _FALLBACK.get(key, (key, None))
    return pick(locale, he, en) or key


def _with_options(db: Session, org_id: int, specs: list[Spec], locale: str) -> list[Spec]:
    """Fill the options; an option field with nothing to pick is left out."""
    keys = [s.picklist for s in specs if s.picklist]
    options = _picklist_options(db, org_id, keys, locale)
    out = []
    for s in specs:
        if s.picklist:
            s.options = options[s.picklist]
            if not s.options:
                continue
        out.append(s)
    return out


# --- Contact fields ---------------------------------------------------------
def contact_specs(db: Session, user: models.User, locale: str) -> list[Spec]:
    org_id = user.organization_id
    hidden = _hidden_by_org(db, org_id)
    label_keys = [k[1] for k in _CORE] + [NEXT_STEP_KEY]
    labels = _labels(db, label_keys)
    specs = []
    for field_key, label_key, kind, column, picklist in _CORE:
        if field_key != NAME_KEY and field_key in hidden:
            continue
        target = "column" if column else "contact_picklist"
        specs.append(Spec(field_key, _label(labels, locale, label_key), kind, target,
                          column or picklist, picklist=picklist))

    if SECTION_KEY not in hidden:
        if NEXT_STEP_KEY not in hidden:
            specs.append(Spec(NEXT_STEP_KEY, _label(labels, locale, NEXT_STEP_KEY), "single_option",
                              "next_step", NEXT_STEP_PICKLIST, picklist=NEXT_STEP_PICKLIST))
        definitions = (
            db.query(models.PicklistDefinition)
            .filter(
                models.PicklistDefinition.organization_id == org_id,
                models.PicklistDefinition.entity_type == MEKURAV,
                models.PicklistDefinition.allow_multiple.is_(False),
            )
            .order_by(models.PicklistDefinition.sort_order, models.PicklistDefinition.id)
        )
        for d in definitions:
            if d.system_name in _FIXED_CONTACT_PICKLISTS or d.system_name in hidden:
                continue
            label = pick(locale, d.hebrew_display_name, d.english_display_name) or d.system_name
            specs.append(Spec(d.system_name, label, "single_option", "contact_picklist",
                              d.system_name, picklist=d.system_name))
        for d in _custom_definitions(db, org_id, MEKURAV):
            key = CONTACT_CUSTOM_PREFIX + d.field_key
            if key in hidden or d.field_type not in _CUSTOM_KIND:
                continue
            label = pick(locale, d.hebrew_label, d.english_label) or d.field_key
            specs.append(Spec(key, label, _CUSTOM_KIND[d.field_type], "custom", d.field_key))
    return _with_options(db, org_id, specs, locale)


def _custom_definitions(db: Session, org_id: int, entity_type: str):
    return (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == entity_type,
            models.CustomFieldDefinition.is_active.is_(True),
        )
        .order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id)
        .all()
    )


def contact_current_values(db: Session, contact: models.Contact, specs: list[Spec]) -> dict:
    org_id = contact.organization_id
    links = picklist_utils.get_values(db, org_id, "contacts", contact.id)
    custom = custom_field_utils.get_values(db, org_id, MEKURAV, contact.id)
    next_step = None
    if contact.mekurav is not None:
        next_step = picklist_utils.get_values(
            db, org_id, "contact_mekurav", contact.mekurav.id, [NEXT_STEP_PICKLIST]
        ).get(NEXT_STEP_PICKLIST)
    out = {}
    for s in specs:
        if s.target == "column":
            out[s.field_key] = getattr(contact, s.key)
        elif s.target == "contact_picklist":
            out[s.field_key] = links.get(s.key)
        elif s.target == "next_step":
            out[s.field_key] = next_step
        else:
            value = custom.get(s.key)
            if s.kind == "yes_no":
                value = bool(value)
            elif s.kind == "number" and isinstance(value, float) and value.is_integer():
                value = int(value)
            out[s.field_key] = value
    return out


def entry(s: Spec, current: Any) -> dict:
    out = {"field_key": s.field_key, "label": s.label, "kind": s.kind, "current_value": current}
    if s.picklist:
        out["options"] = s.options
    return out


# --- Values -----------------------------------------------------------------
def _option(s: Spec, value: Any) -> str:
    if isinstance(value, (bool, list, dict)) or value is None:
        raise invalid(s.field_key, "expected_option")
    for o in s.options:
        if str(o["value"]) == str(value).strip():
            return o["value"]
    raise invalid(s.field_key, "value_not_allowed", value)


def _text(s: Spec, value: Any) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise invalid(s.field_key, "expected_text")
    return value.strip() or None


def _number(s: Spec, value: Any, integer: bool) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        raise invalid(s.field_key, "expected_number")
    try:
        number = float(str(value).strip())
    except ValueError:
        raise invalid(s.field_key, "expected_number", value)
    if integer:
        if not number.is_integer():
            raise invalid(s.field_key, "expected_whole_number", value)
        return int(number)
    return int(number) if number.is_integer() else number


def _date(s: Spec, value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return datetime.date.fromisoformat(str(value).strip()[:10]).isoformat()
    except ValueError:
        raise invalid(s.field_key, "expected_date", value)


def parse_contact_value(
    db: Session, contact: models.Contact, s: Spec, value: Any
) -> Any:
    """The value to store, or a 422 naming the field. A list or yes/no is
    never cleared; text, number and date clear with null (first name never)."""
    if s.kind == "yes_no":
        if not isinstance(value, bool):
            raise invalid(s.field_key, "expected_yes_no")
        return value
    if s.kind == "single_option":
        return _option(s, value)
    if s.kind == "number":
        return _number(s, value, integer=s.target == "column")
    if s.kind == "date":
        return _date(s, value)
    text = _text(s, value)
    if s.field_key == NAME_KEY and text is None:
        raise invalid(s.field_key, "required")
    if text is not None and s.target == "column":
        limit = _MAX_LENGTH.get(s.key)
        if limit and len(text) > limit:
            raise HTTPException(422, detail={"status": "invalid", "invalid_fields": [
                {"field": s.field_key, "code": "too_long", "max_length": limit}]})
        if s.field_key == PHONE_KEY:
            try:
                _validate_phone(text)
            except ValueError:
                raise invalid(s.field_key, "invalid_phone", text)
            taken = (
                db.query(models.Contact.id)
                .filter(
                    models.Contact.organization_id == contact.organization_id,
                    models.Contact.phone == text,
                    models.Contact.id != contact.id,
                )
                .first()
            )
            if taken:
                raise invalid(s.field_key, "phone_taken", text)
        if s.field_key == EMAIL_KEY:
            from app.routers.instinct.common import clean_email
            try:
                text = clean_email(text)
            except ValueError:
                raise invalid(s.field_key, "invalid_email", text)
    return text


def same(kind: str, current: Any, new: Any) -> bool:
    if kind == "number" and current is not None and new is not None:
        return float(current) == float(new)
    if kind == "text" and isinstance(current, str) and isinstance(new, str):
        return current == new
    return current == new


# --- New visit --------------------------------------------------------------
def new_visit_specs(db: Session, user: models.User, locale: str) -> list[Spec]:
    org_id = user.organization_id
    hidden = _hidden_by_org(db, org_id)
    labels = _labels(db, list(_FALLBACK))
    today = datetime.date.today().isoformat()
    specs = [Spec(VISIT_DATE_KEY, _label(labels, locale, "visit.date"), "date",
                  "visit_column", "visit_date", default=today)]
    if VISIT_TYPE_KEY not in hidden:
        specs.append(Spec(VISIT_TYPE_KEY, _label(labels, locale, VISIT_TYPE_KEY), "single_option",
                          "visit_picklist", "visit_type", picklist=VISIT_PICKLIST[VISIT_TYPE_KEY]))
    if LOCATION_KEY not in hidden:
        specs.append(Spec(LOCATION_KEY, _label(labels, locale, LOCATION_KEY), "text",
                          "visit_column", "location"))
    if TORAH_KEY not in hidden:
        specs.append(Spec(TORAH_KEY, _label(labels, locale, TORAH_KEY), "single_option",
                          "visit_picklist", "torah_thought", picklist=VISIT_PICKLIST[TORAH_KEY]))
    for d in _custom_definitions(db, org_id, "visit"):
        key = VISIT_CUSTOM_PREFIX + d.field_key
        if key in hidden:
            continue
        label = pick(locale, d.hebrew_label, d.english_label) or d.field_key
        if d.field_type == "select":
            specs.append(Spec(key, label, "single_option", "visit_select", d.field_key,
                              picklist=custom_field_utils.select_system_name("visit", d.field_key)))
        elif d.field_type in _CUSTOM_KIND:
            kind = _CUSTOM_KIND[d.field_type]
            specs.append(Spec(key, label, kind, "custom", d.field_key,
                              default=False if kind == "yes_no" else None))
    specs.append(Spec(NOTES_KEY, _label(labels, locale, "visit.notes"), "text",
                      "visit_column", "notes"))
    specs.append(Spec(INTERACTIONS_KEY, _label(labels, locale, INTERACTIONS_KEY), "entries",
                      "interactions", "interactions", picklist="interaction.category", default=[]))
    return _with_options(db, org_id, specs, locale)


def visit_field_entry(s: Spec) -> dict:
    out = {"field_key": s.field_key, "label": s.label, "kind": s.kind}
    if s.picklist:
        out["options"] = s.options
    if s.field_key == VISIT_DATE_KEY:
        out["required"] = True
    if s.default is not None:
        out["default"] = s.default
    return out


def parse_visit_value(s: Spec, value: Any) -> Any:
    if s.kind == "yes_no":
        if not isinstance(value, bool):
            raise invalid(s.field_key, "expected_yes_no")
        return value
    if s.kind == "single_option":
        return None if value is None else _option(s, value)
    if s.kind == "number":
        return _number(s, value, integer=False)
    if s.kind == "date":
        return _date(s, value)
    if s.kind == "entries":
        if value is None:
            return []
        if not isinstance(value, list):
            raise invalid(s.field_key, "expected_list")
        out = []
        for item in value:
            if not isinstance(item, dict) or set(item) - {"category", "note"}:
                raise invalid(s.field_key, "expected_entries")
            category = _option(s, item.get("category"))
            note = item.get("note") or ""
            if not isinstance(note, str):
                raise invalid(s.field_key, "expected_entries")
            out.append({"category": category, "note": note.strip()})
        return out
    return _text(s, value)
