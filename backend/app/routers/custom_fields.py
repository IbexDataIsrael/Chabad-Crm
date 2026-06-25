"""Per-organization custom checklist field definitions (boolean + note).

Reads for any member; create/edit/delete for admins.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    CustomFieldDefinitionCreate,
    CustomFieldDefinitionOut,
    CustomFieldDefinitionUpdate,
)

router = APIRouter(prefix="/api/custom-fields", tags=["custom-fields"])


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
):
    query = db.query(models.CustomFieldDefinition).filter(
        models.CustomFieldDefinition.organization_id == current_user.organization_id
    )
    if not include_inactive:
        query = query.filter(models.CustomFieldDefinition.is_active.is_(True))
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
    dup = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.field_key == payload.field_key,
        )
        .first()
    )
    if dup:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"field_key '{payload.field_key}' already exists",
        )
    row = models.CustomFieldDefinition(organization_id=org_id, **payload.model_dump())
    db.add(row)
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
