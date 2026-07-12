"""Per-user UI preferences (fixes17 §1.1) — grid columns, language, etc.

Self-scoped: every authenticated user (shliach included) reads and writes only
their own rows. Values are arbitrary JSON documents keyed by a short string
(e.g. 'contacts.columns' → ["phone","owner"], 'locale' → "en").
"""
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user

router = APIRouter(prefix="/api/preferences", tags=["preferences"])

_MAX_VALUE_LEN = 10_000  # sanity bound — these are small UI settings


class PreferenceIn(BaseModel):
    key: str
    value: Any = None


@router.get("", response_model=dict[str, Any])
def list_preferences(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    rows = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.user_id == user.id)
        .all()
    )
    out: dict[str, Any] = {}
    for row in rows:
        try:
            out[row.key] = json.loads(row.value)
        except ValueError:  # pragma: no cover — values are server-written JSON
            continue
    return out


@router.put("", response_model=dict[str, Any])
def set_preference(
    payload: PreferenceIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Upsert one preference; returns the user's full preference map."""
    key = payload.key.strip()
    if not key or len(key) > 100:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid preference key")
    encoded = json.dumps(payload.value, ensure_ascii=False)
    if len(encoded) > _MAX_VALUE_LEN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Preference value too large")
    row = (
        db.query(models.UserPreference)
        .filter(
            models.UserPreference.user_id == user.id,
            models.UserPreference.key == key,
        )
        .first()
    )
    if row is None:
        row = models.UserPreference(user_id=user.id, key=key)
        db.add(row)
    row.value = encoded
    db.commit()
    return list_preferences(db, user)
