# DATABASE.md

This document defines the database schema, relational structures, and complete SQLAlchemy object-relational mapping models for the bilingual Mini CRM MVP.

> **Multi-tenant SaaS:** every customer is an `organization`. Tenant-scoped tables carry
> `organization_id` and are isolated by it in every query. `field_localization` is global.
> The standalone `regions` table was removed — `אזור` is now the admin-managed picklist
> `contact.area`.
>
> **GUIDs:** every table has a `guid` column (unique, auto-generated UUID) alongside its integer
> `id`. Integer ids stay the internal/route key; GUIDs are for external references/sync.
>
> **Contact key:** `contacts.phone` is **optional** (nullable since the data import) and
> **unique per organization** when present.
>
> **fixes25 (visit restructuring):** the `interactions` and `community_checklists` tables were
> **dropped**. Engagement data lives on `visit_history`: an `interactions` JSON log, the Mivtzoim
> booleans (`tefillin`, `tzedakah`, `shabbat_candles`, `torah_pamphlet`, `letter_in_torah`),
> `torah_thought` and `connection_to_rebbe` (moved from `contact_mekurav.rebbe_connection`).
> `custom_field_values` re-pointed from contacts to visits (`visit_id`). Sections below that
> mention the old contact-level structures are historical — `backend/app/models.py` is
> authoritative.

## Relational Schema Diagram

```text
  [organizations] ─1─* [users] ─── (manages) ───► [contacts]
                                                      │
                                                      ├─── (has historical) ───► [interactions]
                                                      │
                                                      └─── (1:1 details/mitzvot) ► [community_checklists]

  [picklist_values] (per-org) ··· (constrains, by field_key — no FK) ···
        contacts.area, contacts.pipeline_status, contacts.color_tag,
        contacts.potential_next_step, community_checklists.torah_thought, interactions.category
```

---

## Database Tables Reference

1. **`organizations`**: Tenants. `name` is used as the app title.
2. **`users`**: Auth records + profile (email global-unique, username unique per org, role,
   `is_active`, `email_verified`).
3. **`contacts`**: Core identity, area, status/color/potential picklists, priority, first-visit,
   and free-text (rebbe connection, recommendations, background).
4. **`community_checklists`**: 1:1 with a contact — 5 mitzvot booleans each with a matching note
   (`tefillin`/`tefillin_notes`, `tzedakah`/`charity_note`, `shabbat_candles`/`shabbat_candles_notes`,
   `torah_pamphlet`/`torah_pamphlet_notes`, `torah_letter`/`letter_torah_notes`) + the
   `torah_thought` picklist.
5. **`interactions`**: 1-to-many continuous historical interaction log matrix.
6. **`field_localization`**: Global metadata mapping English schema names → Hebrew UI labels.
7. **`picklist_values`**: Per-org, admin-managed dropdown options. Registry of managed field_keys:
   `contact.area`, `contact.pipeline_status`, `contact.color_tag`, `contact.potential_next_step`,
   `checklist.torah_thought`, `interaction.category`.
8. **`custom_field_definitions`**: Per-org, admin-defined custom checklist fields (each a
   boolean + note + Hebrew label). Unique on `(organization_id, field_key)`.
9. **`custom_field_values`**: A contact's value (`checked` + `note`) for a custom field definition.
   Unique on `(contact_id, definition_id)`; cascades on contact/definition delete.

---

## Complete SQLAlchemy Models (`models.py`)

> **Authoritative source:** `backend/app/models.py`. The snippet below is illustrative and may lag
> the code. Current key fields after the SaaS + field-expansion work:
>
> - **All tables:** `guid` (unique UUID) alongside the integer `id`.
> - **Contact:** `organization_id`, `name`, `last_name`, `phone` (required, unique per org),
>   `assigned_user_id`, `address`, `latitude`, `longitude`, `area` (picklist),
>   `pipeline_status` (picklist), `potential_next_step` (picklist), `color_tag` (picklist),
>   `priority_score`, `first_visit` (datetime), `rebbe_connection`, `recommendations`, `background`.
>   *(`region_id` removed.)*
> - **CommunityChecklist (1:1):** `tefillin`/`tefillin_notes`, `tzedakah`/`charity_note`,
>   `shabbat_candles`/`shabbat_candles_notes`, `torah_pamphlet`/`torah_pamphlet_notes`,
>   `torah_letter`/`letter_torah_notes`, and `torah_thought` (picklist, replaces `dvar_torah`).
> - **CustomFieldDefinition:** `organization_id`, `field_key`, `hebrew_label`, `sort_order`,
>   `is_active`. **CustomFieldValue:** `contact_id`, `definition_id`, `checked`, `note`.
> - **User:** `organization_id`, `username` (unique per org), `email` (global-unique), `first_name`,
>   `last_name`, `phone`, `role`, `is_active`, `email_verified`.
> - **Organization:** `id`, `name`, `map_in_english`, `created_at`.

Below is the complete implementation code for the database schema using SQLAlchemy 2.0 style syntax:

```python
import datetime
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=False)  # Stored in Hebrew (e.g., "אלכס")
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, default="staff")  # 'admin' | 'staff' — admins manage picklists
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    contacts = relationship("Contact", back_populates="assigned_user")
    interactions = relationship("Interaction", back_populates="author")


class Region(Base):
    __tablename__ = "regions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)  # Stored in Hebrew (e.g., "משרד גדול")

    # Relationships
    contacts = relationship("Contact", back_populates="region")


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(150), nullable=False, index=True)  # Stored in Hebrew (e.g., "ריכמן אלי")
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=True)
    assigned_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    address = Column(Text, nullable=True)  # Context text (e.g., "735 Desmond Ct")
    pipeline_status = Column(String(50), nullable=True)  # E.g., 'קולח', 'שלח'
    priority_score = Column(Integer, nullable=True)  # פוטנציאל לצד
    color_tag = Column(String(20), nullable=True)  # Hex or keyword for row shading
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    region = relationship("Region", back_populates="contacts")
    assigned_user = relationship("User", back_populates="contacts")
    checklist = relationship("CommunityChecklist", back_populates="contact", uselist=False, cascade="all, delete-orphan")
    interactions = relationship("Interaction", back_populates="contact", cascade="all, delete-orphan")


class CommunityChecklist(Base):
    __tablename__ = "community_checklists"

    contact_id = Column(Integer, ForeignKey("contacts.id"), primary_key=True)
    tefillin = Column(Boolean, default=False, nullable=False)
    tzedakah = Column(Boolean, default=False, nullable=False)
    shabbat_candles = Column(Boolean, default=False, nullable=False)
    torah_pamphlet = Column(Boolean, default=False, nullable=False)
    dvar_torah = Column(Boolean, default=False, nullable=False)
    torah_letter = Column(Boolean, default=False, nullable=False)

    # Relationships
    contact = relationship("Contact", back_populates="checklist")


class Interaction(Base):
    __tablename__ = "interactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    category = Column(String(50), nullable=False)  # 'heart_connection', 'recommendation', 'background'
    note = Column(Text, nullable=False)  # Stored in Hebrew (e.g., "עשיתי, לבדוק שמה")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    contact = relationship("Contact", back_populates="interactions")
    author = relationship("User", back_populates="interactions")


class FieldLocalization(Base):
    __tablename__ = "field_localization"

    id = Column(Integer, primary_key=True, autoincrement=True)
    entity_type = Column(String(50), nullable=False)  # 'table', 'column', 'interaction_category'
    technical_name = Column(String(100), nullable=False, unique=True)  # E.g., 'shabbat_candles'
    hebrew_label = Column(String(100), nullable=False)  # E.g., 'נרות שבת'


class PicklistValue(Base):
    """Admin-managed dropdown options for constrained fields.

    Keeps the *technical* English value in the column (separation of storage),
    while exposing a Hebrew label, ordering, color, and active flag to the UI.
    Identify the owning field via `field_key`, e.g.:
      - 'contact.pipeline_status'
      - 'contact.color_tag'
      - 'interaction.category'
    """
    __tablename__ = "picklist_values"
    __table_args__ = (UniqueConstraint("field_key", "value", name="uq_picklist_field_value"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    field_key = Column(String(100), nullable=False, index=True)  # owning field, e.g. 'contact.pipeline_status'
    value = Column(String(100), nullable=False)        # technical stored value (English), e.g. 'in_progress'
    hebrew_label = Column(String(100), nullable=False) # UI label, e.g. 'בתהליך'
    color_hint = Column(String(20), nullable=True)     # optional row/badge color (Magenta, Yellow, ...)
    sort_order = Column(Integer, default=0, nullable=False)  # display ordering within the list
    is_active = Column(Boolean, default=True, nullable=False)  # soft-disable without deleting history
    is_default = Column(Boolean, default=False, nullable=False)  # preselected option for new records
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
```

> **Import note:** add `UniqueConstraint` to the `sqlalchemy` import at the top of `models.py`:
> `from sqlalchemy import ..., UniqueConstraint`.

***

### 💡 Validation and Execution Note
By organizing the infrastructure this way, Claude CLI can safely interact with the data models without encountering decoding runtime exceptions during string evaluations. Meanwhile, your user-facing interfaces will remain 100% compliant with standard native Hebrew formatting layouts.

<FollowUp>
Now that the data specifications are set, I can help you with the next layer:
* Create the complete **FastAPI authentication endpoints router file (`auth.py`)** with password hashing using passlib/bcrypt.
* Write a **Python setup script (`seed.py`)** that populates your SQLite tables with database instances matching your spreadsheet's structure.

Let me know **how you'd like to proceed**!
</FollowUp>
