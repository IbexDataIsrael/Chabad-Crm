"""Localization metadata engine.

Public (no auth) so the frontend can load Hebrew UI labels at boot — including on
the login screen, before a token exists.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

router = APIRouter(prefix="/api/metadata", tags=["metadata"])


@router.get("/localization")
def get_localization(db: Session = Depends(get_db)) -> dict[str, dict[str, str]]:
    """Return all field_localization rows grouped by entity_type.

    Shape: { entity_type: { technical_name: hebrew_label } }, where entity_type is
    one of 'table', 'column', 'interaction_category'.
    """
    grouped: dict[str, dict[str, str]] = {}
    for row in db.query(models.FieldLocalization).all():
        grouped.setdefault(row.entity_type, {})[row.technical_name] = row.hebrew_label
    return grouped
