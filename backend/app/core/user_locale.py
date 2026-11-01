"""fixes118: the language the chat helper answers a user in.

The user's stored `locale` preference (fixes116, user_preferences) — "he" or
"en"; no stored value means Hebrew. The helper gets ONE label per field and
option in that language; a missing English label falls back to the Hebrew
one, never to a technical value.
"""
import json
from typing import Optional

from sqlalchemy.orm import Session

from app import models

DEFAULT_LOCALE = "he"


def user_locale(db: Session, user: models.User) -> str:
    row = (
        db.query(models.UserPreference)
        .filter(models.UserPreference.user_id == user.id, models.UserPreference.key == "locale")
        .first()
    )
    try:
        value = json.loads(row.value) if row else None
    except ValueError:
        value = None
    return value if value in ("he", "en") else DEFAULT_LOCALE


def pick(locale: str, he: Optional[str], en: Optional[str]) -> Optional[str]:
    if locale == "en" and en:
        return en
    return he or en
