"""Picklist (lookup option) management, scoped to the caller's organization.

Reads: any authenticated user in the org. Mutations: admins only (`require_admin`).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.picklist_utils import PICKLIST_FIELDS, count_usage
from app.schemas import (
    PicklistFieldOut,
    PicklistReorder,
    PicklistValueCreate,
    PicklistValueOut,
    PicklistValueUpdate,
)

router = APIRouter(prefix="/api/picklists", tags=["picklists"])


def _get_or_404(picklist_id: int, org_id: int, db: Session) -> models.PicklistValue:
    row = (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.id == picklist_id,
            models.PicklistValue.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Picklist value not found")
    return row


# --- Reads (any authenticated user) ----------------------------------------
@router.get("", response_model=list[PicklistFieldOut])
def list_field_keys(
    _current_user: models.User = Depends(get_current_user),
):
    """The full registry of managed picklists, so admins can edit every one
    (even those with no options yet for their org)."""
    return [
        PicklistFieldOut(field_key=key, label=label)
        for key, label in PICKLIST_FIELDS.items()
    ]


@router.get("/{field_key}", response_model=list[PicklistValueOut])
def get_options(
    field_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    include_inactive: bool = False,
):
    query = db.query(models.PicklistValue).filter(
        models.PicklistValue.organization_id == current_user.organization_id,
        models.PicklistValue.field_key == field_key,
    )
    if not include_inactive:
        query = query.filter(models.PicklistValue.is_active.is_(True))
    return query.order_by(
        models.PicklistValue.sort_order, models.PicklistValue.id
    ).all()


# --- Mutations (admin only) ------------------------------------------------
@router.post(
    "/{field_key}",
    response_model=PicklistValueOut,
    status_code=status.HTTP_201_CREATED,
)
def add_option(
    field_key: str,
    payload: PicklistValueCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    dup = (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == field_key,
            models.PicklistValue.value == payload.value,
        )
        .first()
    )
    if dup:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"value '{payload.value}' already exists for {field_key}",
        )
    row = models.PicklistValue(
        organization_id=org_id, field_key=field_key, **payload.model_dump()
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{picklist_id}", response_model=PicklistValueOut)
def update_option(
    picklist_id: int,
    payload: PicklistValueUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    row = _get_or_404(picklist_id, org_id, db)
    data = payload.model_dump(exclude_unset=True)
    new_value = data.get("value")
    if new_value is not None and new_value != row.value:
        dup = (
            db.query(models.PicklistValue)
            .filter(
                models.PicklistValue.organization_id == org_id,
                models.PicklistValue.field_key == row.field_key,
                models.PicklistValue.value == new_value,
                models.PicklistValue.id != picklist_id,
            )
            .first()
        )
        if dup:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"value '{new_value}' already exists for {row.field_key}",
            )
    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{picklist_id}", response_model=PicklistValueOut)
def delete_option(
    picklist_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
    hard: bool = False,
):
    org_id = admin.organization_id
    row = _get_or_404(picklist_id, org_id, db)
    if hard:
        used = count_usage(db, org_id, row.field_key, row.value)
        if used:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"value '{row.value}' is in use by {used} record(s); cannot hard-delete",
            )
        db.delete(row)
        db.commit()
        return row
    row.is_active = False
    db.commit()
    db.refresh(row)
    return row


@router.put("/{field_key}/reorder", response_model=list[PicklistValueOut])
def reorder_options(
    field_key: str,
    payload: PicklistReorder,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    rows = {
        r.id: r
        for r in db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == field_key,
        )
        .all()
    }
    for index, picklist_id in enumerate(payload.ordered_ids):
        row = rows.get(picklist_id)
        if row is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"id {picklist_id} does not belong to {field_key}",
            )
        row.sort_order = index
    db.commit()
    return (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == field_key,
        )
        .order_by(models.PicklistValue.sort_order, models.PicklistValue.id)
        .all()
    )
