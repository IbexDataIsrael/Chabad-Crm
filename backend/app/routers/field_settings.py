"""Per-organization field visibility settings.

Admins choose which built-in contact fields appear in the CRM (form / view /
list). Reads are open to any authenticated member (the UI needs them to render);
only admins can change a setting. Absence of a row means the field is visible.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.field_registry import (
    TOGGLEABLE_FIELDS,
    TOGGLEABLE_KEYS,
    default_visible,
    label_and_entity,
    picklist_entity,
)

router = APIRouter(prefix="/api/field-settings", tags=["field-settings"])


class FieldSettingOut(BaseModel):
    field_key: str
    label_key: str
    entity: str
    is_visible: bool
    # fixes33 §5.1: set only for a dynamic (admin-added custom picklist) row —
    # its own bilingual display name, carried directly since there's no
    # field_localization row for per-org custom picklist names.
    label: Optional[str] = None
    english_label: Optional[str] = None


class FieldSettingUpdate(BaseModel):
    field_key: str
    is_visible: bool


def _custom_picklist_keys(db: Session, org_id: int) -> set[str]:
    """fixes33 §5.1: system_names of the org's admin-added (non-system)
    picklist definitions — these get a dynamic field-settings row too."""
    return {
        r.system_name
        for r in db.query(models.PicklistDefinition.system_name)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.is_system.is_(False),
        )
        .all()
    }


# fixes35 §3: a custom field's field_key is only unique per (org, entity_type)
# — this prefix keeps two custom fields in different entities that happen to
# share a literal field_key from clobbering each other's field_settings row.
def custom_field_setting_key(entity_type: str, field_key: str) -> str:
    return f"customfield.{entity_type}.{field_key}"


def _parse_custom_field_setting_key(field_key: str) -> Optional[tuple[str, str]]:
    """Reverse of `custom_field_setting_key` — (entity_type, field_key), or
    None if `field_key` isn't shaped like one."""
    prefix = "customfield."
    if not field_key.startswith(prefix):
        return None
    rest = field_key[len(prefix):]
    entity_type, sep, key = rest.partition(".")
    return (entity_type, key) if sep else None


def _custom_field_defs(db: Session, org_id: int):
    """fixes35 §3: the org's active, non-select CustomFieldDefinition rows —
    select-type ones are covered by `_custom_picklist_keys` instead (their
    visibility rides the linked PicklistDefinition, like any other picklist)."""
    return (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.is_active.is_(True),
            models.CustomFieldDefinition.field_type != "select",
        )
        .order_by(
            models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id
        )
        .all()
    )


@router.get("", response_model=list[FieldSettingOut])
def list_field_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """The full toggleable registry with each field's visibility for this org —
    the static built-in registry plus a dynamic row per admin-added custom
    picklist (fixes33 §5.1), so those can be hidden too."""
    org_id = current_user.organization_id
    saved = {
        r.field_key: r.is_visible
        for r in db.query(models.FieldSetting)
        .filter(models.FieldSetting.organization_id == org_id)
        .all()
    }
    out = [
        FieldSettingOut(
            field_key=fk,
            label_key=lk,
            entity=ent,
            is_visible=saved.get(fk, default_visible(fk)),
        )
        for fk, lk, ent in TOGGLEABLE_FIELDS
    ]
    custom_defs = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.is_system.is_(False),
        )
        .order_by(models.PicklistDefinition.sort_order, models.PicklistDefinition.id)
        .all()
    )
    out.extend(
        FieldSettingOut(
            field_key=d.system_name,
            label_key=f"picklist_def.{d.system_name}",
            entity=picklist_entity(d.system_name),
            is_visible=saved.get(d.system_name, True),
            label=d.hebrew_display_name,
            english_label=d.english_display_name,
        )
        for d in custom_defs
    )
    # fixes35 §3: same generalization for non-select CustomFieldDefinition
    # rows — entity comes straight from the definition's own entity_type
    # column (no prefix-sniffing needed, unlike picklists).
    out.extend(
        FieldSettingOut(
            field_key=custom_field_setting_key(d.entity_type, d.field_key),
            label_key=f"custom_field.{d.entity_type}.{d.field_key}",
            entity=d.entity_type,
            is_visible=saved.get(custom_field_setting_key(d.entity_type, d.field_key), True),
            label=d.hebrew_label,
            english_label=d.english_label,
        )
        for d in _custom_field_defs(db, org_id)
    )
    return out


@router.put("", response_model=FieldSettingOut)
def set_field_setting(
    payload: FieldSettingUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Show/hide a single field (admin only). Upserts the org's row."""
    parsed_custom_field = _parse_custom_field_setting_key(payload.field_key)
    custom_field_definition = None
    if parsed_custom_field is not None:
        entity_type, field_key = parsed_custom_field
        custom_field_definition = (
            db.query(models.CustomFieldDefinition)
            .filter(
                models.CustomFieldDefinition.organization_id == admin.organization_id,
                models.CustomFieldDefinition.entity_type == entity_type,
                models.CustomFieldDefinition.field_key == field_key,
                models.CustomFieldDefinition.field_type != "select",
            )
            .first()
        )
    if (
        payload.field_key not in TOGGLEABLE_KEYS
        and payload.field_key not in _custom_picklist_keys(db, admin.organization_id)
        and custom_field_definition is None
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown field_key '{payload.field_key}'"
        )
    row = (
        db.query(models.FieldSetting)
        .filter(
            models.FieldSetting.organization_id == admin.organization_id,
            models.FieldSetting.field_key == payload.field_key,
        )
        .first()
    )
    if row is None:
        row = models.FieldSetting(
            organization_id=admin.organization_id,
            field_key=payload.field_key,
            is_visible=payload.is_visible,
        )
        db.add(row)
    else:
        row.is_visible = payload.is_visible
    db.commit()

    if payload.field_key in TOGGLEABLE_KEYS:
        label_key, entity = label_and_entity(payload.field_key)
        return FieldSettingOut(
            field_key=payload.field_key,
            label_key=label_key,
            entity=entity,
            is_visible=payload.is_visible,
        )
    if custom_field_definition is not None:
        # fixes35 §3: a dynamic (non-select) custom-field field_key.
        return FieldSettingOut(
            field_key=payload.field_key,
            label_key=f"custom_field.{custom_field_definition.entity_type}.{custom_field_definition.field_key}",
            entity=custom_field_definition.entity_type,
            is_visible=payload.is_visible,
            label=custom_field_definition.hebrew_label,
            english_label=custom_field_definition.english_label,
        )
    # fixes33 §5.1: a dynamic custom-picklist field_key — resolve its own
    # bilingual display name the same way the GET list does.
    definition = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == admin.organization_id,
            models.PicklistDefinition.system_name == payload.field_key,
        )
        .first()
    )
    return FieldSettingOut(
        field_key=payload.field_key,
        label_key=f"picklist_def.{payload.field_key}",
        entity=picklist_entity(payload.field_key),
        is_visible=payload.is_visible,
        label=definition.hebrew_display_name if definition else None,
        english_label=definition.english_display_name if definition else None,
    )
