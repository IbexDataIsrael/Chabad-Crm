"""Picklist (lookup option) management, scoped to the caller's organization.

Reads: any authenticated user in the org. Mutations: admins only (`require_admin`).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.picklist_utils import count_definition_usage, count_usage
from app.schemas import (
    PicklistDefinitionCreate,
    PicklistDefinitionUpdate,
    PicklistFieldOut,
    PicklistReorder,
    PicklistValueCreate,
    PicklistValueOut,
    PicklistValueUpdate,
    UsageOut,
)

router = APIRouter(prefix="/api/picklists", tags=["picklists"])


def _definitions_query(db: Session, org_id: int):
    return (
        db.query(models.PicklistDefinition)
        .filter(models.PicklistDefinition.organization_id == org_id)
        .order_by(
            models.PicklistDefinition.sort_order, models.PicklistDefinition.id
        )
    )


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
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """The org's registry of managed picklists (DB-driven definitions), so admins
    can edit every one — system and custom alike."""
    return [
        PicklistFieldOut(
            id=d.id,
            field_key=d.system_name,
            label=d.hebrew_display_name,
            english_label=d.english_display_name,
            is_system=d.is_system,
            entity_type=d.entity_type,
            sort_order=d.sort_order or None,
        )
        for d in _definitions_query(db, current_user.organization_id).all()
    ]


# --- Definition management (admin) -----------------------------------------
# Declared before the value routes so the static "definition" segment isn't
# parsed as a {field_key} / {picklist_id}.
@router.post("/definition", response_model=PicklistFieldOut, status_code=status.HTTP_201_CREATED)
def create_definition(
    payload: PicklistDefinitionCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    dup = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.system_name == payload.system_name,
        )
        .first()
    )
    if dup:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"picklist '{payload.system_name}' already exists",
        )
    last = _definitions_query(db, org_id).all()
    # fixes37: shliach.* is a real sub-namespace of "contact_mekurav" (fixes35
    # §5 — admin-added custom picklists scoped to shliach-type contacts only).
    # The admin Picklists page's "contacts" tab has no separate UI section
    # for it — an admin opts in purely by naming the field "shliach.xxx",
    # exactly like field_registry.py's identical check for CustomFieldDefinition.
    entity_type = payload.entity_type
    if entity_type == "contact_mekurav" and payload.system_name.startswith("shliach."):
        entity_type = "contact_shliach"
    row = models.PicklistDefinition(
        organization_id=org_id,
        system_name=payload.system_name,
        hebrew_display_name=payload.hebrew_display_name,
        english_display_name=payload.english_display_name,
        entity_type=entity_type,
        is_system=False,  # admin-created lists are not system lists
        sort_order=(last[-1].sort_order + 1) if last else 0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return PicklistFieldOut(
        id=row.id,
        field_key=row.system_name,
        label=row.hebrew_display_name,
        english_label=row.english_display_name,
        is_system=row.is_system,
        entity_type=row.entity_type,
        sort_order=row.sort_order or None,
    )


@router.put("/definition/{def_id}", response_model=PicklistFieldOut)
def update_definition(
    def_id: int,
    payload: PicklistDefinitionUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.id == def_id,
            models.PicklistDefinition.organization_id == admin.organization_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Picklist definition not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return PicklistFieldOut(
        id=row.id,
        field_key=row.system_name,
        label=row.hebrew_display_name,
        english_label=row.english_display_name,
        is_system=row.is_system,
        entity_type=row.entity_type,
        sort_order=row.sort_order or None,
    )


def _get_definition_or_404(
    def_id: int, org_id: int, db: Session
) -> models.PicklistDefinition:
    row = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.id == def_id,
            models.PicklistDefinition.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Picklist definition not found")
    return row


@router.get("/definition/{def_id}/usage", response_model=UsageOut)
def definition_usage(
    def_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes48 §1: how many records currently hold any value under this
    whole list — drives the "dependent data" confirmation before a delete
    purges it."""
    row = _get_definition_or_404(def_id, admin.organization_id, db)
    return UsageOut(count=count_definition_usage(db, row.id))


@router.delete("/definition/{def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_definition(
    def_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = _get_definition_or_404(def_id, admin.organization_id, db)
    if row.is_system:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "System picklists cannot be deleted"
        )
    # fixes32: drop every record's link to this field before the values it
    # points at — picklist_value_id is a real FK now, no orphaned links.
    db.query(models.PicklistLink).filter(
        models.PicklistLink.organization_id == admin.organization_id,
        models.PicklistLink.picklist_definition_id == row.id,
    ).delete(synchronize_session=False)
    db.query(models.PicklistValue).filter(
        models.PicklistValue.organization_id == admin.organization_id,
        models.PicklistValue.field_key == row.system_name,
    ).delete(synchronize_session=False)
    db.delete(row)
    db.commit()


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


@router.get("/{picklist_id}/usage", response_model=UsageOut)
def value_usage(
    picklist_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes48 §1: how many records currently hold this value — drives the
    "dependent data" confirmation before a hard delete purges it."""
    org_id = admin.organization_id
    row = _get_or_404(picklist_id, org_id, db)
    return UsageOut(count=count_usage(db, org_id, row.field_key, row.value))


@router.delete("/{picklist_id}", response_model=PicklistValueOut)
def delete_option(
    picklist_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
    hard: bool = False,
):
    """Soft-delete (is_active=false) by default; `hard=true` permanently
    removes it AND purges every record that currently points at it (fixes48
    §1 — previously blocked with a 409 instead of asking, so a hard delete
    never actually purged in-use data)."""
    org_id = admin.organization_id
    row = _get_or_404(picklist_id, org_id, db)
    if hard:
        db.query(models.PicklistLink).filter(
            models.PicklistLink.organization_id == org_id,
            models.PicklistLink.picklist_value_id == row.id,
        ).delete(synchronize_session=False)
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
