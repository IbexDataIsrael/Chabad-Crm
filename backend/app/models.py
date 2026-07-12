"""SQLAlchemy ORM models for the bilingual Mini CRM (multi-tenant SaaS).

Each tenant is an `Organization`. Tenant-scoped tables carry `organization_id` and
are isolated by it in every query. `field_localization` is global (shared UI labels).
Data is stored with English schemas; some columns hold Hebrew free text (UTF-8).

Contacts are split (fixes2): the `contacts` row holds core CRM data plus a
`contact_type` (מקורב | פעיל). Type-specific data lives in `contact_mekurav` or
`contact_shliach`. Geographic data is normalised into areas → buildings → apartments.
"""
import datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship

from app.database import Base


def _guid_column() -> Column:
    """A stable, globally-unique GUID present on every table (alongside the int id)."""
    return Column(
        String(36),
        unique=True,
        index=True,
        nullable=False,
        default=lambda: str(uuid4()),
    )


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    name = Column(String(150), nullable=False)  # used as the app/tenant title
    logo_url = Column(Text, nullable=True)  # org logo (Cloudinary secure_url)
    map_in_english = Column(Boolean, nullable=False, default=False)  # autocomplete language
    # Default map starting point (config-editable; replaces a hardcoded center).
    default_lat = Column(Float, nullable=True)
    default_lng = Column(Float, nullable=True)
    default_zoom = Column(Integer, nullable=False, default=13)
    # fixes18 §6: may shliach users view (mekurav) contacts? Off by default —
    # an admin opts the org in from the settings page.
    shliach_can_view_contacts = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # Platform-level enable/disable (superadmin). A disabled org's users can't log in.
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    # Signup approval workflow: 'pending' (awaiting superadmin approval) | 'approved'.
    # Self-signup orgs start 'pending' + is_active False; superadmin-created/existing
    # orgs are 'approved'. Login is blocked until approved (via is_active).
    approval_status = Column(
        String(20), nullable=False, default="approved", server_default=text("'approved'")
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    users = relationship("User", back_populates="organization")


class User(Base):
    __tablename__ = "users"
    # Username and email are unique within an organization (fixes14: the same
    # email may exist in several orgs — one login account per org).
    __table_args__ = (
        UniqueConstraint("organization_id", "username", name="uq_user_org_username"),
        UniqueConstraint("organization_id", "email", name="uq_user_org_email"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    username = Column(String(50), nullable=False, index=True)
    full_name = Column(String(100), nullable=False)  # Hebrew display name
    email = Column(String(255), nullable=True, index=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    phone = Column(String(50), nullable=True)
    # Nullable: Google-only accounts have no local password.
    password_hash = Column(String(255), nullable=True)
    # Non-unique: the same Google identity may be bound to one user per org.
    google_sub = Column(String(255), nullable=True, index=True)
    role = Column(String(20), nullable=False, default="staff")  # 'admin' | 'staff' | 'shliach'
    is_active = Column(Boolean, nullable=False, default=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    organization = relationship("Organization", back_populates="users")
    contacts = relationship(
        "Contact",
        back_populates="assigned_user",
        foreign_keys="Contact.assigned_user_id",
    )
    interactions = relationship("Interaction", back_populates="author")


class Contact(Base):
    """Core CRM contact. Type-specific data lives in contact_mekurav / contact_shliach."""

    __tablename__ = "contacts"
    # Phone is the business key: unique within an organization.
    __table_args__ = (
        UniqueConstraint("organization_id", "phone", name="uq_contact_org_phone"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String(150), nullable=False, index=True)  # first/given name (שם פרטי)
    last_name = Column(String(100), nullable=True, index=True)  # family name (שם משפחה)
    # Optional since the data import (see docs/data_import-plan.md); when present
    # it stays unique per org (NULLs never collide in the unique constraint).
    phone = Column(String(50), nullable=True, index=True)
    email = Column(String(255), nullable=True)  # אימייל
    contact_type = Column(
        String(20), nullable=False, default="mekurav", index=True
    )  # picklist contact.contact_type (מקורב | פעיל)
    # GUID of the owning user (fixes10 §2.1 — was an int users.id FK). Set to
    # the creator automatically on creation; forced for shliach creators.
    assigned_user_id = Column(String(36), ForeignKey("users.guid"), nullable=True)
    address = Column(Text, nullable=True)  # formatted address (Google Places)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    # Picklist-backed (admin-managed) CRM fields stay on the core contact:
    pipeline_status = Column(String(50), nullable=True)
    color_tag = Column(String(20), nullable=True)
    priority_score = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    assigned_user = relationship(
        "User", back_populates="contacts", foreign_keys=[assigned_user_id]
    )
    checklist = relationship(
        "CommunityChecklist",
        back_populates="contact",
        uselist=False,
        cascade="all, delete-orphan",
    )
    interactions = relationship(
        "Interaction",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    custom_values = relationship(
        "CustomFieldValue",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    mekurav = relationship(
        "ContactMekurav",
        back_populates="contact",
        uselist=False,
        cascade="all, delete-orphan",
    )
    shliach = relationship(
        "ContactShliach",
        back_populates="contact",
        uselist=False,
        cascade="all, delete-orphan",
    )
    # Contact-specific records: removed with the contact (FKs are enforced under
    # PostgreSQL, so these must be cascaded or the delete fails).
    visits = relationship(
        "VisitHistory",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    # Named *_rows to avoid colliding with the ContactDetailOut.picklist_values
    # schema field (a dict assembled separately in the router).
    picklist_value_rows = relationship(
        "ContactPicklistValue",
        back_populates="contact",
        cascade="all, delete-orphan",
    )
    # Donations are admin-managed financial records that may outlive a contact:
    # on contact delete, SQLAlchemy nulls their (nullable) contact_id instead of
    # deleting them. No delete cascade here on purpose.
    donations = relationship("Donation", back_populates="contact")


class ContactMekurav(Base):
    """Kiruv-specific data for a contact of type 'mekurav' (1:1 with a contact)."""

    __tablename__ = "contact_mekurav"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id"), nullable=False, unique=True, index=True
    )
    apartment_id = Column(
        Integer, ForeignKey("apartments.id"), nullable=True, index=True
    )  # דירה
    admin_area_id = Column(
        Integer, ForeignKey("admin_areas.id"), nullable=True, index=True
    )  # אזור מנהל (fixes9 §2C)
    tzedaka_potential = Column(Text, nullable=True)  # פוטנציאל לצדקה (fixes9 §3)
    first_visit = Column(DateTime, nullable=True)  # ביקור ראשון
    potential_next_step = Column(String(50), nullable=True)  # picklist (פוטנציאל לצעד)
    rebbe_connection = Column(Text, nullable=True)  # קשר לרבי
    recommendations = Column(Text, nullable=True)  # המלצות
    background = Column(Text, nullable=True)  # רקע
    # NOTE (fixes4): picklist-backed attributes (Jewish_status, affiliation, language,
    # and any admin-defined picklist) are stored generically in `contact_picklist_values`
    # — no hardcoded columns. Only pre-existing system picklists remain as columns.

    contact = relationship("Contact", back_populates="mekurav")
    apartment = relationship("Apartment", back_populates="mekuravim")
    admin_area = relationship("AdminArea", back_populates="mekuravim")
    special_dates = relationship(
        "ContactMekuravSpecialDate",
        back_populates="mekurav",
        cascade="all, delete-orphan",
    )


class ContactShliach(Base):
    """Shliach-specific data for a contact of type 'shliach' (1:1 with a contact).

    A shliach also gets a login `User` (role 'shliach'), linked via `user_id`.
    """

    __tablename__ = "contact_shliach"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id"), nullable=False, unique=True, index=True
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)  # הערות

    contact = relationship("Contact", back_populates="shliach")
    user = relationship("User")
    apartments = relationship(
        "ContactShliachApartment",
        back_populates="shliach",
        cascade="all, delete-orphan",
    )
    areas = relationship(
        "ContactShliachArea",
        back_populates="shliach",
        cascade="all, delete-orphan",
    )


class ContactShliachApartment(Base):
    """M2M: which apartments a shliach covers."""

    __tablename__ = "contact_shliach_apartment"
    __table_args__ = (
        UniqueConstraint(
            "contact_shliach_id", "apartment_id", name="uq_shliach_apartment"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_shliach_id = Column(
        Integer, ForeignKey("contact_shliach.id"), nullable=False, index=True
    )
    apartment_id = Column(
        Integer, ForeignKey("apartments.id"), nullable=False, index=True
    )

    shliach = relationship("ContactShliach", back_populates="apartments")
    apartment = relationship("Apartment", back_populates="shluchim")


class ContactShliachArea(Base):
    """M2M: which areas a shliach (active member) covers."""

    __tablename__ = "contact_shliach_area"
    __table_args__ = (
        UniqueConstraint("contact_shliach_id", "area_id", name="uq_shliach_area"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_shliach_id = Column(
        Integer, ForeignKey("contact_shliach.id"), nullable=False, index=True
    )
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, index=True)

    shliach = relationship("ContactShliach", back_populates="areas")
    area = relationship("Area")


class AdminArea(Base):
    """An administrative area (אזור מנהל, fixes9 §2) — a named org-scoped
    grouping that mekurav contacts can be assigned to via a many-to-one FK."""

    __tablename__ = "admin_areas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String(150), nullable=False)  # שם
    comments = Column(Text, nullable=True)  # הערות
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    mekuravim = relationship("ContactMekurav", back_populates="admin_area")


class Area(Base):
    """A geographic area (with an optional drawn polygon)."""

    __tablename__ = "areas"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    area_name = Column(String(150), nullable=False)  # כותרת
    area_notes = Column(Text, nullable=True)  # הערות
    area_polygon = Column(Text, nullable=True)  # GeoJSON polygon (תחום פוליגון)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    buildings = relationship(
        "Building", back_populates="area", cascade="all, delete-orphan"
    )


class Building(Base):
    __tablename__ = "buildings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=False, index=True)
    building_name = Column(String(150), nullable=True)  # שם בניין (optional, fixes7)
    building_address = Column(Text, nullable=True)  # כתובת בניין (required at the API)
    longitude = Column(Float, nullable=True)
    latitude = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    area = relationship("Area", back_populates="buildings")
    apartments = relationship(
        "Apartment", back_populates="building", cascade="all, delete-orphan"
    )
    floors = relationship(
        "Floor",
        back_populates="building",
        cascade="all, delete-orphan",
        order_by="Floor.sort_order, Floor.id",
    )


class Floor(Base):
    """A floor (קומה) within a building. Referenced by apartments as free text
    (`apartments.floor` holds the floor name) so floors can be renamed freely."""

    __tablename__ = "floors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    building_id = Column(
        Integer,
        ForeignKey("buildings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(50), nullable=False)  # שם קומה (e.g. "1", "קרקע")
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    building = relationship("Building", back_populates="floors")


class Apartment(Base):
    __tablename__ = "apartments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    building_id = Column(
        Integer, ForeignKey("buildings.id"), nullable=False, index=True
    )
    apartment_name = Column(String(150), nullable=True)  # תווית (optional, fixes7)
    apartment_notes = Column(Text, nullable=True)  # הערות
    # fixes7 §4 — apartment data fields:
    floor = Column(String(50), nullable=True)  # קומה (name of a building floor)
    jewish_status = Column(String(100), nullable=True)  # picklist apartment.Jewish_status
    campaign_status = Column(String(100), nullable=True)  # picklist apartment.campaign_status
    mezuzah_status = Column(String(100), nullable=True)  # picklist apartment.mezuzah_status
    language = Column(String(100), nullable=True)  # picklist apartment.language (fixes13)
    name = Column(String(150), nullable=True)  # שם דייר (resident)
    phone = Column(String(50), nullable=True)  # טלפון (validated at the API)
    email = Column(String(255), nullable=True)  # אימייל (validated at the API)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    building = relationship("Building", back_populates="apartments")
    mekuravim = relationship("ContactMekurav", back_populates="apartment")
    shluchim = relationship("ContactShliachApartment", back_populates="apartment")


class SignificantDate(Base):
    """A meaningful date (birthday / yahrzeit) linked to mekuravim, with reminders."""

    __tablename__ = "significant_dates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    special_date = Column(DateTime, nullable=False)  # תאריך חשוב
    hebrew_date = Column(String(100), nullable=True)  # תאריך עברי
    special_date_type = Column(String(50), nullable=True)  # picklist significant_date.type
    special_date_title = Column(String(200), nullable=True)  # free text (fixes4)
    is_set_reminder = Column(Boolean, nullable=False, default=False)  # האם לשלוח תזכורת
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    mekuravim = relationship(
        "ContactMekuravSpecialDate",
        back_populates="special_date_obj",
        cascade="all, delete-orphan",
    )
    reminders = relationship(
        "SignificantDateReminder",
        back_populates="significant_date",
        cascade="all, delete-orphan",
    )


class ContactMekuravSpecialDate(Base):
    """M2M: significant dates attached to a mekurav."""

    __tablename__ = "contact_mekurav_special_date"
    __table_args__ = (
        UniqueConstraint(
            "contact_mekurav_id", "special_date_id", name="uq_mekurav_special_date"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_mekurav_id = Column(
        Integer, ForeignKey("contact_mekurav.id"), nullable=False, index=True
    )
    special_date_id = Column(
        Integer, ForeignKey("significant_dates.id"), nullable=False, index=True
    )

    mekurav = relationship("ContactMekurav", back_populates="special_dates")
    special_date_obj = relationship("SignificantDate", back_populates="mekuravim")


class SignificantDateReminder(Base):
    """An Android-calendar-style reminder for a significant date.

    `offset_minutes` is how long *before* the date to fire; `remind_at_time` is the
    time-of-day to send. Fired by the scheduler, which records `last_sent_at`.
    """

    __tablename__ = "significant_date_reminders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    significant_date_id = Column(
        Integer, ForeignKey("significant_dates.id"), nullable=False, index=True
    )
    offset_minutes = Column(Integer, nullable=False, default=0)  # minutes before the date
    remind_at_time = Column(Time, nullable=True)  # time-of-day to send
    channel = Column(String(20), nullable=False, default="email")
    last_sent_at = Column(DateTime, nullable=True)

    significant_date = relationship("SignificantDate", back_populates="reminders")


class VisitHistory(Base):
    """A visit (היסטורית ביקורים). Many per contact; may be unlinked to a contact."""

    __tablename__ = "visit_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id"), nullable=True, index=True
    )  # איש קשר (optional)
    visit_date = Column(DateTime, nullable=False)  # תאריך
    visit_type = Column(String, nullable=True)  # סוג ביקור (picklist: visit.type)
    location = Column(Text, nullable=True)  # מיקום
    notes = Column(Text, nullable=True)  # הערות
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    contact = relationship("Contact", back_populates="visits")


class Donation(Base):
    """A donation (היסטורית תרומות). Admin-managed; may be unlinked to a contact."""

    __tablename__ = "donations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id"), nullable=True, index=True
    )  # איש קשר (optional)
    donation_date = Column(DateTime, nullable=False)  # תאריך
    amount = Column(Float, nullable=True)  # סכום
    is_ongoing = Column(Boolean, nullable=False, default=False)  # האם הוראת קבע
    number_of_payments = Column(Integer, nullable=True)  # מספר תשלומים
    notes = Column(Text, nullable=True)  # הערות
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    contact = relationship("Contact", back_populates="donations")


class CommunityChecklist(Base):
    """Mitzvot checklist — only populated for mekurav contacts (scoped via contact)."""

    __tablename__ = "community_checklists"

    contact_id = Column(Integer, ForeignKey("contacts.id"), primary_key=True)
    guid = _guid_column()
    tefillin = Column(Boolean, default=False, nullable=False)  # תפילין
    tefillin_notes = Column(Text, nullable=True)  # הערה תפילין
    tzedakah = Column(Boolean, default=False, nullable=False)  # צדקה
    charity_note = Column(Text, nullable=True)  # הערה צדקה
    shabbat_candles = Column(Boolean, default=False, nullable=False)  # נרות
    shabbat_candles_notes = Column(Text, nullable=True)  # הערה נרות
    torah_pamphlet = Column(Boolean, default=False, nullable=False)  # עלון
    torah_pamphlet_notes = Column(Text, nullable=True)  # הערה עלון
    torah_thought = Column(String(50), nullable=True)  # picklist checklist.torah_thought (דבר תורה)
    torah_letter = Column(Boolean, default=False, nullable=False)  # אות בספר
    letter_torah_notes = Column(Text, nullable=True)  # הערה אות בספר

    contact = relationship("Contact", back_populates="checklist")


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    category = Column(String(50), nullable=False)
    note = Column(Text, nullable=False)  # Stored in Hebrew
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    contact = relationship("Contact", back_populates="interactions")
    author = relationship("User", back_populates="interactions")


class EmailTemplate(Base):
    """Platform-level, superadmin-editable email template (bilingual body).

    Keyed by a stable string (e.g. 'org_pending_user'). The sent email combines
    the Hebrew + English bodies; `{{placeholders}}` are substituted at send time.
    """

    __tablename__ = "email_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    key = Column(String(60), nullable=False, unique=True, index=True)
    subject = Column(Text, nullable=False)
    body = Column(Text, nullable=False, default="")  # English
    body_hebrew = Column(Text, nullable=False, default="")  # Hebrew
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )


class SystemSetting(Base):
    """Platform-level, superadmin-editable key/value setting (fixes9 §1).

    Global like EmailTemplate — not tenant-scoped. Known keys:
    'system_title_template' and 'system_fallback_org_name'.
    """

    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    key = Column(String(100), nullable=False, unique=True, index=True)
    value = Column(Text, nullable=False, default="")
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )


class SystemAccessLog(Base):
    """Audit row for every login attempt, successful or not (fixes14 §3).

    Platform-level (not tenant-scoped): a failed attempt has no resolved org,
    and one identifier may map to users in several orgs. `username` is the
    identifier exactly as the visitor typed it.
    """

    __tablename__ = "system_access_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    date = Column(Date, nullable=False, index=True)
    time = Column(Time, nullable=False)
    username = Column(String(255), nullable=False)
    # 'SUCCESS' | 'FAILED_INVALID_PASSWORD' | 'FAILED_NO_USER' |
    # 'FAILED_NOT_VERIFIED' | 'FAILED_ORG_DISABLED' | 'ORG_SELECTION_REQUIRED'
    status = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class FieldLocalization(Base):
    """Global (non-tenant) UI label metadata."""

    __tablename__ = "field_localization"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    entity_type = Column(String(50), nullable=False)
    technical_name = Column(String(100), nullable=False, unique=True)
    # UI strings can be long sentences (intros, hints) — Text avoids Postgres'
    # enforced varchar length limits (SQLite ignores them, Postgres does not).
    hebrew_label = Column(Text, nullable=False)
    # English label for the bilingual UI; blank until an admin fills it in.
    english_label = Column(Text, nullable=True)


class FieldSetting(Base):
    """Per-org visibility toggle for a built-in contact field (admin-managed).

    Only fields in the toggleable registry (see app/field_registry.py) are stored
    here. A row marks a field shown/hidden; absence means visible (the default),
    so existing orgs need no backfill.
    """

    __tablename__ = "field_settings"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "field_key", name="uq_fieldsetting_org_key"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    field_key = Column(String(100), nullable=False)  # e.g. 'contacts.area'
    is_visible = Column(Boolean, nullable=False, default=True)


class CustomFieldDefinition(Base):
    """Admin-defined per-org custom checklist field (a boolean + a note)."""

    __tablename__ = "custom_field_definitions"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "field_key", name="uq_customfield_org_key"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    field_key = Column(String(100), nullable=False)  # technical key, e.g. 'hanuka_party'
    hebrew_label = Column(String(100), nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    values = relationship(
        "CustomFieldValue",
        back_populates="definition",
        cascade="all, delete-orphan",
    )


class CustomFieldValue(Base):
    """A contact's value for a custom field definition (checkbox + note)."""

    __tablename__ = "custom_field_values"
    __table_args__ = (
        UniqueConstraint(
            "contact_id", "definition_id", name="uq_customval_contact_def"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False, index=True)
    definition_id = Column(
        Integer, ForeignKey("custom_field_definitions.id"), nullable=False, index=True
    )
    checked = Column(Boolean, default=False, nullable=False)
    note = Column(Text, nullable=True)

    contact = relationship("Contact", back_populates="custom_values")
    definition = relationship("CustomFieldDefinition", back_populates="values")


class PicklistValue(Base):
    """Per-organization dropdown options for constrained fields."""

    __tablename__ = "picklist_values"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "field_key", "value", name="uq_picklist_org_field_value"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    field_key = Column(String(100), nullable=False, index=True)
    value = Column(String(100), nullable=False)  # stored technical/system token
    hebrew_label = Column(String(100), nullable=False)  # hebrew_value
    # English display value for the bilingual UI; blank until an admin fills it in.
    english_value = Column(String(100), nullable=True)
    color_hint = Column(String(20), nullable=True)
    sort_order = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )


class PicklistDefinition(Base):
    """Per-organization picklist **definition** (the registry of managed picklists).

    Promotes the previously hardcoded `PICKLIST_FIELDS` map into editable data so
    admins can rename display labels (he/en). `system_name` is the stable key that
    `picklist_values.field_key` references.
    """

    __tablename__ = "picklists"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "system_name", name="uq_picklist_org_system"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    system_name = Column(String(100), nullable=False, index=True)
    hebrew_display_name = Column(String(150), nullable=False)
    english_display_name = Column(String(150), nullable=True)
    is_system = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class ContactPicklistValue(Base):
    """A contact's selected option for a *dynamic* picklist (single-select).

    Generic key/value store so picklist-backed attributes need no schema columns:
    one row per (contact, picklist). `value` holds the technical token (matching
    `picklist_values.value`).
    """

    __tablename__ = "contact_picklist_values"
    __table_args__ = (
        UniqueConstraint("contact_id", "picklist_id", name="uq_contact_picklist"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id"), nullable=False, index=True
    )
    picklist_id = Column(
        Integer, ForeignKey("picklists.id"), nullable=False, index=True
    )
    value = Column(String(100), nullable=False)

    contact = relationship("Contact", back_populates="picklist_value_rows")
    picklist = relationship("PicklistDefinition")


class UserPreference(Base):
    """A per-user UI preference (fixes17 §1.1) — e.g. which grid columns are
    visible, or the chosen interface language. Value is a JSON document so the
    same table serves lists, strings and flags. Persisting these in the DB
    (instead of localStorage) makes them follow the user across browsers."""

    __tablename__ = "user_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_userpref_user_key"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    key = Column(String(100), nullable=False)  # e.g. 'contacts.columns', 'locale'
    value = Column(Text, nullable=False, default="null")  # JSON-encoded
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )


class OrgBackup(Base):
    """A restore point of one organization's CRM data (fixes16).

    The snapshot itself is a zlib-compressed JSON blob stored right here in the
    database — the app server's disk is ephemeral (wiped on every deploy), and
    keeping it as a row makes restore a pure DB operation. User accounts are
    never part of a snapshot. `created_by_name` is denormalized on purpose so
    the row stays meaningful after the creating user is deleted."""

    __tablename__ = "org_backups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    created_by_name = Column(String(150), nullable=True)
    note = Column(String(300), nullable=True)  # e.g. "לפני ייבוא"
    kind = Column(String(20), nullable=False, default="manual")  # manual | auto
    counts = Column(Text, nullable=False, default="{}")  # JSON row-count summary
    data = Column(LargeBinary, nullable=False)  # zlib-compressed JSON snapshot
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
