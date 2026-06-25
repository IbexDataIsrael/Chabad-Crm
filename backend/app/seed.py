"""Idempotent database seeding (multi-tenant).

- `seed_localization`  — global Hebrew UI labels (no org).
- `provision_org`      — seed a single org's picklists (+ default region). Used on
                          email verification (Phase 8) and for the demo org.
- `seed_all`           — global labels + a demo organization with admin + sample data.
"""
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.core.security import hash_password

# (entity_type, technical_name, hebrew_label) — global, table-qualified column keys.
LOCALIZATION: list[tuple[str, str, str]] = [
    ("table", "users", "משתמשים"),
    ("table", "contacts", "אנשי קשר"),
    ("table", "community_checklists", "מצוות קהילה"),
    ("table", "interactions", "אינטראקציות"),
    ("table", "areas", "אזורים"),
    ("table", "buildings", "בניינים"),
    ("table", "apartments", "דירות"),
    ("table", "significant_dates", "תאריכים חשובים"),
    ("table", "contact_mekurav", "מקורב"),
    ("table", "contact_shliach", "שליח"),
    ("column", "contacts.name", "שם פרטי"),
    ("column", "contacts.last_name", "שם משפחה"),
    ("column", "contacts.phone", "טלפון"),
    ("column", "contacts.email", "אימייל"),
    ("column", "contacts.contact_type", "סוג איש קשר"),
    ("column", "contacts.area", "אזור"),
    ("column", "contacts.assigned_user_id", "משויך ל"),
    ("column", "contacts.address", "כתובת"),
    ("column", "contacts.latitude", "קו רוחב"),
    ("column", "contacts.longitude", "קו אורך"),
    ("column", "contacts.pipeline_status", "סטטוס"),
    ("column", "contacts.priority_score", "ציון עדיפות"),
    ("column", "contacts.color_tag", "צבע"),
    ("column", "contact_mekurav.apartment_id", "דירה"),
    ("column", "contact_mekurav.first_visit", "ביקור ראשון"),
    ("column", "contact_mekurav.potential_next_step", "פוטנציאל לצעד"),
    ("column", "contact_mekurav.rebbe_connection", "קשר לרבי"),
    ("column", "contact_mekurav.recommendations", "המלצות"),
    ("column", "contact_mekurav.background", "רקע"),
    ("column", "contact_shliach.notes", "הערות"),
    ("column", "areas.area_name", "כותרת"),
    ("column", "areas.area_notes", "הערות"),
    ("column", "areas.area_polygon", "תחום פוליגון"),
    ("column", "buildings.area_id", "אזור"),
    ("column", "buildings.building_name", "שם בניין"),
    ("column", "buildings.building_address", "כתובת בניין"),
    ("column", "buildings.longitude", "קו אורך"),
    ("column", "buildings.latitude", "קו רוחב"),
    ("column", "apartments.building_id", "בניין"),
    ("column", "apartments.apartment_name", "כותרת"),
    ("column", "apartments.apartment_notes", "הערות"),
    ("column", "significant_dates.special_date", "תאריך חשוב"),
    ("column", "significant_dates.hebrew_date", "תאריך עברי"),
    ("column", "significant_dates.special_date_type", "סוג תאריך"),
    ("column", "significant_dates.special_date_title", "כותרת"),
    ("column", "significant_dates.is_set_reminder", "האם לשלוח תזכורת"),
    ("column", "users.username", "שם משתמש"),
    ("column", "users.full_name", "שם מלא"),
    ("column", "users.role", "תפקיד"),
    ("column", "interactions.category", "קטגוריה"),
    ("column", "interactions.note", "הערה"),
    ("column", "interactions.created_at", "נוצר בתאריך"),
    ("column", "community_checklists.tefillin", "תפילין"),
    ("column", "community_checklists.tefillin_notes", "הערה תפילין"),
    ("column", "community_checklists.tzedakah", "צדקה"),
    ("column", "community_checklists.charity_note", "הערה צדקה"),
    ("column", "community_checklists.shabbat_candles", "נרות"),
    ("column", "community_checklists.shabbat_candles_notes", "הערה נרות"),
    ("column", "community_checklists.torah_pamphlet", "עלון"),
    ("column", "community_checklists.torah_pamphlet_notes", "הערה עלון"),
    ("column", "community_checklists.torah_thought", "דבר תורה"),
    ("column", "community_checklists.torah_letter", "אות בספר"),
    ("column", "community_checklists.letter_torah_notes", "הערה אות בספר"),
    ("interaction_category", "heart_connection", "חיבור לב"),
    ("interaction_category", "recommendation", "המלצה"),
    ("interaction_category", "background", "רקע"),
]

# (field_key, value, hebrew_label, color_hint, sort_order, is_default)
PICKLISTS: list[tuple[str, str, str, str | None, int, bool]] = [
    ("contact.contact_type", "mekurav", "מקורב", None, 0, True),
    ("contact.contact_type", "shliach", "שליח", None, 1, False),
    ("significant_date.type", "birthday", "יום הולדת", None, 0, False),
    ("significant_date.type", "yahrzeit", "תאריך פטירה", None, 1, False),
    ("contact.area", "north", "צפון", None, 0, False),
    ("contact.area", "center", "מרכז", None, 1, False),
    ("contact.area", "south", "דרום", None, 2, False),
    ("contact.pipeline_status", "new", "חדש", None, 0, True),
    ("contact.pipeline_status", "in_progress", "בתהליך", None, 1, False),
    ("contact.pipeline_status", "sent", "נשלח", None, 2, False),
    ("contact.pipeline_status", "completed", "הושלם", None, 3, False),
    ("contact.potential_next_step", "low", "נמוך", None, 0, False),
    ("contact.potential_next_step", "medium", "בינוני", None, 1, False),
    ("contact.potential_next_step", "high", "גבוה", None, 2, False),
    ("contact.color_tag", "magenta", "מגנטה", "magenta", 0, False),
    ("contact.color_tag", "green", "ירוק בהיר", "green", 1, False),
    ("contact.color_tag", "yellow", "צהוב", "yellow", 2, False),
    ("contact.color_tag", "darkred", "אדום כהה", "darkred", 3, False),
    ("contact.color_tag", "orange", "כתום", "orange", 4, False),
    ("checklist.torah_thought", "not_given", "לא נמסר", None, 0, True),
    ("checklist.torah_thought", "given", "נמסר", None, 1, False),
    ("checklist.torah_thought", "scheduled", "מתוכנן", None, 2, False),
    ("interaction.category", "heart_connection", "חיבור לב", None, 0, False),
    ("interaction.category", "recommendation", "המלצה", None, 1, False),
    ("interaction.category", "background", "רקע", None, 2, False),
]


def seed_localization(db: Session) -> None:
    """Insert any missing global localization rows (unique technical_name)."""
    existing = {
        row.technical_name
        for row in db.query(models.FieldLocalization.technical_name).all()
    }
    new_rows = [
        models.FieldLocalization(
            entity_type=entity_type,
            technical_name=technical_name,
            hebrew_label=hebrew_label,
        )
        for entity_type, technical_name, hebrew_label in LOCALIZATION
        if technical_name not in existing
    ]
    if new_rows:
        db.add_all(new_rows)
        db.commit()


def seed_picklists(db: Session, organization_id: int) -> None:
    """Insert any missing picklist options for one organization (idempotent)."""
    existing = {
        (row.field_key, row.value)
        for row in db.query(
            models.PicklistValue.field_key, models.PicklistValue.value
        )
        .filter(models.PicklistValue.organization_id == organization_id)
        .all()
    }
    new_rows = [
        models.PicklistValue(
            organization_id=organization_id,
            field_key=field_key,
            value=value,
            hebrew_label=hebrew_label,
            color_hint=color_hint,
            sort_order=sort_order,
            is_default=is_default,
        )
        for field_key, value, hebrew_label, color_hint, sort_order, is_default in PICKLISTS
        if (field_key, value) not in existing
    ]
    if new_rows:
        db.add_all(new_rows)
        db.commit()


def provision_org(db: Session, organization_id: int) -> None:
    """Set up a newly activated organization with its default picklists."""
    seed_picklists(db, organization_id)


def _seed_sample_data(db: Session, org: models.Organization, admin: models.User) -> None:
    """Example records for the demo org — only when it has no contacts yet."""
    if (
        db.query(models.Contact)
        .filter(models.Contact.organization_id == org.id)
        .count()
        > 0
    ):
        return

    c1 = models.Contact(
        organization_id=org.id,
        name="אלי",
        last_name="ריכמן",
        phone="052-1234567",
        contact_type="mekurav",
        area="center",
        assigned_user_id=admin.id,
        address="דיזנגוף 100, תל אביב-יפו",
        latitude=32.0809,
        longitude=34.7738,
        pipeline_status="in_progress",
        priority_score=5,
        color_tag="magenta",
    )
    c1.checklist = models.CommunityChecklist(
        tefillin=True, tzedakah=True, torah_thought="given"
    )
    c1.mekurav = models.ContactMekurav(
        organization_id=org.id,
        potential_next_step="high",
        background="נפגשנו בכנס",
    )

    c2 = models.Contact(
        organization_id=org.id,
        name="דוד",
        last_name="כהן",
        phone="054-7654321",
        contact_type="mekurav",
        area="north",
        assigned_user_id=admin.id,
        pipeline_status="sent",
        priority_score=3,
        color_tag="green",
    )
    c2.checklist = models.CommunityChecklist(torah_thought="not_given")
    c2.mekurav = models.ContactMekurav(
        organization_id=org.id, potential_next_step="medium"
    )

    db.add_all([c1, c2])
    db.flush()

    db.add(
        models.Interaction(
            organization_id=org.id,
            contact_id=c1.id,
            created_by=admin.id,
            category="heart_connection",
            note="עשיתי, לבדוק שמה",
        )
    )

    # Example custom checklist field for the demo org.
    cf = models.CustomFieldDefinition(
        organization_id=org.id,
        field_key="hanuka_party",
        hebrew_label="מסיבת חנוכה",
        sort_order=0,
    )
    db.add(cf)
    db.flush()
    db.add(
        models.CustomFieldValue(
            contact_id=c1.id, definition_id=cf.id, checked=True, note="הגיע עם המשפחה"
        )
    )
    db.commit()


def seed_all(db: Session) -> None:
    """Global labels + a demo organization (admin + picklists + sample data)."""
    seed_localization(db)

    org = (
        db.query(models.Organization)
        .filter(models.Organization.name == settings.demo_org_name)
        .first()
    )
    if org is None:
        org = models.Organization(name=settings.demo_org_name)
        db.add(org)
        db.flush()

    admin = (
        db.query(models.User)
        .filter(
            models.User.organization_id == org.id,
            models.User.username == settings.admin_username,
        )
        .first()
    )
    if admin is None:
        admin = models.User(
            organization_id=org.id,
            username=settings.admin_username,
            full_name=settings.admin_full_name,
            email=settings.admin_email,
            password_hash=hash_password(settings.admin_password),
            role="admin",
            is_active=True,
            email_verified=True,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    seed_picklists(db, org.id)
    _seed_sample_data(db, org, admin)
