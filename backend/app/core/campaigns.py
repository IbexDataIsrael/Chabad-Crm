"""Shared Campaign query helpers, usable from any router without importing
across routers (mirrors app/core/shliach.py's own precedent).
"""
from typing import Optional

from sqlalchemy.orm import Session

from app import models


def get_active_campaign_id(db: Session, org_id: int) -> Optional[int]:
    """The org's one active, non-deleted campaign's id, or None. Single
    source of truth for "which campaign is active right now" — used by
    routers/campaigns.py's GET /active and by every Apartment write site that
    stamps Apartment.campaign_id (fixes72 §B)."""
    row = (
        db.query(models.Campaign.id)
        .filter(
            models.Campaign.organization_id == org_id,
            models.Campaign.is_active.is_(True),
            models.Campaign.deleted_at.is_(None),
        )
        .order_by(models.Campaign.id)
        .first()
    )
    return row[0] if row else None
