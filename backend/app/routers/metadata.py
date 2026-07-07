"""Localization metadata engine.

Public (no auth) so the frontend can load Hebrew UI labels at boot — including on
the login screen, before a token exists.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.schemas import SystemConfigOut
from app.seed import SYSTEM_SETTING_DEFAULTS

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


def read_system_settings(db: Session) -> dict[str, str]:
    """The system_settings rows merged over the seed defaults, so a fresh or
    un-seeded database still yields a working title configuration."""
    values = dict(SYSTEM_SETTING_DEFAULTS)
    for row in db.query(models.SystemSetting).all():
        if row.key in values and row.value.strip():
            values[row.key] = row.value
    return values


@router.get("/system-config", response_model=SystemConfigOut)
def get_system_config(db: Session = Depends(get_db)) -> SystemConfigOut:
    """Platform title configuration (fixes9 §1). Public — the frontend computes
    the HTML <title> on every page, including the login screen pre-auth."""
    values = read_system_settings(db)
    return SystemConfigOut(
        title_template=values["system_title_template"],
        fallback_name=values["system_fallback_org_name"],
    )
