"""Registry of built-in contact fields that admins may show/hide per org.

Each entry is (field_key, label_key, entity):
  - field_key  — stable key stored in field_settings and checked by the frontend.
  - label_key  — localization technical_name used to render the UI label.
  - entity     — groups fields in the admin UI ('contact' | 'contact_mekurav' |
                 'contact_shliach').

Required identity fields (name, phone) and the contact_type selector are
intentionally excluded — they can never be hidden.
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
]

TOGGLEABLE_KEYS: set[str] = {f[0] for f in TOGGLEABLE_FIELDS}

# field_key -> (label_key, entity), for quick lookups when building responses.
_BY_KEY = {fk: (lk, ent) for fk, lk, ent in TOGGLEABLE_FIELDS}


def label_and_entity(field_key: str) -> tuple[str, str]:
    return _BY_KEY.get(field_key, (field_key, ""))
