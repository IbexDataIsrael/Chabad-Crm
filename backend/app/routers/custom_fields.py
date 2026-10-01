"""Per-organization custom field definitions (fixes35: any entity_type x
field_type — originally visit-only boolean+note, generalized in place).

Reads for any member; create/edit/delete for admins.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import custom_field_utils, models, picklist_utils
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    CustomFieldDefinitionCreate,
    CustomFieldDefinitionOut,
    CustomFieldDefinitionUpdate,
    UsageOut,
)
from app.core.errors import api_error

router = APIRouter(prefix="/api/custom-fields", tags=["custom-fields"])

_VALID_ENTITY_TYPES = {"contact_mekurav", "contact_shliach", "visit", "apartment", "task"}
_VALID_FIELD_TYPES = {"text", "number", "boolean", "date", "select"}


def _get_or_404(def_id: int, org_id: int, db: Session) -> models.CustomFieldDefinition:
    row = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.id == def_id,
            models.CustomFieldDefinition.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Custom field not found")
    return row


@router.get("", response_model=list[CustomFieldDefinitionOut])
def list_definitions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    include_inactive: bool = False,
    entity_type: str | None = None,
):
    query = db.query(models.CustomFieldDefinition).filter(
        models.CustomFieldDefinition.organization_id == current_user.organization_id
    )
    if not include_inactive:
        query = query.filter(models.CustomFieldDefinition.is_active.is_(True))
    if entity_type is not None:
        query = query.filter(models.CustomFieldDefinition.entity_type == entity_type)
    return query.order_by(
        models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id
    ).all()


@router.post("", response_model=CustomFieldDefinitionOut, status_code=status.HTTP_201_CREATED)
def create_definition(
    payload: CustomFieldDefinitionCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    if payload.entity_type not in _VALID_ENTITY_TYPES:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "error.unknown_entity_type",
            "unknown entity_type '{value}'", value=payload.entity_type,
        )
    if payload.field_type not in _VALID_FIELD_TYPES:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "error.unknown_field_type",
            "unknown field_type '{value}'", value=payload.field_type,
        )
    dup = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == payload.entity_type,
            models.CustomFieldDefinition.field_key == payload.field_key,
        )
        .first()
    )
    if dup:
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "error.field_key_exists",
            "field_key '{field}' already exists for {entity}",
            field=payload.field_key, entity=payload.entity_type,
        )

    data = payload.model_dump(exclude={"picklist_options"})
    row = models.CustomFieldDefinition(organization_id=org_id, **data)
    db.add(row)
    db.flush()

    if payload.field_type == "select":
        # fixes35 §5: a select-type custom field's options/values live
        # entirely in the existing picklist tables — never in
        # CustomFieldValue. Provision the PicklistDefinition (+ its initial
        # options) the same way routers/picklists.py's own create_definition
        # does, under the derived system_name convention.
        system_name = custom_field_utils.select_system_name(
            payload.entity_type, payload.field_key
        )
        dup_picklist = (
            db.query(models.PicklistDefinition)
            .filter(
                models.PicklistDefinition.organization_id == org_id,
                models.PicklistDefinition.system_name == system_name,
            )
            .first()
        )
        if dup_picklist:
            raise api_error(
                status.HTTP_400_BAD_REQUEST, "error.picklist_exists",
                "picklist '{name}' already exists", name=system_name,
            )
        picklist_def = models.PicklistDefinition(
            organization_id=org_id,
            system_name=system_name,
            hebrew_display_name=payload.hebrew_label,
            english_display_name=payload.english_label,
            # fixes37: CustomFieldDefinition.entity_type already uses the
            # exact same vocabulary as PicklistDefinition.entity_type — pass
            # it straight through instead of leaving it to the model default.
            entity_type=payload.entity_type,
            is_system=False,
        )
        db.add(picklist_def)
        db.flush()
        for i, option in enumerate(payload.picklist_options or []):
            db.add(
                models.PicklistValue(
                    organization_id=org_id,
                    field_key=system_name,
                    value=option,
                    hebrew_label=option,
                    sort_order=i,
                )
            )

    db.commit()
    db.refresh(row)
    return row


@router.put("/{def_id}", response_model=CustomFieldDefinitionOut)
def update_definition(
    def_id: int,
    payload: CustomFieldDefinitionUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = _get_or_404(def_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


def _select_picklist_def(
    row: models.CustomFieldDefinition, org_id: int, db: Session
) -> Optional[models.PicklistDefinition]:
    """The auto-provisioned PicklistDefinition backing a select-type custom
    field (see create_definition) — None if it was never created."""
    if row.field_type != "select":
        return None
    system_name = custom_field_utils.select_system_name(row.entity_type, row.field_key)
    return (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.system_name == system_name,
        )
        .first()
    )


@router.get("/{def_id}/usage", response_model=UsageOut)
def definition_usage(
    def_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes48 §1: how many records currently hold a value for this
    definition — drives the "dependent data" confirmation before a hard
    delete purges it."""
    row = _get_or_404(def_id, admin.organization_id, db)
    picklist_def = _select_picklist_def(row, admin.organization_id, db)
    if picklist_def:
        count = picklist_utils.count_definition_usage(db, picklist_def.id)
    else:
        count = custom_field_utils.count_values(db, row.id)
    return UsageOut(count=count)


@router.delete("/{def_id}", response_model=CustomFieldDefinitionOut)
def delete_definition(
    def_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
    hard: bool = False,
):
    """Soft-delete (is_active=false) by default; `hard=true` permanently
    removes it AND purges every dependent value (fixes48 §1 — previously left
    orphaned CustomFieldValue rows, or for a select-type field, an orphaned
    PicklistDefinition/Value/Link trio entirely untouched)."""
    row = _get_or_404(def_id, admin.organization_id, db)
    if hard:
        picklist_def = _select_picklist_def(row, admin.organization_id, db)
        if picklist_def:
            db.query(models.PicklistLink).filter(
                models.PicklistLink.organization_id == admin.organization_id,
                models.PicklistLink.picklist_definition_id == picklist_def.id,
            ).delete(synchronize_session=False)
            db.query(models.PicklistValue).filter(
                models.PicklistValue.organization_id == admin.organization_id,
                models.PicklistValue.field_key == picklist_def.system_name,
            ).delete(synchronize_session=False)
            db.delete(picklist_def)
        else:
            custom_field_utils.delete_values_by_definition(db, row.id)
        db.delete(row)
        db.commit()
        return row
    row.is_active = False
    db.commit()
    db.refresh(row)
    return row
