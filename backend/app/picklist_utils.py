"""Helpers tying constrained columns to their (per-organization) picklists."""
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import models

# The full set of admin-managed picklists, with Hebrew display labels. Admins can
# manage every one of these even before any options exist for their org.
PICKLIST_FIELDS: dict[str, str] = {
    "contact.contact_type": "סוג איש קשר",
    "contact.pipeline_status": "סטטוס",
    "contact.color_tag": "צבע",
    "contact.potential_next_step": "פוטנציאל לצעד",
    "checklist.torah_thought": "דבר תורה",
    "interaction.category": "קטגוריה",
    "visit.type": "סוג ביקור",
    "significant_date.type": "סוג תאריך",
    # fixes4: significant_date.title is now free text (removed from the registry).
    "Jewish_status": "יהדות",
    "affiliation": "השתייכות דתית",
    "language": "שפה",
}

# field_key -> (model, column attribute name) for validation + usage counting.
# Pre-existing *system* picklists are backed by real columns. Dynamic picklists
# (e.g. Jewish_status, affiliation, language, and any admin-created list) are NOT
# here — their values live in `contact_picklist_values`; count_usage handles those.
FIELD_KEY_TO_COLUMN: dict[str, tuple[type, str]] = {
    "contact.contact_type": (models.Contact, "contact_type"),
    "contact.pipeline_status": (models.Contact, "pipeline_status"),
    "contact.color_tag": (models.Contact, "color_tag"),
    "contact.potential_next_step": (models.ContactMekurav, "potential_next_step"),
    "checklist.torah_thought": (models.CommunityChecklist, "torah_thought"),
    "interaction.category": (models.Interaction, "category"),
    "visit.type": (models.VisitHistory, "visit_type"),
    "significant_date.type": (models.SignificantDate, "special_date_type"),
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

    No-op when value is None, or when the org has no active options for the field.
    """
    if value is None:
        return
    options = active_values(db, organization_id, field_key)
    if options and value not in options:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{value}' is not an allowed value for {field_key}",
        )


def count_usage(
    db: Session, organization_id: int, field_key: str, value: str
) -> int:
    """How many of the org's records currently store `value` for `field_key`."""
    mapping = FIELD_KEY_TO_COLUMN.get(field_key)
    if mapping is None:
        # Dynamic picklist: values live in contact_picklist_values, keyed by the
        # picklist definition whose system_name == field_key.
        return (
            db.query(models.ContactPicklistValue)
            .join(
                models.PicklistDefinition,
                models.PicklistDefinition.id == models.ContactPicklistValue.picklist_id,
            )
            .filter(
                models.ContactPicklistValue.organization_id == organization_id,
                models.ContactPicklistValue.value == value,
                models.PicklistDefinition.system_name == field_key,
            )
            .count()
        )
    model, attr = mapping
    query = db.query(model).filter(getattr(model, attr) == value)
    if hasattr(model, "organization_id"):
        query = query.filter(model.organization_id == organization_id)
    else:
        # Checklist is scoped via its contact.
        query = query.join(
            models.Contact, models.Contact.id == models.CommunityChecklist.contact_id
        ).filter(models.Contact.organization_id == organization_id)
    return query.count()
