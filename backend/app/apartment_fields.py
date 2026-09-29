"""Apartment field catalog shared by the per-campaign field-visibility
feature (fixes71 §B) — the same three-way merge (fixed registry fields +
custom picklists + custom fields) that street.tsx's own "extra fields"
section and shliach-config's Edit Lock list each already do inline;
factored out once here, apartment-scoped, for campaigns.py to reuse.
"""
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.field_registry import TOGGLEABLE_FIELDS

# fixes71 §C.3: to_knock must never be a display/visibility candidate at all
# — excluded here so it can't even be listed on a campaign's field-visibility
# admin screen, let alone toggled visible.
EXCLUDED_APARTMENT_FIELD_KEYS = {"customfield.apartment.to_knock"}


@dataclass
class ApartmentFieldMeta:
    field_key: str
    label_key: str
    entity: str
    label: Optional[str] = None
    english_label: Optional[str] = None


def list_apartment_field_keys(db: Session, org_id: int) -> list[ApartmentFieldMeta]:
    """Every apartment field an admin can configure visibility for: the fixed
    registry fields, the org's custom (non-system) apartment picklists, and
    its active non-select apartment custom fields — minus
    EXCLUDED_APARTMENT_FIELD_KEYS."""
    out = [
        ApartmentFieldMeta(field_key=fk, label_key=lk, entity=ent)
        for fk, lk, ent in TOGGLEABLE_FIELDS
        if ent == "apartment"
    ]
    picklist_defs = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.entity_type == "apartment",
            models.PicklistDefinition.is_system.is_(False),
        )
        .order_by(models.PicklistDefinition.sort_order, models.PicklistDefinition.id)
        .all()
    )
    out.extend(
        ApartmentFieldMeta(
            field_key=d.system_name,
            label_key=f"picklist_def.{d.system_name}",
            entity="apartment",
            label=d.hebrew_display_name,
            english_label=d.english_display_name,
        )
        for d in picklist_defs
    )
    custom_field_defs = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.is_active.is_(True),
            models.CustomFieldDefinition.field_type != "select",
        )
        .order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id)
        .all()
    )
    out.extend(
        ApartmentFieldMeta(
            field_key=f"customfield.apartment.{d.field_key}",
            label_key=f"custom_field.apartment.{d.field_key}",
            entity="apartment",
            label=d.hebrew_label,
            english_label=d.english_label,
        )
        for d in custom_field_defs
    )
    return [f for f in out if f.field_key not in EXCLUDED_APARTMENT_FIELD_KEYS]
