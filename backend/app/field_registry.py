"""Registry of built-in fields that admins may show/hide per org.

Each entry is (field_key, label_key, entity):
  - field_key  — stable key stored in field_settings and checked by the frontend.
  - label_key  — localization technical_name used to render the UI label.
  - entity     — groups fields in the admin UI ('contact' | 'contact_mekurav' |
                 'contact_shliach' | 'building' | 'apartment').

The contact `name` field and the `contact_type` selector are intentionally
excluded — they can never be hidden. (fixes34 §3.1: `phone`/`email` used to be
excluded on the same grounds — see the `contacts.phone`/`contacts.email`
entries below for why that changed.)

A field listed in DEFAULT_HIDDEN starts hidden for every org (fixes7: building
and apartment name labels are concealed by default); absence of a field_settings
row means "use the field's default", so no org backfill is ever needed.
"""

TOGGLEABLE_FIELDS: list[tuple[str, str, str]] = [
    # fixes19 §5: the entire mekurav layout area (one section-level switch,
    # hidden by default — see DEFAULT_HIDDEN).
    ("contact_mekurav.section", "contact_mekurav.section", "contact_mekurav"),
    ("contacts.last_name", "contacts.last_name", "contact"),
    # fixes34 §3.1: phone/email are now toggleable too — this reverses fixes28
    # §1's "core identity field, can't be hidden" decision, per an explicit
    # spec ask. The toggle only ever governs UI rendering (CRUD forms,
    # filters, columns); it never touches the DB column, so it can't break a
    # shliach's email-based login identity even when hidden from their form.
    ("contacts.phone", "contacts.phone", "contact"),
    ("contacts.email", "contacts.email", "contact"),
    # fixes38 §3.1: the quick-action icons (list row + contact detail header)
    # get their own toggles, independent of the phone/email fields themselves.
    ("contacts.action_call", "contacts.action_call", "contact"),
    ("contacts.action_whatsapp", "contacts.action_whatsapp", "contact"),
    ("contacts.action_email", "contacts.action_email", "contact"),
    # fixes38 §3.1: created_at was previously always shown (key `null` in
    # ContactView.tsx); now toggleable like contact_mekurav.first_visit.
    ("contacts.created_at", "contacts.created_at", "contact"),
    ("contacts.assigned_user_id", "contacts.assigned_user_id", "contact"),
    ("contacts.pipeline_status", "contacts.pipeline_status", "contact"),
    ("contacts.color_tag", "contacts.color_tag", "contact"),
    ("contacts.priority_score", "contacts.priority_score", "contact"),
    ("contacts.address", "contacts.address", "contact"),
    # fixes20 §2: the read-only coordinates readout gets its own toggle
    # (previously it rode on contacts.address). Default-hidden.
    ("contacts.coordinates", "contacts.coordinates", "contact"),
    # Mekurav-specific
    ("contact_mekurav.apartment_id", "contact_mekurav.apartment_id", "contact_mekurav"),
    ("contact_mekurav.first_visit", "contact_mekurav.first_visit", "contact_mekurav"),
    (
        "contact_mekurav.potential_next_step",
        "contact_mekurav.potential_next_step",
        "contact_mekurav",
    ),
    # fixes25: rebbe_connection moved to visits (connection_to_rebbe).
    (
        "contact_mekurav.recommendations",
        "contact_mekurav.recommendations",
        "contact_mekurav",
    ),
    ("contact_mekurav.background", "contact_mekurav.background", "contact_mekurav"),
    # fixes9: admin-area link + tzedaka potential
    (
        "contact_mekurav.admin_area_id",
        "contact_mekurav.admin_area_id",
        "contact_mekurav",
    ),
    (
        "contact_mekurav.tzedaka_potential",
        "contact_mekurav.tzedaka_potential",
        "contact_mekurav",
    ),
    # Mekurav dynamic picklists (keyed by picklist system_name).
    ("Jewish_status", "picklist.Jewish_status", "contact_mekurav"),
    ("affiliation", "picklist.affiliation", "contact_mekurav"),
    ("language", "picklist.language", "contact_mekurav"),
    # Shliach-specific
    ("contact_shliach.areas", "contact_shliach.areas", "contact_shliach"),
    # fixes19: report numbers replace the apartment coverage links.
    (
        "contact_shliach.report_numbers",
        "contact_shliach.report_numbers",
        "contact_shliach",
    ),
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
    ("apartment.language", "picklist.apartment.language", "apartment"),  # fixes13
    # fixes19: linked report number (מספר דוח).
    ("apartments.report_number_id", "apartments.report_number_id", "apartment"),
    # fixes27 §4: built-in visit field (torah thought — picklist-backed,
    # untouched by fixes39). Hiding it removes it from the visit forms and
    # detail cards. fixes39: the Mivtzoim flags + connection_to_rebbe moved
    # off dedicated columns onto ordinary entity_type="visit" custom fields —
    # their visibility is now controlled the same way any org-added visit
    # custom field's is (CustomFieldDefinition.is_active, via the
    # custom-fields admin UI), not this field_settings mechanism.
    ("visits.torah_thought", "visits.torah_thought", "visit"),
    # fixes50 §1.1: location (plain column) + visit type (picklist-backed,
    # visit.type) join torah_thought as hideable visit fields.
    ("visits.location", "visits.location", "visit"),
    ("visits.visit_type", "visits.visit_type", "visit"),
    # fixes108: the built-in task "custom date" picklist is a system picklist,
    # so the dynamic picklist branch never listed it — registered here so the
    # Fields page's Tasks tab shows (and can hide) it like the add-on fields.
    ("task.custom_date", "task.custom_date", "task"),
]

# Fields concealed by default (an explicit field_settings row overrides this).
# apartments.apartment_name was default-hidden in fixes7, which removed the
# label input from the apartment forms entirely — apartments were then saved
# nameless and their computed title collapsed to the bare floor number. It is
# visible by default again (hotfix after fixes12).
DEFAULT_HIDDEN: set[str] = {
    "buildings.building_name",
    # fixes19 §5: the mekurav layout area ships invisible; an admin opts the
    # org in from the fields configuration page.
    "contact_mekurav.section",
    # fixes20 §2: assigned-to, coordinates and color ship hidden; admins unhide
    # them from the fields configuration page.
    "contacts.assigned_user_id",
    "contacts.coordinates",
    "contacts.color_tag",
}

TOGGLEABLE_KEYS: set[str] = {f[0] for f in TOGGLEABLE_FIELDS}

# field_key -> (label_key, entity), for quick lookups when building responses.
_BY_KEY = {fk: (lk, ent) for fk, lk, ent in TOGGLEABLE_FIELDS}


def label_and_entity(field_key: str) -> tuple[str, str]:
    return _BY_KEY.get(field_key, (field_key, ""))


def default_visible(field_key: str) -> bool:
    return field_key not in DEFAULT_HIDDEN

