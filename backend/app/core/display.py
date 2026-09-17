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
    """Computed title (fixes64 §1): "[floor] [apartment number]", space-
    separated — floor "A" + number "2" → "A 2". Handles letter-based floors
    combined with numeric apartment numbers unambiguously (the old no-
    separator "[number][floor]" form, e.g. "2A", read as a single apartment
    label instead of floor A's apartment 2).

    Both present → "A 2"; only one → that one; neither → resident name → id.
    Keep in sync with the frontend twin (frontend/lib/types.ts apartmentTitle)."""
    label = (getattr(apartment, "apartment_name", None) or "").strip()
    floor = (getattr(apartment, "floor", None) or "").strip()
    if label and floor:
        return f"{floor} {label}"
    if label or floor:
        return label or floor
    resident = (getattr(apartment, "name", None) or "").strip()
    return resident or f"#{apartment.id}"
