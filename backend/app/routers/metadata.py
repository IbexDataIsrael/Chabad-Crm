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
    """Return every UI string keyed by technical_name, with both languages.

    Shape: { technical_name: { "he": <hebrew>, "en": <english> } }. `en` is "" until
    an admin fills it in. Public so the frontend can load labels at boot.
    """
    out: dict[str, dict[str, str]] = {}
    for row in db.query(models.FieldLocalization).all():
        out[row.technical_name] = {
            "he": row.hebrew_label,
            "en": row.english_label or "",
        }
    return out
