"""Helpers tying picklist-backed fields to their (per-organization) picklists.

fixes32: every picklist-backed field's *selected value* lives in the generic
`PicklistLink` table (organization_id, entity_table, entity_id,
picklist_definition_id, picklist_value_id — a real FK, no stored text). There
is no longer a field_key -> model-column map: every field, system or custom,
goes through the same generic get/set helpers below.
"""
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

# The full set of admin-managed picklists: Hebrew display label + the logical
# entity each belongs to ("contact_mekurav" | "contact_shliach" | "apartment"
# | "visit" | "significant_date" — fixes37; matches the same vocabulary
# CustomFieldDefinition.entity_type already used). Admins can manage every
# one of these even before any options exist for their org.
PICKLIST_FIELDS: dict[str, tuple[str, str]] = {
    "contact.contact_type": ("סוג איש קשר", "contact_mekurav"),
    "contact.pipeline_status": ("סטטוס", "contact_mekurav"),
    "contact.color_tag": ("צבע", "contact_mekurav"),
    "contact.potential_next_step": ("פוטנציאל לצעד", "contact_mekurav"),
    "checklist.torah_thought": ("דבר תורה", "visit"),
    "interaction.category": ("קטגוריה", "visit"),
    "visit.type": ("סוג ביקור", "visit"),
    "significant_date.type": ("סוג תאריך", "significant_date"),
    # fixes4: significant_date.title is now free text (removed from the registry).
    "Jewish_status": ("יהדות", "contact_mekurav"),
    "affiliation": ("השתייכות דתית", "contact_mekurav"),
    "language": ("שפה", "contact_mekurav"),
    # fixes7 §4: apartment status picklists (grouped under "דירה" in the UI).
    "apartment.Jewish_status": ("יהדות (דירה)", "apartment"),
    "apartment.campaign_status": ("סטטוס קמפיין", "apartment"),
    "apartment.mezuzah_status": ("מזוזה", "apartment"),
    "apartment.language": ("שפה", "apartment"),  # fixes13
}


def active_values(db: Session, organization_id: int, field_key: str) -> list[str]:
    rows = (
        db.query(models.PicklistValue.value)
        .filter(
            models.PicklistValue.organization_id == organization_id,
            models.PicklistValue.field_key == field_key,
            models.PicklistValue.is_active.is_(True),
        )
        .all()
    )
    return [r[0] for r in rows]


def validate_picklist_value(
    db: Session, organization_id: int, field_key: str, value: Optional[str]
) -> None:
    """Reject a value not in the org's active picklist for `field_key`.

    No-op when value is None, or when the org has no active options for the field
    (fields like apartment.campaign_status ship with zero seeded options —
    admins define their own — so any value is accepted until options exist).
    """
    if value is None:
        return
    options = active_values(db, organization_id, field_key)
    if options and value not in options:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{value}' is not an allowed value for {field_key}",
        )


def count_usage(db: Session, organization_id: int, field_key: str, value: str) -> int:
    """How many of the org's records currently store `value` for `field_key`."""
    return (
        db.query(models.PicklistLink)
        .join(
            models.PicklistDefinition,
            models.PicklistDefinition.id == models.PicklistLink.picklist_definition_id,
        )
        .join(
            models.PicklistValue,
            models.PicklistValue.id == models.PicklistLink.picklist_value_id,
        )
        .filter(
            models.PicklistLink.organization_id == organization_id,
            models.PicklistDefinition.system_name == field_key,
            models.PicklistValue.value == value,
        )
        .count()
    )


def get_values(
    db: Session,
    organization_id: int,
    entity_table: str,
    entity_id: int,
    field_keys: Optional[list[str]] = None,
) -> dict[str, Optional[str]]:
    """One entity's selected values. With `field_keys`, every requested key is
    present in the result (None if unset) — for building a fixed API field.
    Without it, returns whatever picklists happen to be attached (for a
    dynamic `picklist_values` dict)."""
    query = (
        db.query(models.PicklistDefinition.system_name, models.PicklistValue.value)
        .join(
            models.PicklistLink,
            models.PicklistLink.picklist_definition_id == models.PicklistDefinition.id,
        )
        .join(
            models.PicklistValue,
            models.PicklistValue.id == models.PicklistLink.picklist_value_id,
        )
        .filter(
            models.PicklistLink.entity_table == entity_table,
            models.PicklistLink.entity_id == entity_id,
        )
    )
    if field_keys is not None:
        query = query.filter(models.PicklistDefinition.system_name.in_(field_keys))
    found = dict(query.all())
    if field_keys is None:
        return found
    return {k: found.get(k) for k in field_keys}


def get_values_bulk(
    db: Session,
    organization_id: int,
    entity_table: str,
    entity_ids: list[int],
    field_keys: Optional[list[str]] = None,
) -> dict[int, dict[str, Optional[str]]]:
    """`get_values` for many entities in one query (list endpoints — avoids
    one query per row)."""
    if not entity_ids:
        return {}
    query = (
        db.query(
            models.PicklistLink.entity_id,
            models.PicklistDefinition.system_name,
            models.PicklistValue.value,
        )
        .join(
            models.PicklistDefinition,
            models.PicklistDefinition.id == models.PicklistLink.picklist_definition_id,
        )
        .join(
            models.PicklistValue,
            models.PicklistValue.id == models.PicklistLink.picklist_value_id,
        )
        .filter(
            models.PicklistLink.entity_table == entity_table,
            models.PicklistLink.entity_id.in_(entity_ids),
        )
    )
    if field_keys is not None:
        query = query.filter(models.PicklistDefinition.system_name.in_(field_keys))
    result: dict[int, dict[str, Optional[str]]] = {
        eid: ({k: None for k in field_keys} if field_keys is not None else {})
        for eid in entity_ids
    }
    for entity_id, key, value in query.all():
        result[entity_id][key] = value
    return result


def matching_entity_ids(entity_table: str, field_key: str, values: list[str]):
    """A scalar subquery of entity_ids (within `entity_table`) whose stored
    value for `field_key` is one of `values` — for `Model.id.in_(...)` list
    filters. Shared by every router filtering on a picklist-backed field."""
    return (
        select(models.PicklistLink.entity_id)
        .join(
            models.PicklistDefinition,
            models.PicklistDefinition.id == models.PicklistLink.picklist_definition_id,
        )
        .join(
            models.PicklistValue,
            models.PicklistValue.id == models.PicklistLink.picklist_value_id,
        )
        .where(
            models.PicklistLink.entity_table == entity_table,
            models.PicklistDefinition.system_name == field_key,
            models.PicklistValue.value.in_(values),
        )
    )


def set_value(
    db: Session,
    organization_id: int,
    entity_table: str,
    entity_id: int,
    field_key: str,
    value: Optional[str],
) -> None:
    """Upsert (or clear, when `value` is None) one entity's selected option
    for one picklist field. If the org has no *options* configured yet for
    this field (e.g. apartment.campaign_status, which ships empty by design),
    the value is accepted and a matching PicklistValue is created on the fly.

    The picklist *definition* itself is expected to already exist — normally
    provisioned for every org at signup (`provision_org` →
    `seed_picklist_definitions`). For any of the fixed system field_keys in
    `PICKLIST_FIELDS`, a still-missing definition is provisioned here too
    (self-heals orgs that predate a field, or the legacy /auth/register test
    path, which skips provisioning). For anything NOT in that closed registry
    — i.e. a genuinely custom picklist — the definition must already exist
    (admin-created via the Picklists dashboard); this is the same guard the
    old contact-only dynamic-picklist path had, so a regular user can't
    silently register a new picklist just by naming it in a payload."""
    validate_picklist_value(db, organization_id, field_key, value)

    definition = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == organization_id,
            models.PicklistDefinition.system_name == field_key,
        )
        .first()
    )
    if definition is None:
        if field_key not in PICKLIST_FIELDS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"unknown picklist '{field_key}'"
            )
        hebrew_label, entity_type = PICKLIST_FIELDS[field_key]
        definition = models.PicklistDefinition(
            organization_id=organization_id,
            system_name=field_key,
            hebrew_display_name=hebrew_label,
            entity_type=entity_type,
            is_system=True,
        )
        db.add(definition)
        db.flush()
    existing = (
        db.query(models.PicklistLink)
        .filter(
            models.PicklistLink.entity_table == entity_table,
            models.PicklistLink.entity_id == entity_id,
            models.PicklistLink.picklist_definition_id == definition.id,
        )
        .first()
    )

    if value is None:
        if existing is not None:
            db.delete(existing)
        return

    picklist_value = (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == organization_id,
            models.PicklistValue.field_key == field_key,
            models.PicklistValue.value == value,
        )
        .first()
    )
    if picklist_value is None:
        # Reaching here means validate_picklist_value found zero *active*
        # options for this field (an open field like apartment.campaign_status,
        # or an unprovisioned org) — inactive by default so this ad-hoc value
        # doesn't itself become the field's only allowed option and start
        # rejecting every other free-text value from then on. An admin can
        # still find and activate it later from the Picklists dashboard.
        picklist_value = models.PicklistValue(
            organization_id=organization_id,
            field_key=field_key,
            value=value,
            hebrew_label=value,
            is_active=False,
        )
        db.add(picklist_value)
        db.flush()

    if existing is not None:
        existing.picklist_value_id = picklist_value.id
    else:
        db.add(
            models.PicklistLink(
                organization_id=organization_id,
                entity_table=entity_table,
                entity_id=entity_id,
                picklist_definition_id=definition.id,
                picklist_value_id=picklist_value.id,
            )
        )


def copy_links(db: Session, entity_table: str, from_entity_id: int, to_entity_id: int) -> None:
    """Copy every picklist link from one entity row onto another. Apartment
    versioning support: each edit retires the row and inserts a new one with a
    new id — copying (not moving) the links means the retired row keeps its
    own historical values while the new row starts with the same ones."""
    rows = (
        db.query(models.PicklistLink)
        .filter(
            models.PicklistLink.entity_table == entity_table,
            models.PicklistLink.entity_id == from_entity_id,
        )
        .all()
    )
    for row in rows:
        db.add(
            models.PicklistLink(
                organization_id=row.organization_id,
                entity_table=entity_table,
                entity_id=to_entity_id,
                picklist_definition_id=row.picklist_definition_id,
                picklist_value_id=row.picklist_value_id,
            )
        )
    if rows:
        # The app's Session runs with autoflush=False — a caller that follows
        # this with set_value() for one of the same fields (an apartment edit
        # that both copies history forward and changes a field) needs these
        # rows visible to that lookup, not just pending.
        db.flush()


def delete_links(db: Session, entity_table: str, entity_id: int) -> None:
    """Clean up picklist links when an entity row is hard-deleted (there's no
    DB-level cascade possible since entity_id isn't a real FK — it's
    polymorphic across several parent tables)."""
    db.query(models.PicklistLink).filter(
        models.PicklistLink.entity_table == entity_table,
        models.PicklistLink.entity_id == entity_id,
    ).delete(synchronize_session=False)


def delete_links_many(db: Session, entity_table: str, entity_ids: list[int]) -> None:
    if not entity_ids:
        return
    db.query(models.PicklistLink).filter(
        models.PicklistLink.entity_table == entity_table,
        models.PicklistLink.entity_id.in_(entity_ids),
    ).delete(synchronize_session=False)
