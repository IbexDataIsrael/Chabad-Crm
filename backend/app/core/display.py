"""Canonical display strings for geographic entities (fixes7 §2/§4).

Buildings render as the composite address "[street number] + [street name]" —
the first comma-segment of the formatted address (e.g. "770 Eastern Pkwy,
Brooklyn, NY" → "770 Eastern Pkwy"). Apartments render as the computed title
label - floor (e.g. label "A" on floor "1" → "A - 1"; fixes17 §3.1).

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
    """Computed title: label - floor ("A"+"1" → "A - 1", fixes17 §3.1 — a
    space-isolated hyphen separates the parts), with sane fallbacks."""
    label = (getattr(apartment, "apartment_name", None) or "").strip()
    floor = (getattr(apartment, "floor", None) or "").strip()
    if label and floor:
        return f"{label} - {floor}"
    if label or floor:
        return label or floor
    resident = (getattr(apartment, "name", None) or "").strip()
    return resident or f"#{apartment.id}"
