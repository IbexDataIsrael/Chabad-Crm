"""fixes54 §8: superadmin-managed per-organization feature toggles.

Stored as key-value JSON rows in `organization_prefs` (one row per org+key,
same shape as `UserPreference`). The four module toggles below cascade: a
module turned off forces every module beneath it off too, *regardless of that
module's own stored value* — `effective_flags` is the single source of truth
for that cascade, so nothing else re-derives it independently.
"""
import json
from typing import TypedDict

from sqlalchemy.orm import Session

from app import models

# Order matters: each key's effective value is ANDed with the one before it.
CASCADE_KEYS = (
    "area_display_enabled",
    "building_display_enabled",
    "apartment_display_enabled",
    "activist_system_enabled",
)
# Toggles outside the display cascade (independent on/off switches).
STANDALONE_KEYS = ("ai_query_enabled", "localization_page_enabled")
ALL_KEYS = CASCADE_KEYS + STANDALONE_KEYS
DEFAULTS: dict[str, bool] = {key: True for key in ALL_KEYS}
# fixes93: the org admin's localization (translations) page is hidden unless
# the superadmin turns it on for that org — the one toggle that defaults OFF.
DEFAULTS["localization_page_enabled"] = False


class EffectiveFlags(TypedDict):
    area_display_enabled: bool
    building_display_enabled: bool
    apartment_display_enabled: bool
    activist_system_enabled: bool
    ai_query_enabled: bool
    localization_page_enabled: bool


def get_raw_prefs(db: Session, organization_id: int) -> dict[str, bool]:
    """The org's own stored values (before cascading) — defaults for any
    key never explicitly set."""
    rows = (
        db.query(models.OrganizationPreference)
        .filter(models.OrganizationPreference.organization_id == organization_id)
        .all()
    )
    out = dict(DEFAULTS)
    for row in rows:
        if row.key not in ALL_KEYS:
            continue
        try:
            value = json.loads(row.value)
        except ValueError:  # pragma: no cover — values are server-written JSON
            continue
        if isinstance(value, bool):
            out[row.key] = value
    return out


def effective_flags(db: Session, organization_id: int) -> EffectiveFlags:
    """Cascaded flags — what actually governs UI/API behavior. A disabled
    ancestor forces every descendant to False even if its own stored value
    is True (e.g. area off => building/apartment/activist all read False)."""
    raw = get_raw_prefs(db, organization_id)
    area = raw["area_display_enabled"]
    building = area and raw["building_display_enabled"]
    apartment = building and raw["apartment_display_enabled"]
    activist = apartment and raw["activist_system_enabled"]
    return EffectiveFlags(
        area_display_enabled=area,
        building_display_enabled=building,
        apartment_display_enabled=apartment,
        activist_system_enabled=activist,
        ai_query_enabled=raw["ai_query_enabled"],
        localization_page_enabled=raw["localization_page_enabled"],
    )


def set_prefs(db: Session, organization_id: int, updates: dict[str, bool]) -> None:
    """Upsert only the keys present in `updates` (unknown keys ignored)."""
    existing = {
        row.key: row
        for row in db.query(models.OrganizationPreference).filter(
            models.OrganizationPreference.organization_id == organization_id,
            models.OrganizationPreference.key.in_(ALL_KEYS),
        )
    }
    for key, value in updates.items():
        if key not in ALL_KEYS or not isinstance(value, bool):
            continue
        row = existing.get(key)
        if row is None:
            row = models.OrganizationPreference(organization_id=organization_id, key=key)
            db.add(row)
            existing[key] = row
        row.value = json.dumps(value)
    db.commit()
