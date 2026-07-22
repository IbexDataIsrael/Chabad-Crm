"""Helpers for non-select custom field values (fixes35).

Mirrors `picklist_utils.py`'s generic get/set/copy/delete shape — but unlike
picklists, a custom field's *definition* is looked up by `entity_type`
(`"contact_mekurav" | "contact_shliach" | "visit" | "apartment"`), while its
*value* is stored under `entity_table`/`entity_id` (the row it actually
attaches to). These are NOT the same axis: `contact_mekurav` and
`contact_shliach` custom fields both store as `entity_table="contacts"`
(there is one `Contact` row either way — `entity_type` only picks which
form/section renders the field, matching how `MEKURAV_PICKLISTS` and a
shliach's own picklists both already resolve to `entity_table="contacts"`
today). `storage_table()` below is the single place that maps one to the
other, so every caller passes an explicit `entity_type` and never has to
know the storage mapping itself.

`field_type: "select"` custom fields never touch this module at all; their
options and selected values live entirely in `PicklistDefinition`/
`PicklistValue`/`PicklistLink` — see `select_system_name()`.
"""
import datetime
from typing import Optional, Union

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models

FieldValue = Union[str, float, bool, None]

# entity_type -> the table its custom field VALUES are stored against.
_STORAGE_TABLE: dict[str, str] = {
    "contact_mekurav": "contacts",
    "contact_shliach": "contacts",
    "visit": "visit_history",
    "apartment": "apartments",
}

# entity_type -> PicklistDefinition.system_name prefix for a select-type
# custom field (fixes35 §5 design decision) — matches the prefix convention
# every other entity's picklists already use.
_SELECT_PREFIX_BY_ENTITY: dict[str, str] = {
    "apartment": "apartment.",
    "visit": "checklist.",
    "contact_shliach": "shliach.",
    "contact_mekurav": "",  # bare field_key, matches today's "Contacts tab" convention
}


def storage_table(entity_type: str) -> str:
    return _STORAGE_TABLE[entity_type]


def select_system_name(entity_type: str, field_key: str) -> str:
    prefix = _SELECT_PREFIX_BY_ENTITY.get(entity_type, "")
    return f"{prefix}{field_key}"


def _parse_for_type(field_type: str, value: FieldValue) -> FieldValue:
    """Validate `value` against `field_type` — 400 on a type mismatch,
    mirroring `picklist_utils.validate_picklist_value`'s error shape."""
    if value is None:
        return None
    if field_type == "number":
        try:
            return float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"'{value}' is not a valid number"
            )
    if field_type == "date":
        try:
            datetime.date.fromisoformat(str(value)[:10])
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"'{value}' is not a valid ISO date"
            )
        return str(value)
    if field_type == "boolean":
        return bool(value)
    return str(value)  # text


def _read_value(field_type: str, checked: bool, value: Optional[str]) -> FieldValue:
    """The stored row back to its declared Python type — `value` is always a
    plain string in the DB (mirrors PicklistValue.value); numbers are cast
    back to float on read so callers see the type CustomFieldValue promises."""
    if field_type == "boolean":
        return checked
    if field_type == "number":
        return float(value) if value is not None else None
    return value


def get_values(
    db: Session, organization_id: int, entity_type: str, entity_id: int
) -> dict[str, FieldValue]:
    """One entity's non-select custom field values, keyed by field_key."""
    rows = (
        db.query(models.CustomFieldDefinition, models.CustomFieldValue)
        .join(
            models.CustomFieldValue,
            models.CustomFieldValue.definition_id == models.CustomFieldDefinition.id,
        )
        .filter(
            models.CustomFieldDefinition.organization_id == organization_id,
            models.CustomFieldDefinition.entity_type == entity_type,
            models.CustomFieldDefinition.field_type != "select",
            models.CustomFieldValue.entity_table == storage_table(entity_type),
            models.CustomFieldValue.entity_id == entity_id,
        )
        .all()
    )
    return {d.field_key: _read_value(d.field_type, v.checked, v.value) for d, v in rows}


def get_values_bulk(
    db: Session, organization_id: int, entity_type: str, entity_ids: list[int]
) -> dict[int, dict[str, FieldValue]]:
    """`get_values` for many entities in one query (list endpoints)."""
    if not entity_ids:
        return {}
    rows = (
        db.query(
            models.CustomFieldValue.entity_id,
            models.CustomFieldDefinition.field_key,
            models.CustomFieldDefinition.field_type,
            models.CustomFieldValue.checked,
            models.CustomFieldValue.value,
        )
        .join(
            models.CustomFieldDefinition,
            models.CustomFieldDefinition.id == models.CustomFieldValue.definition_id,
        )
        .filter(
            models.CustomFieldDefinition.organization_id == organization_id,
            models.CustomFieldDefinition.entity_type == entity_type,
            models.CustomFieldDefinition.field_type != "select",
            models.CustomFieldValue.entity_table == storage_table(entity_type),
            models.CustomFieldValue.entity_id.in_(entity_ids),
        )
        .all()
    )
    result: dict[int, dict[str, FieldValue]] = {eid: {} for eid in entity_ids}
    for entity_id, field_key, field_type, checked, value in rows:
        result[entity_id][field_key] = _read_value(field_type, checked, value)
    return result


def set_value(
    db: Session,
    organization_id: int,
    entity_type: str,
    entity_id: int,
    field_key: str,
    value: FieldValue,
) -> None:
    """Upsert (or clear, when `value` is None) one entity's value for one
    non-select custom field. The definition must already exist (admin-created
    via the custom-fields dashboard) — unlike picklists, custom fields have
    no legacy self-healing path to preserve, so an unknown field_key 400s."""
    definition = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == organization_id,
            models.CustomFieldDefinition.entity_type == entity_type,
            models.CustomFieldDefinition.field_key == field_key,
        )
        .first()
    )
    if definition is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown custom field '{field_key}'"
        )
    if definition.field_type == "select":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"'{field_key}' is a select field — set it via picklist_values, not custom_field_values",
        )
    parsed = _parse_for_type(definition.field_type, value)
    table = storage_table(entity_type)

    existing = (
        db.query(models.CustomFieldValue)
        .filter(
            models.CustomFieldValue.entity_table == table,
            models.CustomFieldValue.entity_id == entity_id,
            models.CustomFieldValue.definition_id == definition.id,
        )
        .first()
    )

    if parsed is None:
        if existing is not None:
            db.delete(existing)
        return

    checked = parsed if definition.field_type == "boolean" else False
    text_value = None if definition.field_type == "boolean" else parsed

    if existing is not None:
        existing.checked = checked
        existing.value = text_value
        if table == "visit_history":
            existing.visit_id = entity_id
    else:
        db.add(
            models.CustomFieldValue(
                organization_id=organization_id,
                entity_table=table,
                entity_id=entity_id,
                # fixes25 compat: VisitHistory.custom_values' delete-orphan
                # cascade keys off visit_id — populate it whenever this value
                # attaches to a visit, so a visit delete still cleans up its
                # non-boolean custom values too, not just the legacy ones.
                visit_id=entity_id if table == "visit_history" else None,
                definition_id=definition.id,
                checked=checked,
                value=text_value,
            )
        )


def copy_values(db: Session, entity_table: str, from_entity_id: int, to_entity_id: int) -> None:
    """Copy every non-select custom field value from one entity row onto
    another (apartment versioning support, mirrors picklist_utils.copy_links)."""
    rows = (
        db.query(models.CustomFieldValue)
        .filter(
            models.CustomFieldValue.entity_table == entity_table,
            models.CustomFieldValue.entity_id == from_entity_id,
        )
        .all()
    )
    for row in rows:
        db.add(
            models.CustomFieldValue(
                organization_id=row.organization_id,
                entity_table=entity_table,
                entity_id=to_entity_id,
                definition_id=row.definition_id,
                checked=row.checked,
                note=row.note,
                value=row.value,
            )
        )
    if rows:
        db.flush()


def delete_values(db: Session, entity_table: str, entity_id: int) -> None:
    db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.entity_table == entity_table,
        models.CustomFieldValue.entity_id == entity_id,
    ).delete(synchronize_session=False)


def delete_values_many(db: Session, entity_table: str, entity_ids: list[int]) -> None:
    if not entity_ids:
        return
    db.query(models.CustomFieldValue).filter(
        models.CustomFieldValue.entity_table == entity_table,
        models.CustomFieldValue.entity_id.in_(entity_ids),
    ).delete(synchronize_session=False)
