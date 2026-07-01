"""Per-organization field visibility settings.

Admins choose which built-in contact fields appear in the CRM (form / view /
list). Reads are open to any authenticated member (the UI needs them to render);
only admins can change a setting. Absence of a row means the field is visible.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.field_registry import TOGGLEABLE_FIELDS, TOGGLEABLE_KEYS, label_and_entity

router = APIRouter(prefix="/api/field-settings", tags=["field-settings"])


class FieldSettingOut(BaseModel):
    field_key: str
    label_key: str
    entity: str
    is_visible: bool


class FieldSettingUpdate(BaseModel):
    field_key: str
    is_visible: bool


@router.get("", response_model=list[FieldSettingOut])
def list_field_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """The full toggleable registry with each field's visibility for this org."""
    saved = {
        r.field_key: r.is_visible
        for r in db.query(models.FieldSetting)
        .filter(models.FieldSetting.organization_id == current_user.organization_id)
        .all()
    }
    return [
        FieldSettingOut(
            field_key=fk, label_key=lk, entity=ent, is_visible=saved.get(fk, True)
        )
        for fk, lk, ent in TOGGLEABLE_FIELDS
    ]


@router.put("", response_model=FieldSettingOut)
def set_field_setting(
    payload: FieldSettingUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Show/hide a single field (admin only). Upserts the org's row."""
    if payload.field_key not in TOGGLEABLE_KEYS:
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

    label_key, entity = label_and_entity(payload.field_key)
    return FieldSettingOut(
        field_key=payload.field_key,
        label_key=label_key,
        entity=entity,
        is_visible=payload.is_visible,
    )
