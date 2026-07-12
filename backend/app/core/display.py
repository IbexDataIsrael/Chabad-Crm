"""Canonical display strings for geographic entities (fixes7 §2/§4).

Buildings render as the composite address "[street number] + [street name]" —
the first comma-segment of the formatted address (e.g. "770 Eastern Pkwy,
Brooklyn, NY" → "770 Eastern Pkwy"). Apartments render as their own label
(fixes18 §5.1 — no floor concatenation), falling back to floor/resident/id.

The frontend twins live in frontend/lib/types.ts (buildingDisplayName /
apartmentTitle) — keep the fallback chains in sync.
"""
from typing import Optional


def street_part(address: Optional[str]) -> Optional[str]:
    """The '[number] [street]' segment of a formatted address, if any."""
    if not address:
        return None
    first = address.split(",")[0].strip()
    return first or None


def building_display_name(building) -> str:
    """Composite address, falling back to the legacy name, then the id."""
    return (
        street_part(getattr(building, "building_address", None))
        or (getattr(building, "building_name", None) or "").strip()
        or f"#{building.id}"
    )


def apartment_title(apartment) -> str:
    """Computed title: the apartment's own label (fixes18 §5.1 — the fixes17
    "label - floor" hyphen concatenation is gone; the floor renders in its own
    column/sort), with fallbacks: floor → resident name → id."""
    label = (getattr(apartment, "apartment_name", None) or "").strip()
    floor = (getattr(apartment, "floor", None) or "").strip()
    if label or floor:
        return label or floor
    resident = (getattr(apartment, "name", None) or "").strip()
    return resident or f"#{apartment.id}"
