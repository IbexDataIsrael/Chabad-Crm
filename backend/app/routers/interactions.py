"""Interaction (historical log) endpoints, scoped to the caller's organization."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user
from app.picklist_utils import validate_picklist_value
from app.schemas import InteractionCreate, InteractionOut, InteractionUpdate

router = APIRouter(prefix="/api/interactions", tags=["interactions"])


@router.get("", response_model=list[InteractionOut])
def list_interactions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    contact_id: Optional[int] = None,
):
    query = db.query(models.Interaction).filter(
        models.Interaction.organization_id == current_user.organization_id
    )
    if contact_id is not None:
        query = query.filter(models.Interaction.contact_id == contact_id)
    return query.order_by(
        models.Interaction.created_at.desc(), models.Interaction.id.desc()
    ).all()


@router.post("", response_model=InteractionOut, status_code=status.HTTP_201_CREATED)
def create_interaction(
    payload: InteractionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == payload.contact_id,
            models.Contact.organization_id == org_id,
        )
        .first()
    )
    if not contact:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "contact_id does not exist")
    validate_picklist_value(db, org_id, "interaction.category", payload.category)
    interaction = models.Interaction(
        organization_id=org_id,
        contact_id=payload.contact_id,
        category=payload.category,
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(interaction)
    db.commit()
    db.refresh(interaction)
    return interaction


def _get_interaction_or_404(interaction_id: int, org_id: int, db: Session) -> models.Interaction:
    interaction = (
        db.query(models.Interaction)
        .filter(
            models.Interaction.id == interaction_id,
            models.Interaction.organization_id == org_id,
        )
        .first()
    )
    if not interaction:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interaction not found")
    return interaction


@router.put("/{interaction_id}", response_model=InteractionOut)
def update_interaction(
    interaction_id: int,
    payload: InteractionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    interaction = _get_interaction_or_404(interaction_id, org_id, db)
    data = payload.model_dump(exclude_unset=True)
    if "category" in data:
        validate_picklist_value(db, org_id, "interaction.category", data["category"])
    for field, value in data.items():
        setattr(interaction, field, value)
    db.commit()
    db.refresh(interaction)
    return interaction


@router.delete("/{interaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interaction(
    interaction_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    interaction = (
        db.query(models.Interaction)
        .filter(
            models.Interaction.id == interaction_id,
            models.Interaction.organization_id == current_user.organization_id,
        )
        .first()
    )
    if not interaction:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interaction not found")
    db.delete(interaction)
    db.commit()
