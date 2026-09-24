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
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
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


class Role(Base):
    """fixes43 §5.1: the fixed set of platform role identifiers, extracted into
    its own table so `User.role` carries a real FK instead of an unconstrained
    string. `name` is the stable, English, storage-layer identifier (never
    shown to users) — display labels stay in `field_localization`
    (`users.role_admin` etc.), keeping data storage and UI presentation
    separate per the project's localization architecture. Global (not
    org-scoped): every org shares the same small role set."""

    __tablename__ = "roles"

    name = Column(String(20), primary_key=True)  # 'admin' | 'staff' | 'shliach' | 'superadmin'
    sort_order = Column(Integer, nullable=False, default=0)


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
    # fixes33 §6: free text injected at the top of every generated PDF report.
    report_notes = Column(Text, nullable=True)
    # fixes40 §4: global field-label text styling. Each is nullable/independent
    # — null means "use the app's built-in styling", so no org needs a backfill.
    label_font_size = Column(Integer, nullable=True)  # px
    label_color = Column(String(20), nullable=True)  # hex, e.g. "#374151"
    label_font_family = Column(String(100), nullable=True)
    # fixes51 §4: the org-wide Shliach Role Configuration Panel's settings —
    # {disable_edit, hide_filters, default_filters, default_columns}. One JSON
    # blob (matches UserPreference.value's pattern for "a small settings bag")
    # rather than 4 columns; null = nothing configured yet (every setting's
    # own default applies).
    shliach_view_config = Column(JSON, nullable=True)
    # Platform-level enable/disable (superadmin). A disabled org's users can't log in.
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    # Signup approval workflow: 'pending' (awaiting superadmin approval) | 'approved'.
    # Self-signup orgs start 'pending' + is_active False; superadmin-created/existing
    # orgs are 'approved'. Login is blocked until approved (via is_active).
    approval_status = Column(
        String(20), nullable=False, default="approved", server_default=text("'approved'")
    )
    # fixes65 §1: the org's branded public landing page (/org/<slug>) —
    # subtitle + photo gallery (list of image URLs) + the self-registration
    # switch (default off). slug is null until an admin publishes the page.
    slug = Column(String(80), nullable=True, unique=True, index=True)
    public_subtitle = Column(Text, nullable=True)
    public_gallery = Column(JSON, nullable=True)
    self_registration_enabled = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
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
    # fixes43 §5.1: FK to `roles.name` (was a flat, unconstrained string) — the
    # stored value and every existing `.role == "admin"` comparison across the
    # app are unchanged, only now DB-validated against the roles table.
    role = Column(String(20), ForeignKey("roles.name"), nullable=False, default="staff")
    is_active = Column(Boolean, nullable=False, default=True)
    email_verified = Column(Boolean, nullable=False, default=False)
    # fixes61 §2: an activist tracked in the system with no login of their
    # own (no email required, welcome email skipped) — distinct from
    # is_active, which means "login currently enabled/disabled".
    is_manual = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    # fixes65 §5/§7: 'public' (org landing page) | 'qr' (task claim flow) for
    # a self-registered activist; null for every admin-provisioned account.
    registration_source = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    organization = relationship("Organization", back_populates="users")
    role_ref = relationship("Role")
    contacts = relationship(
        "Contact",
        back_populates="assigned_user",
        foreign_keys="Contact.assigned_user_id",
    )


class Contact(Base):
    """Core CRM contact. Type-specific data lives in contact_mekurav / contact_shliach."""

    __tablename__ = "contacts"
    __table_args__ = (
        # Phone is the business key: unique within an organization.
        UniqueConstraint("organization_id", "phone", name="uq_contact_org_phone"),
        # Code review hardening: covers owner-scoped contact lookups
        # (organization_id + assigned_user_id), the most common non-trivial
        # filter combination in routers/contacts.py.
        Index("ix_contacts_org_assigned_user", "organization_id", "assigned_user_id"),
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
    # fixes32: pipeline_status/color_tag (picklist-backed) moved to PicklistLink.
    priority_score = Column(Integer, nullable=True)
    # Where the contact came from: 'crm' (created in the app) | 'instinct'
    # (the Instinct API, docs/system_api.md).
    source = Column(String(20), nullable=False, default="crm", server_default="crm")
    # 'active' | 'draft'. Instinct-created contacts land as 'draft' and stay out
    # of the regular contacts lists until approved (POST /api/contacts/{id}/approve).
    status = Column(
        String(20), nullable=False, default="active", server_default="active", index=True
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    assigned_user = relationship(
        "User", back_populates="contacts", foreign_keys=[assigned_user_id]
    )
    # fixes25: the community checklist (Mivtzoim), interactions and custom-field
    # values moved to the visit level — every visit logs what happened on it.
    mekurav = relationship(
        "ContactMekurav",
        back_populates="contact",
        uselist=False,
        cascade="all, delete-orphan",
    )
    # fixes45: ContactShliach is versioned now (contact_id is no longer
    # unique) — scope this relationship to the active version so every
    # existing `contact.shliach.x` read/write site keeps working unchanged.
    # No ORM cascade: `ContactShliach.contact_id` cascades at the DB level
    # (ondelete="CASCADE"), which cleans up every version, not just the one
    # this relationship can see. fixes64: `passive_deletes=True` is required
    # for that DB-level cascade to actually apply — without it, SQLAlchemy's
    # default one-to-one delete handling still tries to NULL this relationship's
    # FK on flush (contact_shliach.contact_id is NOT NULL), raising an
    # IntegrityError on every shliach-contact delete.
    shliach = relationship(
        "ContactShliach",
        back_populates="contact",
        uselist=False,
        primaryjoin="and_(Contact.id==ContactShliach.contact_id, "
        "ContactShliach.is_display==True)",
        passive_deletes=True,
    )
    # Contact-specific records: removed with the contact (FKs are enforced under
    # PostgreSQL, so these must be cascaded or the delete fails).
    visits = relationship(
        "VisitHistory",
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
    # fixes32: potential_next_step (picklist-backed) moved to PicklistLink.
    # fixes25: rebbe_connection moved to visit_history.connection_to_rebbe.
    recommendations = Column(Text, nullable=True)  # המלצות
    background = Column(Text, nullable=True)  # רקע
    # NOTE (fixes32): every picklist-backed attribute (Jewish_status, affiliation,
    # language, potential_next_step, and any admin-defined picklist) is stored
    # generically in `picklist_links` — no hardcoded columns.

    contact = relationship("Contact", back_populates="mekurav")
    apartment = relationship("Apartment", back_populates="mekuravim")
    admin_area = relationship("AdminArea", back_populates="mekuravim")
    special_dates = relationship(
        "ContactMekuravSpecialDate",
        back_populates="mekurav",
        cascade="all, delete-orphan",
    )


class ContactShliach(Base):
    """Shliach-specific data for a contact of type 'shliach'. Versioned
    (fixes45, same pattern as `Apartment`): an update retires the current row
    (`is_display=False`, stamped with `last_edit`/`editor_id`) and inserts a
    new active row; `root_id` chains every version to the lineage's first row
    (NULL = the row is its own root). `contact_id` is therefore NOT unique —
    it identifies the lineage, not a single row; exactly one row per lineage
    has `is_display=True`. `full_name`/`email`/`phone` are a versioned
    snapshot mirroring the linked login `User`/`Contact` at the time of the
    edit (whichever surface — the Users page or the contact's shliach form —
    made it), so both feed the same history. `report_numbers`/`areas` (the
    M2M coverage links) are copied forward onto each new version, exactly
    like Apartment's picklist_links — a retired row's own links are left
    untouched as a frozen snapshot, so no separate diff log is needed.

    A shliach also gets a login `User` (role 'shliach'), linked via `user_id`.
    """

    __tablename__ = "contact_shliach"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer,
        ForeignKey("contacts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)  # הערות
    # fixes45: versioned snapshot of the shliach's identity (mirrors the
    # linked User/Contact) — see class docstring.
    full_name = Column(String(100), nullable=True)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    # fixes45 — versioning columns (same shape as Apartment's, fixes19 §3).
    # Both FKs SET NULL at the DB level: editor_id must never block a user
    # delete, and root_id is self-referential — bulk/cascade deletes would
    # otherwise trip over row ordering.
    is_display = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    last_edit = Column(DateTime, nullable=True)  # when this version was retired
    editor_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )  # who retired it
    root_id = Column(
        Integer,
        ForeignKey("contact_shliach.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    contact = relationship("Contact", back_populates="shliach")
    user = relationship("User", foreign_keys=[user_id])
    editor = relationship("User", foreign_keys=[editor_id])
    report_numbers = relationship(
        "ReportNumberContactShliach",
        back_populates="shliach",
        cascade="all, delete-orphan",
    )
    areas = relationship(
        "ContactShliachArea",
        back_populates="shliach",
        cascade="all, delete-orphan",
    )


class ReportNumber(Base):
    """A report number (מספר דוח, fixes19) — an org-scoped named entity that
    shluchim (M2M) and apartments (FK) are associated with."""

    __tablename__ = "report_number"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String(150), nullable=False)  # שם
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    shluchim = relationship(
        "ReportNumberContactShliach",
        back_populates="report_number",
        cascade="all, delete-orphan",
    )


class ShliachReportCompletion(Base):
    """fixes53 §7/§9: an activist's self-reported reporting status, from the
    "Report completed" button on their self-edit page (3-choice modal + an
    optional comment). One row per submission — an append-only log so
    /dashboard/messages-from-activists can show history, not just the latest
    state. Keyed by `contact_id` (stable) rather than `contact_shliach_id`
    (versioned — every edit retires and replaces that row, fixes45), so a
    later profile edit never orphans an older submission."""

    __tablename__ = "shliach_report_completions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 'completed' | 'not_completed' | 'partial'
    status = Column(String(30), nullable=False)
    comments = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    contact = relationship("Contact")


class ShliachSystemComment(Base):
    """fixes53 §7/§9: free-text feedback about the system, from the
    "Comments about the system" button on an activist's self-edit page.
    Keyed by `contact_id` for the same reason as ShliachReportCompletion."""

    __tablename__ = "shliach_system_comments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    contact = relationship("Contact")


class ShliachAnnouncement(Base):
    """fixes54 §5: an admin-authored announcement shown in the feed on an
    activist's dedicated landing page (`/dashboard/activist`). `is_visible`
    lets an admin draft/retire a message without deleting its row."""

    __tablename__ = "shliach_announcements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    message_title = Column(String(255), nullable=False)
    message_content = Column(Text, nullable=False)  # HTML, from the WYSIWYG editor
    is_visible = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )


class ReportNumberContactShliach(Base):
    """M2M: which report numbers a shliach covers (fixes19 — replaces the
    dropped contact_shliach_apartment coverage)."""

    __tablename__ = "report_number_contact_shliach"
    __table_args__ = (
        UniqueConstraint(
            "report_number_id", "contact_shliach_id", name="uq_report_shliach"
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    report_number_id = Column(
        Integer,
        ForeignKey("report_number.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    contact_shliach_id = Column(
        Integer,
        ForeignKey("contact_shliach.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    report_number = relationship("ReportNumber", back_populates="shluchim")
    shliach = relationship("ContactShliach", back_populates="report_numbers")


class Campaign(Base):
    """fixes58 §2.1: an org-scoped named campaign a Task belongs to. Plain
    mutable row (not versioned like Apartment/ContactShliach) — nothing in the
    spec asks for edit history here, matching ShliachAnnouncement's shape
    (row + is_active toggle + timestamps). Soft-deleted via `deleted_at` so a
    Task's `campaign_id` FK never dangles."""

    __tablename__ = "campaigns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    name = Column(String(150), nullable=False)
    is_active = Column(Boolean, nullable=False, default=False)
    # Template for the activist-homepage stat tile, e.g.
    # "{{count}} Jews received a Menorah" (fixes58 §3.1/§3.2).
    custom_stats_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )
    deleted_at = Column(DateTime, nullable=True)

    tasks = relationship("Task", back_populates="campaign")


class Task(Base):
    """fixes58 §2.2: a unit of work assigning a volunteer (shliach-role User)
    to one or more report numbers, under a Campaign. `volunteer_user_id` FKs
    `users.id` directly (not ContactShliach) — the spec's own workflow (a
    quick-action button on the Users/"Volunteers" page) and field name point
    at a real login, sidestepping the linked-vs-email-fallback shliach
    identity complexity `resolve_shliach()` exists for. `status` is a plain
    validated string (ACTIVE|COMPLETED|PAUSED), matching how every other
    status-like field in this codebase avoids a DB-level enum."""

    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    # No ondelete cascade: a Campaign with live Tasks can't be hard-deleted
    # (soft-delete only), matching Campaign's own soft-delete design.
    campaign_id = Column(Integer, ForeignKey("campaigns.id"), nullable=False, index=True)
    # fixes65 §2: nullable — a task created with "Assign Later" is an
    # orphan in the unassigned pool until claimed (QR) or assigned by an admin.
    volunteer_user_id = Column(
        Integer, ForeignKey("users.id"), nullable=True, index=True
    )
    # fixes58 §3.3: an admin-defined picklist option under entity_type="task"
    # (e.g. "First Candle of Hanukkah") — a PicklistValue row, not a
    # PicklistDefinition (the spec's ER diagram names the wrong table).
    custom_date_value_id = Column(
        Integer, ForeignKey("picklist_values.id"), nullable=True
    )
    status = Column(String(20), nullable=False, default="ACTIVE")
    volunteer_report_summary = Column(Text, nullable=True)
    # fixes65 §4 claim audit: when/how the task left the orphan pool —
    # 'qr' (scanned printout), 'paper' (office entered the paper sheet; locks
    # the task even with no registered performer). Cleared on unassign.
    claimed_at = Column(DateTime, nullable=True)
    claimed_via = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow
    )

    campaign = relationship("Campaign", back_populates="tasks")
    volunteer = relationship("User")
    custom_date_value = relationship("PicklistValue")
    report_numbers = relationship(
        "TaskReportNumber", back_populates="task", cascade="all, delete-orphan"
    )


class TaskPaperEntry(Base):
    """fixes65 §6: one office data-entry session from a physical task sheet.
    Attribution is exactly one of: a registered user (`performer_user_id`),
    a free-text name (`performer_name` — no user account is created), or
    `performer_unknown`. The apartment edits themselves are ordinary
    versioned apartment updates (editor = the entering admin)."""

    __tablename__ = "task_paper_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    task_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    performer_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    performer_name = Column(String(150), nullable=True)
    performer_unknown = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    entered_by_user_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    apartment_count = Column(Integer, nullable=False, default=0, server_default="0")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    performer = relationship("User", foreign_keys=[performer_user_id])
    entered_by = relationship("User", foreign_keys=[entered_by_user_id])


class TaskReportNumber(Base):
    """fixes58 §2.3: M2M — which report numbers a Task covers. Access control
    (`_shliach_apartment_ids`) walks this table to find apartments visible to
    a volunteer through an ACTIVE Task under an active Campaign."""

    __tablename__ = "task_report_numbers"
    __table_args__ = (
        UniqueConstraint("task_id", "report_number_id", name="uq_task_report_number"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    task_id = Column(
        Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    report_number_id = Column(
        Integer,
        ForeignKey("report_number.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    task = relationship("Task", back_populates="report_numbers")
    report_number = relationship("ReportNumber")


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


class BuildingType(Base):
    """fixes63: the fixed set of building type identifiers ('building' |
    'town_house' | 'divided_town_house'), global like `Role` — every org
    shares the same small set. Unlike `Role`, display labels live directly on
    the row (`name_en`/`name_he`) rather than in `field_localization`: this is
    a small, closed reference list an admin never renames, so there is no
    separate presentation layer to keep in sync."""

    __tablename__ = "building_type"

    id = Column(String(50), primary_key=True)
    name_en = Column(String(100), nullable=False)
    name_he = Column(String(100), nullable=False)


class Building(Base):
    __tablename__ = "buildings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    # fixes33 §2.2: nullable so an area can be deleted while its buildings are
    # kept (Option B unassigns them instead of cascading the delete).
    area_id = Column(Integer, ForeignKey("areas.id"), nullable=True, index=True)
    building_name = Column(String(150), nullable=True)  # שם בניין (optional, fixes7)
    building_address = Column(Text, nullable=True)  # כתובת בניין (required at the API)
    longitude = Column(Float, nullable=True)
    latitude = Column(Float, nullable=True)
    # fixes19 §4: a town house (בית פרטי) gets no floors — creation spawns a
    # single apartment instead.
    is_town_house = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # fixes63: explicit categorization, replacing the old "-th"-suffix string
    # heuristic. Set to 'town_house' at creation alongside is_town_house, then
    # flipped to 'divided_town_house' if a second apartment unit is later
    # added (see routers/apartments.py create_apartment).
    building_type_id = Column(
        String(50),
        ForeignKey("building_type.id"),
        nullable=False,
        default="building",
        server_default=text("'building'"),
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    area = relationship("Area", back_populates="buildings")
    building_type = relationship("BuildingType")
    apartments = relationship(
        "Apartment", back_populates="building", cascade="all, delete-orphan"
    )
    floors = relationship(
        "Floor",
        back_populates="building",
        cascade="all, delete-orphan",
        order_by="Floor.sort_order, Floor.id",
    )

    @property
    def is_townhouse(self) -> bool:
        """fixes63: true for a plain (undivided) town house — drives the
        small-house icon in the UI. False for a regular building or a town
        house that's since been split into multiple apartment units."""
        return self.building_type_id == "town_house"


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
    """An apartment. Versioned (fixes19 §3): an update retires the current row
    (`is_display=False`, stamped with `last_edit`/`editor_id`) and inserts a new
    active row. `root_id` chains every version to the lineage's first row
    (NULL = the row is its own root); exactly one row per lineage has
    `is_display=True`."""

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
    # fixes32: jewish_status/campaign_status/mezuzah_status/language (picklist-
    # backed) moved to PicklistLink, keyed by this row's own (versioned) id.
    name = Column(String(150), nullable=True)  # שם דייר (resident)
    phone = Column(String(50), nullable=True)  # טלפון (validated at the API)
    email = Column(String(255), nullable=True)  # אימייל (validated at the API)
    # fixes19 §1: linked report number (מספר דוח).
    report_number_id = Column(
        Integer, ForeignKey("report_number.id"), nullable=True, index=True
    )
    # fixes19 §3 — versioning columns. Both FKs SET NULL at the DB level:
    # editor_id must never block a user delete, and root_id is self-referential
    # — bulk/cascade deletes would otherwise trip over row ordering.
    is_display = Column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    last_edit = Column(DateTime, nullable=True)  # when this version was retired
    editor_id = Column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )  # who retired it
    root_id = Column(
        Integer,
        ForeignKey("apartments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    building = relationship("Building", back_populates="apartments")
    mekuravim = relationship("ContactMekurav", back_populates="apartment")
    report_number = relationship("ReportNumber")
    editor = relationship("User", foreign_keys=[editor_id])


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
    # fixes32: special_date_type (picklist-backed) moved to PicklistLink.
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
    """A visit (היסטורית ביקורים). Many per contact; may be unlinked to a contact.

    fixes25: visits carry the engagement data that used to sit on the contact —
    an `interactions` JSON log and the torah thought (picklist-backed).
    fixes39: the Mivtzoim boolean flags and the connection-to-the-Rebbe note
    moved off dedicated columns onto ordinary custom-field values.
    """

    __tablename__ = "visit_history"
    __table_args__ = (
        # Code review hardening: visit_date had no index at all, despite
        # being the primary date-range filter (visits_summary, the contacts
        # date-range filter) — always combined with organization_id.
        Index("ix_visit_history_org_visit_date", "organization_id", "visit_date"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    contact_id = Column(
        Integer, ForeignKey("contacts.id"), nullable=True, index=True
    )  # איש קשר (optional)
    visit_date = Column(DateTime, nullable=False)  # תאריך
    # fixes32: visit_type / torah_thought (picklist-backed) moved to PicklistLink.
    location = Column(Text, nullable=True)  # מיקום
    notes = Column(Text, nullable=True)  # הערות
    # fixes25: [{category, note, created_at, author_name}] (picklist interaction.category)
    interactions = Column(JSON, nullable=True)
    # fixes39: the Mivtzoim booleans (tefillin/tzedakah/shabbat_candles/
    # torah_pamphlet/letter_in_torah) and connection_to_rebbe used to be real
    # columns here — they are now ordinary entity_type="visit" custom fields
    # (CustomFieldDefinition/CustomFieldValue), the same mechanism org-added
    # checklist items ("mezuzah" etc.) already used. See
    # app.seed.seed_visit_mivtzoim_custom_fields.
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    contact = relationship("Contact", back_populates="visits")
    custom_values = relationship(
        "CustomFieldValue",
        back_populates="visit",
        cascade="all, delete-orphan",
    )


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


# fixes25: `CommunityChecklist` (Mivtzoim) and `Interaction` were contact-level
# tables; both moved onto `visit_history` (boolean columns / JSON log) and the
# tables were dropped by the fixes25 migration.


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
    # fixes40 §3: display order within the field's section on dashboard/fields
    # and the entity detail pages. NULL (no row, or a row never given an
    # order) means "unordered" — falls after every explicitly-ordered field,
    # in its original registry position, so untouched orgs render unchanged.
    sort_order = Column(Integer, nullable=True)


class CustomFieldDefinition(Base):
    """Admin-defined per-org custom field (fixes35: any of `entity_type` x
    `field_type`; originally visit-only boolean+note, generalized in place).

    `field_type == "select"` is special: its options and selected values
    live entirely in `PicklistDefinition`/`PicklistValue`/`PicklistLink`
    (this definition just derives that picklist's `system_name` by
    convention — see `app/custom_field_utils.py`) — no `CustomFieldValue`
    row is ever written for a select-type definition."""

    __tablename__ = "custom_field_definitions"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "entity_type", "field_key",
            name="uq_customfield_org_entity_key",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    # fixes35: which entity this field attaches to. Existing (pre-fixes35)
    # rows are all visit-scoped — default preserves that with zero backfill.
    entity_type = Column(String(30), nullable=False, default="visit")
    field_key = Column(String(100), nullable=False)  # technical key, e.g. 'hanuka_party'
    hebrew_label = Column(String(100), nullable=False)
    english_label = Column(String(100), nullable=True)
    # fixes35: text | number | boolean | date | select. Existing rows are all
    # the original boolean+note checklist shape.
    field_type = Column(String(20), nullable=False, default="boolean")
    sort_order = Column(Integer, default=0, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    values = relationship(
        "CustomFieldValue",
        back_populates="definition",
        cascade="all, delete-orphan",
    )


class CustomFieldValue(Base):
    """One entity's value for a custom field definition (fixes35: any
    non-select field_type; select-type values live in PicklistLink instead).

    `entity_table`/`entity_id` (no real FK — polymorphic across several
    parent tables, mirrors `PicklistLink`) is the current, generic lookup
    key. `visit_id`/`checked`/`note` are the original (fixes25) boolean+note
    visit-only shape — kept, and still populated whenever
    `entity_table == "visit_history"`, purely so `VisitHistory.custom_values`
    (the visit-delete cascade) and any pre-fixes35 backup snapshot keep
    working unchanged. New non-visit or non-boolean values only ever use
    `entity_table`/`entity_id`/`value`."""

    __tablename__ = "custom_field_values"
    __table_args__ = (
        UniqueConstraint(
            "entity_table", "entity_id", "definition_id",
            name="uq_customval_entity_def",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    # fixes35: every other org-scoped model carries its own organization_id
    # (this one didn't, which is why core/backup.py and routers/admin.py both
    # had to special-case it via a visit_id join — this column removes the
    # need for that).
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    entity_table = Column(String(50), nullable=True, index=True)
    entity_id = Column(Integer, nullable=True, index=True)
    # Legacy (fixes25): kept for VisitHistory's cascade relationship below and
    # for restoring pre-fixes35 backup snapshots — never read by new code.
    visit_id = Column(
        Integer, ForeignKey("visit_history.id"), nullable=True, index=True
    )
    definition_id = Column(
        Integer, ForeignKey("custom_field_definitions.id"), nullable=False, index=True
    )
    checked = Column(Boolean, default=False, nullable=False)
    note = Column(Text, nullable=True)
    # fixes35: text/number/date storage as a string (parsed/validated at the
    # API boundary, exactly like PicklistValue.value has no DB-level type).
    value = Column(Text, nullable=True)

    visit = relationship("VisitHistory", back_populates="custom_values")
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
    # fixes37: which logical entity this picklist belongs to —
    # "contact_mekurav" | "contact_shliach" | "apartment" | "visit" |
    # "significant_date" (matches CustomFieldDefinition.entity_type's
    # vocabulary). Previously only implicit in system_name's string prefix,
    # re-derived independently by every consumer, including the backend's
    # own now-removed field_registry.picklist_entity() (see
    # fixes37-plan.md); now a real column, set explicitly at creation.
    entity_type = Column(String(30), nullable=False, default="contact_mekurav")
    is_system = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    # fixes51 §2.2: True lets an entity carry more than one selected value for
    # this field (one `PicklistLink` row per value instead of exactly one) —
    # only `apartment.language` is seeded this way today.
    allow_multiple = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class PicklistLink(Base):
    """Generic normalized store for every picklist-backed field's selected
    value (fixes32): one row per (entity row, picklist field), pointing at a
    real `picklist_values.id` rather than storing the technical token as text.
    Replaces both the old hardcoded picklist columns (Apartment.jewish_status,
    Contact.pipeline_status, VisitHistory.torah_thought, ...) and the old
    contact-only `ContactPicklistValue` table.

    `entity_table` names the owning model's table (`"apartments"`,
    `"contacts"`, `"contact_mekurav"`, `"visit_history"`,
    `"significant_dates"`) — there's no single FK target since one row here
    can belong to any of them. Apartments are versioned (every edit inserts a
    new row with a new id); `entity_id` for `entity_table="apartments"` is the
    per-version row's own id, so historical snapshots keep their own value —
    the apartments router copies links forward onto each new version's id,
    mirroring how the other versioned columns are copied.
    """

    __tablename__ = "picklist_links"
    __table_args__ = (
        # fixes51 §2.2: `picklist_value_id` joined the uniqueness key so a
        # multi-value field (`PicklistDefinition.allow_multiple`) can carry
        # more than one link row — single-value fields still get exactly one
        # row because `picklist_utils.set_value` upserts in place.
        UniqueConstraint(
            "entity_table", "entity_id", "picklist_definition_id", "picklist_value_id",
            name="uq_picklist_link_entity_field",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    entity_table = Column(String(50), nullable=False, index=True)
    entity_id = Column(Integer, nullable=False, index=True)
    picklist_definition_id = Column(
        Integer, ForeignKey("picklists.id"), nullable=False, index=True
    )
    picklist_value_id = Column(
        Integer, ForeignKey("picklist_values.id"), nullable=False, index=True
    )
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
    )

    definition = relationship("PicklistDefinition")
    picklist_value = relationship("PicklistValue")


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


class OrganizationPreference(Base):
    """fixes54 §8: a platform-superadmin-managed feature toggle for one
    organization — e.g. whether the Area/Building/Apartment/Activist modules
    or the AI query feature are enabled for that tenant. Same key-value-JSON
    shape as UserPreference (one row per org+key), scoped to `organization_id`
    instead of `user_id`. See app/core/org_prefs.py for the toggle keys and
    the cascading effective-value logic (turning a module off forces every
    module beneath it off too, regardless of that module's own stored value)."""

    __tablename__ = "organization_prefs"
    __table_args__ = (
        UniqueConstraint("organization_id", "key", name="uq_orgpref_org_key"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    guid = _guid_column()
    organization_id = Column(
        Integer, ForeignKey("organizations.id"), nullable=False, index=True
    )
    key = Column(String(100), nullable=False)  # e.g. 'area_display_enabled'
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
