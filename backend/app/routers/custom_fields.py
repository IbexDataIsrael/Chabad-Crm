"""Per-organization custom field definitions (fixes35: any entity_type x
field_type — originally visit-only boolean+note, generalized in place).

Reads for any member; create/edit/delete for admins.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import custom_field_utils, models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    CustomFieldDefinitionCreate,
    CustomFieldDefinitionOut,
    CustomFieldDefinitionUpdate,
)

router = APIRouter(prefix="/api/custom-fields", tags=["custom-fields"])

_VALID_ENTITY_TYPES = {"contact_mekurav", "contact_shliach", "visit", "apartment"}
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
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown entity_type '{payload.entity_type}'"
        )
    if payload.field_type not in _VALID_FIELD_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"unknown field_type '{payload.field_type}'"
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
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"field_key '{payload.field_key}' already exists for {payload.entity_type}",
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
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"picklist '{system_name}' already exists",
            )
        picklist_def = models.PicklistDefinition(
            organization_id=org_id,
            system_name=system_name,
            hebrew_display_name=payload.hebrew_label,
            english_display_name=payload.english_label,
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


@router.delete("/{def_id}", response_model=CustomFieldDefinitionOut)
def delete_definition(
    def_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
    hard: bool = False,
):
    """Soft-delete (is_active=false) by default; `hard=true` removes it and its values."""
    row = _get_or_404(def_id, admin.organization_id, db)
    if hard:
        db.delete(row)
        db.commit()
        return row
    row.is_active = False
    db.commit()
    db.refresh(row)
    return row
