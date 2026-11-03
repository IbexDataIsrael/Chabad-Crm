"""Starter lists and custom fields for every NEW organization.

A snapshot of production org 1's /dashboard/picklists and
/dashboard/custom-fields (taken 2026-11-03), cleaned up:
- test leftovers dropped (custom fields "Test" and "test"/"טסט"),
- trailing spaces trimmed, the duplicate "english " language value dropped,
- obvious English spelling fixed (Received Menorah, Pamphlet, Don't ...).

Applied once, when the org is provisioned (see `apply_starter_template`). After
that the org's admin owns it: edits and deletions are never undone. Orgs that
existed before this template are marked as done at boot and never touched.
Order inside each list = the list order shown to the user.
"""
import json

from sqlalchemy.orm import Session

from app import models

# (system_name, entity_type, hebrew, english, allow_multiple, is_system)
PICKLIST_DEFINITIONS: list[tuple[str, str, str, str | None, bool, bool]] = [
    ("contact.contact_type", "contact_mekurav", "סוג איש קשר", None, False, True),
    ("contact.pipeline_status", "contact_mekurav", "סטטוס", None, False, True),
    ("contact.color_tag", "contact_mekurav", "צבע", None, False, True),
    ("contact.potential_next_step", "contact_mekurav", "פוטנציאל לצדקה", None, False, True),
    ("checklist.torah_thought", "visit", "דבר תורה", None, False, True),
    ("interaction.category", "visit", "קטגוריה", None, False, True),
    ("visit.type", "visit", "סוג ביקור", "Visit type", False, True),
    ("significant_date.type", "significant_date", "סוג תאריך", None, False, True),
    ("Jewish_status", "contact_mekurav", "יהדות", "Jewish status", False, True),
    ("affiliation", "contact_mekurav", "השתייכות דתית", "affiliation", False, True),
    ("language", "contact_mekurav", "שפה", "language", False, True),
    ("apartment.Jewish_status", "apartment", "יהדות (דירה)", "Jewish status (apartment)", False, True),
    ("apartment.campaign_status", "apartment", "סטטוס קמפיין", "Campaign status", False, True),
    ("apartment.mezuzah_status", "apartment", "מזוזה", "Mezuzah", False, True),
    ("apartment.language", "apartment", "שפה", "Language", True, True),
    ("contact.area", "contact_mekurav", "אזור", "Area", False, False),
    ("contact_shliach.manager_jewish_status", "contact_shliach", "סטטוס יהדות מנהל", "Manager Jewish status", False, True),
    ("task.custom_date", "task", "תאריך מותאם", None, False, True),
    ("visit.door_outcome", "visit", "תוצאת דלת", "Door outcome", False, True),
    ("apartment.chanukah5786", "apartment", "מבצע חנוכה", "Chanukah:", False, False),
    ("apartment.jewish_chanukah", "apartment", "עידכוני יהדות:", "Jewish update:", False, False),
    ("user_type", "contact_shliach", "סוג משתמש", "User type", False, False),
    ("task.activist_type", "task", "סוג הפעיל", "Activist type", False, False),
    ("apartment.lulav", "apartment", "מבצע לולב", "Mivtsa Lulav", False, False),
    # Back the two contact_shliach select custom fields below.
    ("shliach.Chanukah", "contact_shliach", "נר חנוכה:", "Night of Chanukah:", False, False),
    ("shliach.status_married", "contact_shliach", "אברך/בחור:", "Married:", False, False),
]

# field_key -> [(value, hebrew, english, color, is_active, is_default)], in order.
PICKLIST_VALUES: dict[str, list[tuple[str, str, str | None, str | None, bool, bool]]] = {
    "affiliation": [
        ("na", "/", None, None, True, True),
        ("chabad", "חבד", None, None, True, False),
        ("haredi", "חרדי", None, None, True, False),
        ("dati_leumi", "דתי לאומי", None, None, True, False),
        ("reform", "רפורמי", None, None, True, False),
        ("conservative", "קונסרבטיבי", None, None, True, False),
    ],
    "apartment.chanukah5786": [
        ("received_menorah", "קיבל חנוכייה", "Received Menorah", None, True, False),
        ("dont_wanted", "לא רצה", "Didn't want", None, True, False),
        ("lit_with_us", "הדליק איתנו", "Lit with us", None, True, False),
    ],
    "apartment.jewish_chanukah": [
        ("jewish_interested", "יהודי מעוניין", "Engaged Yid", None, True, False),
        ("jewish_interested_gentile", "יהודי מעוניין וגוי", "Engaged Yid and Goy", None, True, False),
        ("jewish_shtumtz", "יהודי שתומצ", "Frum", None, True, False),
        ("dont_knock", "לא לדפוק!", "Don't knock!", None, True, False),
        ("jewish", "יהודי", "Yid", None, True, False),
        ("gentile", "גוי", "Goy", None, True, False),
        ("jewish_gentile", "יהודי וגוי", "Yid and Goy", None, True, False),
    ],
    "apartment.Jewish_status": [
        ("na", "/", None, None, False, True),
        ("jewish", "יהודי", "Yid", None, True, False),
        ("jewish_interested", "יהודי מעוניין", "Engaged Yid", None, True, False),
        ("gentile", "גוי", "Goy", None, True, False),
        ("jewish_gentile", "יהודי וגוי", "Yid and Goy", None, True, False),
        ("jewish_interested_gentile", "יהודי מעוניין וגוי", "Engaged Yid and Goy", None, True, False),
        ("jewish_shtumtz", "יהודי שתומצ", "Frum", None, True, False),
        ("dont_knock", "לא לדפוק!", "Don't knock!", "red", True, False),
        ("not_jewish", "לא יהודי", "Not Jewish", None, False, False),
    ],
    "apartment.language": [
        ("hebrew", "עברית", "Hebrew", None, True, False),
        ("english", "אנגלית", "English", None, True, False),
        ("russian", "רוסית", "Russian", None, True, False),
        ("yiddish", "יידיש", "Yiddish", None, True, False),
        ("missing", "חסר", "Missing", None, True, False),
    ],
    "apartment.lulav": [
        ("didntTakeLulav", "לא נטל/ה לולב", "Didn't take Lulav", None, True, False),
        ("tookLulav", "נטל/ה לולב", "Took the lulav", None, True, False),
    ],
    "apartment.mezuzah_status": [
        ("needs_new", "צריך מזוזות חדשות", "Needs new Mezuzos", None, True, False),
        ("checked", "נבדק", "Checked", None, True, False),
        ("needs_check", "צריך בדיקה", "Needs checking", None, True, False),
    ],
    "checklist.torah_thought": [
        ("not_given", "לא נמסר", None, None, True, True),
        ("given", "נמסר", None, None, True, False),
        ("scheduled", "מתוכנן", None, None, True, False),
    ],
    "contact.color_tag": [
        ("magenta", "מגנטה", None, "magenta", True, False),
        ("green", "ירוק בהיר", None, "green", True, False),
        ("yellow", "צהוב", None, "yellow", True, False),
        ("darkred", "אדום כהה", None, "darkred", True, False),
        ("orange", "כתום", None, "orange", True, False),
    ],
    "contact.contact_type": [
        ("mekurav", "מקורב", "Mekurav", None, True, True),
        ("shliach", "פעיל", "Activist", None, True, False),
    ],
    "contact.pipeline_status": [
        ("new", "חדש", None, None, True, True),
        ("in_progress", "בתהליך", None, None, True, False),
        ("sent", "נשלח", None, None, True, False),
        ("completed", "הושלם", None, None, True, False),
    ],
    "contact.potential_next_step": [
        ("low", "נמוך", None, None, True, False),
        ("medium", "בינוני", None, None, True, False),
        ("high", "גבוה", None, None, True, False),
    ],
    "contact_shliach.manager_jewish_status": [
        ("na", "/", None, None, True, True),
        ("jewish", "יהודי", None, None, True, False),
        ("jewish_interested", "יהודי מעוניין ביהדות", None, None, True, False),
        ("jewish_gentile", "יהודי וגוי", None, None, True, False),
        ("jewish_interested_gentile", "יהודי מעוניין וגוי", None, None, True, False),
        ("jewish_shtumtz", "יהודי שתומצ", None, None, True, False),
    ],
    "interaction.category": [
        ("heart_connection", "חיבור לב", None, None, True, False),
        ("recommendation", "המלצה", None, None, True, False),
        ("background", "רקע", None, None, True, False),
    ],
    "Jewish_status": [
        ("na", "/", None, None, True, True),
        ("goy", "גוי", "Goy", None, True, False),
        ("jewish", "יהודי", "Yid", None, True, False),
        ("jewish_interested", "יהודי מעוניין ביהדות", "Engaged Yid", None, True, False),
        ("jewish_gentile", "יהודי וגוי", "Yid and Goy", None, True, False),
        ("jewish_interested_gentile", "יהודי מעוניין וגוי", "Engaged and Goy", None, True, False),
        ("jewish_shtumtz", "יהודי שתומצ", "Frum", None, True, False),
    ],
    "language": [
        ("na", "/", None, None, True, True),
        ("hebrew", "עברית", "Hebrew", None, True, False),
        ("english", "אנגלית", "English", None, True, False),
        ("russian", "רוסית", "Russian", None, True, False),
        ("yiddish", "יידיש", "Yiddish", None, True, False),
    ],
    "shliach.Chanukah": [
        (n, n, None, None, True, False) for n in ("2", "3", "4", "5", "6", "7")
    ],
    "shliach.status_married": [
        ("אברך", "אברך", "Married", None, True, False),
        ("בחור", "בחור", "Not married", None, True, False),
    ],
    "significant_date.type": [
        ("birthday", "יום הולדת", "Birthday", None, True, False),
        ("yahrzeit", "תאריך פטירה", "Yahrzeit", None, True, False),
    ],
    "task.activist_type": [
        ("girls", "בנות", "Girls", None, True, False),
        ("transport", "הסעות", "Transport", None, True, False),
        ("avrechim", "אברכים", "Avrechim", None, True, False),
        ("subway", "סבווי", "Subway", None, True, False),
    ],
    "task.custom_date": [
        ("2", "נר שני", "Second candle", None, True, False),
    ],
    "user_type": [
        ("manual", "ידני", "Manual", None, True, False),
        ("website", "אתר", "Website", None, True, False),
    ],
    "visit.door_outcome": [
        ("answered", "נענו", "Answered", None, True, False),
        ("not_home", "לא בבית", "Not home", None, True, False),
        ("come_back_later", "לחזור מאוחר יותר", "Come back later", None, True, False),
    ],
    "visit.type": [
        ("home", "ביקור בית", None, None, True, False),
        ("phone", "שיחת טלפון", None, None, True, False),
        ("event", "אירוע", None, None, True, False),
        ("meeting", "פגישה", None, None, True, False),
    ],
}

# (entity_type, field_key, field_type, hebrew, english, is_active), in order.
CUSTOM_FIELDS: list[tuple[str, str, str, str, str | None, bool]] = [
    ("apartment", "to_knock", "boolean", "לדפוק", "To knock", True),
    ("apartment", "new_notes", "text", "הערות חדשות", "New Notes", True),
    ("apartment", "mezuzah_notes", "text", "הערות מזוזה", "Mezuzah notes", True),
    ("contact_mekurav", "chinoch", "text", "חינוך", "Chinuch", True),
    ("contact_mekurav", "tzedakah2", "text", "צדקה", "Tzedakah", True),
    ("contact_mekurav", "dvar_torah", "text", "דבר תורה", "Dvar Torah", True),
    ("contact_mekurav", "ot", "text", "אות", "Torah letter", True),
    ("contact_mekurav", "mezuzah", "text", "מזוזה", "Mezuza", True),
    ("contact_mekurav", "tfilin2", "text", "תפילין:", "Tefillin", True),
    ("contact_mekurav", "alon", "text", "עלון", "Pamphlet", True),
    ("contact_mekurav", "Kesher_Larabi2", "text", "קשר לרבי:", "Kesher Larabi", True),
    ("contact_mekurav", "nerot", "text", "נרות:", "Candles", True),
    ("contact_mekurav", "jewish_name", "text", "שם יהודי:", "Jewish Name:", True),
    ("contact_mekurav", "tefillin_laid_count", "number", "הנחות תפילין", "Tefillin laid count", True),
    ("contact_mekurav", "tefillin_last_date", "date", "הנחת תפילין אחרונה", "Last tefillin date", True),
    ("contact_mekurav", "mezuzot_ordered", "number", "מזוזות שהוזמנו", "Mezuzot ordered", True),
    ("contact_mekurav", "mezuzot_installed", "number", "מזוזות שהודבקו", "Mezuzot installed", True),
    ("contact_shliach", "status_married", "select", "אברך/בחור:", "Married:", True),
    ("contact_shliach", "Chanukah", "select", "נר חנוכה:", "Night of Chanukah:", False),
    ("visit", "tefillin", "boolean", "תפילין", "Tefillin", True),
    ("visit", "tzedakah", "boolean", "צדקה", "Tzedakah", True),
    ("visit", "shabbat_candles", "boolean", "נרות", "Shabbat candles", True),
    ("visit", "torah_pamphlet", "boolean", "עלון", "Torah pamphlet", True),
    ("visit", "letter_in_torah", "boolean", "אות בספר", "Letter in a Torah", True),
    ("visit", "connection_to_rebbe", "text", "קשר לרבי", "Connection to the Rebbe", True),
    ("visit", "chinoch", "boolean", "חינוך", "Chinuch", True),
    ("visit", "Kesher_Larabi", "boolean", "קשר לרבי", "Connection to the Rebbe", True),
    ("visit", "dvar_torah", "boolean", "דבר תורה", "Dvar Torah", True),
    ("visit", "mezuzah", "boolean", "מזוזה", "Mezuza", True),
]

# The seed's built-in visit Mivtzoim fields keep their own fixed sort order
# (seed_visit_mivtzoim_custom_fields re-applies it at every boot); every other
# field is numbered after them in list order.
_FIXED_SORT = {
    ("visit", "tefillin"): 0, ("visit", "tzedakah"): 1, ("visit", "shabbat_candles"): 2,
    ("visit", "torah_pamphlet"): 3, ("visit", "letter_in_torah"): 4,
    ("visit", "connection_to_rebbe"): 5, ("apartment", "to_knock"): 0,
}

MARKER_KEY = "starter_template_applied"


def _has_marker(db: Session, organization_id: int) -> bool:
    return (
        db.query(models.OrganizationPreference.id)
        .filter(
            models.OrganizationPreference.organization_id == organization_id,
            models.OrganizationPreference.key == MARKER_KEY,
        )
        .first()
        is not None
    )


def _set_marker(db: Session, organization_id: int) -> None:
    db.add(models.OrganizationPreference(
        organization_id=organization_id, key=MARKER_KEY, value=json.dumps(True),
    ))


def mark_existing_orgs(db: Session) -> None:
    """Boot: every already-approved org counts as done, so the template never
    lands on an org that is already in use. Pending signups stay unmarked and
    get the template when they are provisioned (email verify / approval)."""
    marked = {
        org_id for (org_id,) in db.query(models.OrganizationPreference.organization_id)
        .filter(models.OrganizationPreference.key == MARKER_KEY)
    }
    changed = False
    for (org_id,) in db.query(models.Organization.id).filter(
        models.Organization.approval_status != "pending"
    ):
        if org_id not in marked:
            _set_marker(db, org_id)
            changed = True
    if changed:
        db.commit()


def apply_starter_template(db: Session, organization_id: int) -> bool:
    """Give a new org the starter lists, values and custom fields — once.

    Runs after the generic seed (seed_picklists etc.), so it updates those rows
    to the template's labels/order/active flags, adds the rest, and removes
    seeded values the template doesn't have (a new org has no data on them).
    Returns False when the org already had it (never re-applied)."""
    if _has_marker(db, organization_id):
        return False

    # -- list definitions
    defs = {
        d.system_name: d for d in db.query(models.PicklistDefinition)
        .filter(models.PicklistDefinition.organization_id == organization_id)
    }
    for i, (name, entity, he, en, multi, is_system) in enumerate(PICKLIST_DEFINITIONS):
        d = defs.get(name)
        if d is None:
            d = models.PicklistDefinition(
                organization_id=organization_id, system_name=name, is_system=is_system,
            )
            db.add(d)
        d.entity_type = entity
        d.hebrew_display_name = he
        d.english_display_name = en
        d.allow_multiple = multi
        d.sort_order = i

    # -- values
    existing = {
        (v.field_key, v.value): v for v in db.query(models.PicklistValue)
        .filter(models.PicklistValue.organization_id == organization_id)
    }
    for field_key, rows in PICKLIST_VALUES.items():
        wanted = set()
        for i, (value, he, en, color, active, default) in enumerate(rows):
            wanted.add(value)
            v = existing.get((field_key, value))
            if v is None:
                v = models.PicklistValue(
                    organization_id=organization_id, field_key=field_key, value=value,
                )
                db.add(v)
            v.hebrew_label = he
            v.english_value = en
            v.color_hint = color
            v.sort_order = i
            v.is_active = active
            v.is_default = default
        for (fk, value), v in existing.items():
            if fk == field_key and value not in wanted:
                db.delete(v)

    # -- custom fields
    fields = {
        (c.entity_type, c.field_key): c for c in db.query(models.CustomFieldDefinition)
        .filter(models.CustomFieldDefinition.organization_id == organization_id)
    }
    next_sort: dict[str, int] = {}
    for entity, key, ftype, he, en, active in CUSTOM_FIELDS:
        sort = _FIXED_SORT.get((entity, key))
        if sort is None:
            sort = max(next_sort.get(entity, 0), 6 if entity == "visit" else 0)
        next_sort[entity] = sort + 1
        c = fields.get((entity, key))
        if c is None:
            c = models.CustomFieldDefinition(
                organization_id=organization_id, entity_type=entity, field_key=key,
            )
            db.add(c)
        c.field_type = ftype
        c.hebrew_label = he
        c.english_label = en
        c.sort_order = sort
        c.is_active = active

    _set_marker(db, organization_id)
    db.commit()
    return True
