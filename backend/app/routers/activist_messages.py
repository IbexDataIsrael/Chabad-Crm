"""fixes98: "messages for activists" (admin CRUD, shliach-config tab) and the
per-org numbers they quote (admin edit + recalculate, settings tab), plus the
activist app's read-only feed of both.

Messages are stored with their {placeholders}; the activist's device fills
them from the stats row (see core/activist_messages.py).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.core.activist_messages import apply_computed, ensure_stats
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    ActivistMessageCreate,
    ActivistMessageOut,
    ActivistMessagesFeed,
    ActivistMessageUpdate,
    OrgActivistStatsOut,
    OrgActivistStatsUpdate,
)

router = APIRouter(prefix="/api/activist-messages", tags=["activist-messages"])


def _messages(db: Session, org_id: int) -> list[models.ActivistMessage]:
    return (
        db.query(models.ActivistMessage)
        .filter(models.ActivistMessage.organization_id == org_id)
        .order_by(models.ActivistMessage.sort_order, models.ActivistMessage.id)
        .all()
    )


def _get_or_404(db: Session, org_id: int, message_id: int) -> models.ActivistMessage:
    row = (
        db.query(models.ActivistMessage)
        .filter(
            models.ActivistMessage.id == message_id,
            models.ActivistMessage.organization_id == org_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    return row


@router.get("/feed", response_model=ActivistMessagesFeed)
def feed(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Any signed-in org user (the activist app): every message + the stats."""
    org_id = current_user.organization_id
    stats = ensure_stats(db, org_id)
    return ActivistMessagesFeed(messages=_messages(db, org_id), stats=stats)


# Declared before the /{message_id} routes so "/stats" isn't read as an id.
@router.get("/stats", response_model=OrgActivistStatsOut)
def get_stats(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    return ensure_stats(db, admin.organization_id)


@router.put("/stats", response_model=OrgActivistStatsOut)
def update_stats(
    payload: OrgActivistStatsUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = ensure_stats(db, admin.organization_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(row, key, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(row)
    return row


@router.post("/stats/recalculate", response_model=OrgActivistStatsOut)
def recalculate_stats(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = ensure_stats(db, admin.organization_id)
    apply_computed(db, row, db.get(models.Organization, admin.organization_id))
    db.commit()
    db.refresh(row)
    return row


@router.get("", response_model=list[ActivistMessageOut])
def list_messages(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    ensure_stats(db, admin.organization_id)  # first use also seeds the messages
    return _messages(db, admin.organization_id)


@router.post("", response_model=ActivistMessageOut, status_code=status.HTTP_201_CREATED)
def create_message(
    payload: ActivistMessageCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    org_id = admin.organization_id
    last = (
        db.query(func.max(models.ActivistMessage.sort_order))
        .filter(models.ActivistMessage.organization_id == org_id)
        .scalar()
    )
    row = models.ActivistMessage(
        organization_id=org_id,
        text=payload.text.strip(),
        language=payload.language,
        sort_order=(last or 0) + 1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{message_id}", response_model=ActivistMessageOut)
def update_message(
    message_id: int,
    payload: ActivistMessageUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = _get_or_404(db, admin.organization_id, message_id)
    if payload.text is not None:
        row.text = payload.text.strip()
    if payload.language is not None:
        row.language = payload.language
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    message_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    db.delete(_get_or_404(db, admin.organization_id, message_id))
    db.commit()
