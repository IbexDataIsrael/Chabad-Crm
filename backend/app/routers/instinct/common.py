"""Shared pieces of the Instinct API (docs/system_api.md, docs/system_api_part2.md):
the shared-key auth, the target org, and the validators / notes / custom-field
helpers every endpoint module uses."""
import datetime
import os
import re
from typing import Any, Optional

from fastapi import Header, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.schemas import _normalize_email

# Basic shape check only (something@domain.tld) — not full RFC validation.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# phase 2 §2: Israeli mobile only — 05X + 8 more digits (10 total).
_IL_MOBILE_RE = re.compile(r"^05[0-9]{8}$")
_PHONE_STRIP_RE = re.compile(r"[\s\-()]")
PHONE_ERROR = (
    "invalid Israeli mobile phone: expected 05X + 8 more digits (10 total), "
    "e.g. 0501234567"
)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def check_key(x_instinct_key: str = Header(...)):
    expected = os.environ.get("INSTINCT_API_KEY")
    # An unset key must never match — otherwise the endpoint is open.
    if not expected or x_instinct_key != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "bad key")


def org_id() -> int:
    return int(os.environ.get("INSTINCT_ORG_ID", "1"))


def unprocessable(message: str) -> HTTPException:
    return HTTPException(422, message)


def clean_phone(value: Optional[str]) -> Optional[str]:
    """phase 2 §2: strip spaces/dashes/parentheses, map a +972 / 972 prefix to
    0, require 05XXXXXXXX. Returns the normalized form (what gets stored), or
    None for an empty value. Raises the spec's exact 422 otherwise. Never
    applied to names."""
    if value is None:
        return None
    phone = _PHONE_STRIP_RE.sub("", value)
    if not phone:
        return None
    if phone.startswith("+972"):
        phone = "0" + phone[4:]
    elif phone.startswith("972"):
        phone = "0" + phone[3:]
    if not _IL_MOBILE_RE.match(phone):
        raise unprocessable(PHONE_ERROR)
    return phone


def clean_email(value: Optional[str]) -> Optional[str]:
    """phase 1 rule: trimmed + lowercased, basic shape check (ValueError, so
    pydantic reports it as a 422 on the field)."""
    value = _normalize_email(value)
    if value is not None and not _EMAIL_RE.match(value):
        raise ValueError("invalid email format")
    return value


def parse_date(value: Optional[str], field: str = "date") -> datetime.date:
    """Strict YYYY-MM-DD (None -> today, server local time)."""
    if value is None:
        return datetime.date.today()
    try:
        if not _DATE_RE.match(value):
            raise ValueError
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise unprocessable(f"invalid {field}: expected YYYY-MM-DD, e.g. 2026-09-24")


def day_bounds(day: datetime.date) -> tuple[datetime.datetime, datetime.datetime]:
    start = datetime.datetime.combine(day, datetime.time())
    return start, start + datetime.timedelta(days=1)


def append_note(existing: Optional[str], text: str) -> str:
    """Notes are a parking lot: append a timestamped entry, never overwrite."""
    entry = f"[{datetime.datetime.now():%Y-%m-%d %H:%M}] {text}"
    return f"{existing}\n{entry}" if existing else entry


def full_name(name: Optional[str], last_name: Optional[str]) -> str:
    return " ".join(p for p in (name, last_name) if p)


def active_apartment(db: Session, apartment_id: int, org: int) -> Optional[models.Apartment]:
    return (
        db.query(models.Apartment)
        .filter(
            models.Apartment.id == apartment_id,
            models.Apartment.organization_id == org,
            models.Apartment.is_display.is_(True),
        )
        .first()
    )


# --- custom fields ----------------------------------------------------------

def _coerce(field_key: str, field_type: str, value: Any) -> Any:
    """Validate one custom-field value by its definition's field_type. A wrong
    type is a 422 naming the key (unknown keys never get this far)."""
    if field_type == "number":
        if isinstance(value, bool):
            raise unprocessable(f"field '{field_key}' expects a whole number")
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, str) and re.fullmatch(r"-?\d+", value.strip()):
            return int(value.strip())
        raise unprocessable(f"field '{field_key}' expects a whole number")
    if field_type == "date":
        if isinstance(value, str):
            try:
                return parse_date(value.strip(), field_key).isoformat()
            except HTTPException:
                pass
        raise unprocessable(f"field '{field_key}' expects a date YYYY-MM-DD")
    if field_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip().lower() in ("true", "false"):
            return value.strip().lower() == "true"
        raise unprocessable(f"field '{field_key}' expects true or false")
    return str(value)  # text


def write_custom_fields(
    db: Session,
    org: int,
    entity_type: str,
    entity_table: str,
    entity_id: int,
    fields: dict[str, Any],
) -> tuple[dict[str, Any], list[str]]:
    """Upsert CustomFieldValue rows for `fields` (phase 2 §3/§4). Every value
    is validated before anything is written, so a 422 leaves no partial
    write. A key with no active definition — or a `select` definition, whose
    values live in picklists, not here — is never an error: it is returned in
    the parked list for the caller to append to the entity's notes. Storage
    mirrors app/custom_field_utils.set_value (boolean -> `checked`, others ->
    `value` as a string; visit rows also carry the legacy visit_id)."""
    definitions = {
        d.field_key: d
        for d in db.query(models.CustomFieldDefinition).filter(
            models.CustomFieldDefinition.organization_id == org,
            models.CustomFieldDefinition.entity_type == entity_type,
            models.CustomFieldDefinition.field_key.in_(list(fields)),
            models.CustomFieldDefinition.is_active.is_(True),
            models.CustomFieldDefinition.field_type != "select",
        )
    }
    parked = [key for key in fields if key not in definitions]
    written = {
        key: _coerce(key, definitions[key].field_type, value)
        for key, value in fields.items()
        if key in definitions and value is not None
    }
    # An explicit null clears the stored value.
    cleared = [key for key, value in fields.items() if key in definitions and value is None]

    existing = {
        row.definition_id: row
        for row in db.query(models.CustomFieldValue).filter(
            models.CustomFieldValue.entity_table == entity_table,
            models.CustomFieldValue.entity_id == entity_id,
            models.CustomFieldValue.definition_id.in_([d.id for d in definitions.values()]),
        )
    }
    for key in cleared:
        row = existing.get(definitions[key].id)
        if row is not None:
            db.delete(row)
    for key, value in written.items():
        definition = definitions[key]
        is_bool = definition.field_type == "boolean"
        checked = bool(value) if is_bool else False
        text_value = None if is_bool else str(value)
        row = existing.get(definition.id)
        if row is None:
            db.add(
                models.CustomFieldValue(
                    organization_id=org,
                    entity_table=entity_table,
                    entity_id=entity_id,
                    visit_id=entity_id if entity_table == "visit_history" else None,
                    definition_id=definition.id,
                    checked=checked,
                    value=text_value,
                )
            )
        else:
            row.checked = checked
            row.value = text_value
    return written, parked
