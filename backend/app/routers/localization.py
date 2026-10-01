"""Admin editing of UI localization strings (he/en).

Reads of the resolved labels are public via `/api/metadata/localization`. These
management endpoints are admin-only. `field_localization` is global (shared across
tenants), so edits affect every organization on the deployment.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import require_admin
from app.schemas import LocalizationCreate, LocalizationOut, LocalizationUpdate
from app.core.errors import api_error

router = APIRouter(prefix="/api/localization", tags=["localization"])


@router.get("", response_model=list[LocalizationOut])
def list_strings(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    return (
        db.query(models.FieldLocalization)
        .order_by(models.FieldLocalization.entity_type, models.FieldLocalization.technical_name)
        .all()
    )


@router.post("", response_model=LocalizationOut, status_code=status.HTTP_201_CREATED)
def create_string(
    payload: LocalizationCreate,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    if (
        db.query(models.FieldLocalization)
        .filter(models.FieldLocalization.technical_name == payload.technical_name)
        .first()
    ):
        raise api_error(
            status.HTTP_400_BAD_REQUEST, "error.technical_name_exists",
            "technical_name '{name}' already exists", name=payload.technical_name,
        )
    row = models.FieldLocalization(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{string_id}", response_model=LocalizationOut)
def update_string(
    string_id: int,
    payload: LocalizationUpdate,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(require_admin),
):
    row = db.get(models.FieldLocalization, string_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Localization string not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row
