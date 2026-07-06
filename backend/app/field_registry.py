"""Registry of built-in fields that admins may show/hide per org.

Each entry is (field_key, label_key, entity):
  - field_key  — stable key stored in field_settings and checked by the frontend.
  - label_key  — localization technical_name used to render the UI label.
  - entity     — groups fields in the admin UI ('contact' | 'contact_mekurav' |
                 'contact_shliach' | 'building' | 'apartment').

Required identity fields (name, phone) and the contact_type selector are
intentionally excluded — they can never be hidden.

A field listed in DEFAULT_HIDDEN starts hidden for every org (fixes7: building
and apartment name labels are concealed by default); absence of a field_settings
row means "use the field's default", so no org backfill is ever needed.
"""

TOGGLEABLE_FIELDS: list[tuple[str, str, str]] = [
    # Core contact
    ("contacts.last_name", "contacts.last_name", "contact"),
    ("contacts.email", "contacts.email", "contact"),
    ("contacts.assigned_user_id", "contacts.assigned_user_id", "contact"),
    ("contacts.pipeline_status", "contacts.pipeline_status", "contact"),
    ("contacts.color_tag", "contacts.color_tag", "contact"),
    ("contacts.priority_score", "contacts.priority_score", "contact"),
    ("contacts.address", "contacts.address", "contact"),
    # Mekurav-specific
    ("contact_mekurav.apartment_id", "contact_mekurav.apartment_id", "contact_mekurav"),
    ("contact_mekurav.first_visit", "contact_mekurav.first_visit", "contact_mekurav"),
    (
        "contact_mekurav.potential_next_step",
        "contact_mekurav.potential_next_step",
        "contact_mekurav",
    ),
    (
        "contact_mekurav.rebbe_connection",
        "contact_mekurav.rebbe_connection",
        "contact_mekurav",
    ),
    (
        "contact_mekurav.recommendations",
        "contact_mekurav.recommendations",
        "contact_mekurav",
    ),
    ("contact_mekurav.background", "contact_mekurav.background", "contact_mekurav"),
    # Mekurav dynamic picklists (keyed by picklist system_name).
    ("Jewish_status", "picklist.Jewish_status", "contact_mekurav"),
    ("affiliation", "picklist.affiliation", "contact_mekurav"),
    ("language", "picklist.language", "contact_mekurav"),
    # Shliach-specific
    ("contact_shliach.areas", "contact_shliach.areas", "contact_shliach"),
    ("contact_shliach.apartments", "contact_shliach.apartments", "contact_shliach"),
    ("contact_shliach.notes", "contact_shliach.notes", "contact_shliach"),
    # Building (fixes7 §2)
    ("buildings.building_name", "buildings.building_name", "building"),
    # Apartment (fixes7 §4)
    ("apartments.apartment_name", "apartments.apartment_name", "apartment"),
    ("apartments.floor", "apartments.floor", "apartment"),
    ("apartments.apartment_notes", "apartments.apartment_notes", "apartment"),
    ("apartments.name", "apartments.name", "apartment"),
    ("apartments.phone", "apartments.phone", "apartment"),
    ("apartments.email", "apartments.email", "apartment"),
    ("apartment.Jewish_status", "picklist.apartment.Jewish_status", "apartment"),
    ("apartment.campaign_status", "picklist.apartment.campaign_status", "apartment"),
    ("apartment.mezuzah_status", "picklist.apartment.mezuzah_status", "apartment"),
]

# Fields concealed by default (an explicit field_settings row overrides this).
DEFAULT_HIDDEN: set[str] = {
    "buildings.building_name",
    "apartments.apartment_name",
}

TOGGLEABLE_KEYS: set[str] = {f[0] for f in TOGGLEABLE_FIELDS}

# field_key -> (label_key, entity), for quick lookups when building responses.
_BY_KEY = {fk: (lk, ent) for fk, lk, ent in TOGGLEABLE_FIELDS}


def label_and_entity(field_key: str) -> tuple[str, str]:
    return _BY_KEY.get(field_key, (field_key, ""))


def default_visible(field_key: str) -> bool:
    return field_key not in DEFAULT_HIDDEN
