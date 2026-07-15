"""Pydantic request/response schemas."""
import re
from datetime import datetime, time
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["admin", "staff", "shliach"]
ContactType = Literal["mekurav", "shliach"]

# Phone: Israeli (+972 / 0 prefix) or North-American (NANP). Mirrors the frontend
# check in lib/validation.ts so client and server agree.
_PHONE_RE = re.compile(
    r"^(\+972|0)(5\d{8}|[2-489]\d{7})$|^(\+?1)?[2-9]\d{2}[2-9]\d{6}$"
)


def _validate_phone(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    cleaned = re.sub(r"[\s\-().]", "", value)
    if not _PHONE_RE.match(cleaned):
        raise ValueError(
            "Invalid phone number — expected an Israeli or US/Canada number"
        )
    return value


def _normalize_email(value: Optional[str]) -> Optional[str]:
    """Emails are case-insensitive identifiers — store them lowercased (fixes14:
    Google ID tokens always carry the address lowercased, so a mixed-case stored
    email made the login lookup miss and return 403). Blank normalizes to NULL."""
    if value is None:
        return None
    cleaned = value.strip().lower()
    return cleaned or None


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: Role = "staff"
    email: Optional[str] = None
    organization_name: Optional[str] = None

    _email_lower = field_validator("email")(_normalize_email)


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    name: str
    logo_url: Optional[str] = None
    map_in_english: bool
    default_lat: Optional[float] = None
    default_lng: Optional[float] = None
    default_zoom: int = 13
    # fixes18 §6: shliach users may view (mekurav) contacts. Default false.
    shliach_can_view_contacts: bool = False


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    map_in_english: Optional[bool] = None
    default_lat: Optional[float] = None
    default_lng: Optional[float] = None
    default_zoom: Optional[int] = None
    shliach_can_view_contacts: Optional[bool] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    username: str
    full_name: str
    # fixes14 §feature 2: full name resolved from the linked contacts row
    # (set on /api/auth/me only; None elsewhere).
    display_name: Optional[str] = None
    email: Optional[str] = None
    role: str
    is_active: bool = True
    created_at: datetime
    organization_id: int
    organization: Optional[OrganizationOut] = None


# --- Org user management (fixes7 §1: admins provision admins/staff) ---------
OrgRole = Literal["admin", "staff"]


class OrgUserCreate(BaseModel):
    """An admin provisions a user in their own org. Email is the identity —
    with no password the account signs in via Google (verified email only)."""

    full_name: str
    email: str
    role: OrgRole = "staff"
    username: Optional[str] = None  # defaults to the email
    password: Optional[str] = None  # omitted => Google-only account
    phone: Optional[str] = None

    _email_lower = field_validator("email")(_normalize_email)


class OrgUserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None  # fixes14: propagates to a linked shliach contact
    phone: Optional[str] = None
    role: Optional[OrgRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None

    _email_lower = field_validator("email")(_normalize_email)


class UserRecreateIn(BaseModel):
    """fixes26 §4: re-enable (or re-create) a shliach's login by the contact's
    email — the one-click recovery for a deleted/disabled account."""

    email: str

    _email_lower = field_validator("email")(_normalize_email)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# --- Multi-org login (fixes14 §feature 1) -----------------------------------
class OrgOption(BaseModel):
    """One selectable organization on the login org-selection screen."""

    id: int
    name: str
    logo_url: Optional[str] = None


class LoginResponse(BaseModel):
    """Login result: either a token, or (when the verified identity maps to
    more than one organization and none was chosen yet) the list to pick from."""

    access_token: Optional[str] = None
    token_type: str = "bearer"
    requires_org_selection: bool = False
    organizations: list[OrgOption] = []


# --- Platform superadmin (cross-tenant admin dashboard) --------------------
class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    username: str
    full_name: str
    email: Optional[str] = None
    role: str
    is_active: bool
    email_verified: bool
    created_at: datetime
    organization_id: int


# --- Org backup & restore (fixes16) -----------------------------------------
class BackupCreate(BaseModel):
    note: Optional[str] = None


class BackupOut(BaseModel):
    """One restore point (metadata only — the blob never leaves the server
    except via the explicit download endpoint)."""

    id: int
    guid: str
    note: Optional[str] = None
    kind: str  # 'manual' | 'auto'
    created_by_name: Optional[str] = None
    created_at: datetime
    counts: dict[str, int] = {}


class BackupRestoreResult(BaseModel):
    restored: dict[str, int]
    safety_backup_id: int


class AdminUserDependenciesOut(BaseModel):
    """What still points at a user (fixes15 §2.2) — shown in the delete-confirm
    modal so the superadmin sees the data ties before deleting a shliach."""

    assigned_contacts: int = 0
    shliach_contact_id: Optional[int] = None
    shliach_contact_name: Optional[str] = None
    covered_report_numbers: int = 0  # fixes19 (was covered apartments)
    covered_areas: int = 0
    has_dependencies: bool = False


class AdminOrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    name: str
    is_active: bool
    approval_status: str
    created_at: datetime
    user_count: int
    admin_email: Optional[str] = None
    admin_name: Optional[str] = None


class EmailTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    subject: str
    body: str
    body_hebrew: str


class EmailTemplateUpdate(BaseModel):
    subject: Optional[str] = None
    body: Optional[str] = None
    body_hebrew: Optional[str] = None


class SystemConfigOut(BaseModel):
    """The platform title configuration (fixes9 §1) — public + superadmin read."""

    title_template: str
    fallback_name: str


class SystemConfigUpdate(BaseModel):
    title_template: Optional[str] = None
    fallback_name: Optional[str] = None


class AdminOrgCreate(BaseModel):
    """Superadmin provisions an org + its (already-verified) admin directly."""
    organization_name: str
    admin_email: str
    admin_full_name: str
    admin_username: str = "admin"
    admin_password: str


class SignupRequest(BaseModel):
    organization_name: str
    organization_logo_url: Optional[str] = None
    first_name: str
    last_name: str
    email: str
    phone: str
    username: str
    password: str

    _email_lower = field_validator("email")(_normalize_email)


class ResendRequest(BaseModel):
    email: str

    _email_lower = field_validator("email")(_normalize_email)


class GoogleLoginRequest(BaseModel):
    """Google Identity Services flow: the browser posts the Google ID token.
    `organization_id` completes a multi-org selection (fixes14)."""

    credential: str
    organization_id: Optional[int] = None


class GoogleSignupRequest(BaseModel):
    """Create a new org + admin from a Google identity. Org name still required."""

    credential: str
    organization_name: str
    organization_logo_url: Optional[str] = None


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# --- Community checklist ---------------------------------------------------
# fixes25: the community checklist (Mivtzoim) schemas are gone — the flags
# live on visits now (see VisitCreate/VisitOut).


# --- Custom checklist fields (per-org, admin-defined) ----------------------
class CustomFieldDefinitionCreate(BaseModel):
    field_key: str
    hebrew_label: str
    sort_order: int = 0


class CustomFieldDefinitionUpdate(BaseModel):
    hebrew_label: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CustomFieldDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    field_key: str
    hebrew_label: str
    sort_order: int
    is_active: bool


class ContactCustomFieldOut(BaseModel):
    """A custom field merged with a visit's value (for display/editing).

    fixes25: values attach to visits (the name is kept for wire compatibility)."""

    definition_id: int
    field_key: str
    hebrew_label: str
    checked: bool
    note: Optional[str] = None


class CustomFieldValueIn(BaseModel):
    definition_id: int
    checked: bool = False
    note: Optional[str] = None


# --- Admin areas (fixes9 §2) -------------------------------------------------
class AdminAreaCreate(BaseModel):
    name: str
    comments: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name is required")
        return v.strip()


class AdminAreaUpdate(BaseModel):
    name: Optional[str] = None
    comments: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: Optional[str]) -> Optional[str]:
        # An explicit empty name is rejected; omitting the field is fine.
        if v is not None and not v.strip():
            raise ValueError("Name is required")
        return v.strip() if v is not None else None


class AdminAreaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    name: str
    comments: Optional[str] = None
    created_at: Optional[datetime] = None  # feeds date sorting (fixes15 §6)


# --- Report numbers (מספר דוח, fixes19) -------------------------------------
class ReportNumberCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name is required")
        return v.strip()


class ReportNumberUpdate(BaseModel):
    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: Optional[str]) -> Optional[str]:
        # An explicit empty name is rejected; omitting the field is fine.
        if v is not None and not v.strip():
            raise ValueError("Name is required")
        return v.strip() if v is not None else None


class ReportNumberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    name: str
    created_at: Optional[datetime] = None


# --- Areas / Buildings / Apartments ----------------------------------------
class AreaBase(BaseModel):
    area_name: str
    area_notes: Optional[str] = None
    area_polygon: Optional[str] = None  # GeoJSON


class AreaCreate(AreaBase):
    pass


class AreaUpdate(BaseModel):
    area_name: Optional[str] = None
    area_notes: Optional[str] = None
    area_polygon: Optional[str] = None


class AreaOut(AreaBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str


class AreaShliachAdd(BaseModel):
    """fixes18 §4.2: assign an existing shliach contact to cover an area."""

    contact_id: int


class FloorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    building_id: int
    name: str
    sort_order: int


class FloorCreate(BaseModel):
    name: str
    sort_order: Optional[int] = None  # appended last when omitted


class FloorUpdate(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None


class BuildingBase(BaseModel):
    area_id: int
    # fixes7 §2: building_name is optional; the address is the required field.
    building_name: Optional[str] = None
    building_address: str
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    # fixes19 §4: town house (בית פרטי) — no floors, one auto "<name>-th" unit.
    is_town_house: bool = False

    @field_validator("building_address")
    @classmethod
    def _check_address(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Address is required")
        return v


class BuildingCreate(BuildingBase):
    # Creation hook (fixes7 §3): floor names to auto-create with the building.
    # fixes8 §1A: every new building starts with floors 1..8 unless the payload
    # explicitly overrides (an explicit [] creates a building with no floors).
    floors: list[str] = Field(
        default_factory=lambda: [str(n) for n in range(1, 9)]
    )


class BuildingUpdate(BaseModel):
    area_id: Optional[int] = None
    building_name: Optional[str] = None
    building_address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    is_town_house: Optional[bool] = None

    @field_validator("building_address")
    @classmethod
    def _check_address(cls, v: Optional[str]) -> Optional[str]:
        # An explicit empty address is rejected; omitting the field is fine.
        if v is not None and not v.strip():
            raise ValueError("Address is required")
        return v


class BuildingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    area_id: int
    building_name: Optional[str] = None
    building_address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    is_town_house: bool = False
    floors: list[FloorOut] = []


class BuildingPageOut(BaseModel):
    """One server-side page of the buildings list (fixes12 §3.3)."""

    items: list[BuildingOut]
    total: int
    page: int
    page_size: int


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: Optional[str]) -> Optional[str]:
    """RFC-pragmatic email check mirroring lib/validation.ts isValidEmail."""
    if value is None or not value.strip():
        return None
    if not _EMAIL_RE.match(value.strip()):
        raise ValueError("Invalid email address")
    return value.strip()


class ApartmentBase(BaseModel):
    building_id: int
    apartment_name: Optional[str] = None  # תווית (optional, fixes7 §4)
    apartment_notes: Optional[str] = None
    floor: Optional[str] = None
    jewish_status: Optional[str] = None
    campaign_status: Optional[str] = None
    mezuzah_status: Optional[str] = None
    language: Optional[str] = None  # picklist apartment.language (fixes13)
    name: Optional[str] = None  # resident name
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None  # מספר דוח (fixes19)

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: Optional[str]) -> Optional[str]:
        return _validate_phone(v) if v else None

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: Optional[str]) -> Optional[str]:
        return _validate_email(v)


class ApartmentCreate(ApartmentBase):
    # Optionally link an existing mekurav contact to the new apartment.
    contact_id: Optional[int] = None


class ApartmentUpdate(BaseModel):
    building_id: Optional[int] = None
    apartment_name: Optional[str] = None
    apartment_notes: Optional[str] = None
    floor: Optional[str] = None
    jewish_status: Optional[str] = None
    campaign_status: Optional[str] = None
    mezuzah_status: Optional[str] = None
    language: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: Optional[str]) -> Optional[str]:
        return _validate_phone(v) if v else None

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: Optional[str]) -> Optional[str]:
        return _validate_email(v)


class ApartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    building_id: int
    apartment_name: Optional[str] = None
    apartment_notes: Optional[str] = None
    floor: Optional[str] = None
    jewish_status: Optional[str] = None
    campaign_status: Optional[str] = None
    mezuzah_status: Optional[str] = None
    language: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None
    # Versioning metadata (fixes19 §3):
    is_display: bool = True
    last_edit: Optional[datetime] = None
    root_id: Optional[int] = None


class ApartmentVersionOut(ApartmentOut):
    """One historical apartment version (admin history view, fixes19 §3):
    the full snapshot plus who retired it and when."""

    editor_name: Optional[str] = None


class ApartmentRestoreField(BaseModel):
    """Restore one field of the active apartment to a historical version's value
    (fixes22 §2 admin per-field restore)."""

    version_id: int  # the historical apartment row to read the value from
    field: str  # which restorable data column to roll back


class ApartmentListOut(ApartmentOut):
    """Apartment enriched with its building/area context + a linked contact (if any)."""

    building_name: Optional[str] = None
    building_address: Optional[str] = None
    area_name: Optional[str] = None
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    # fixes20 §3: the linked report number's name (the id is on ApartmentOut).
    report_number_name: Optional[str] = None


class ApartmentPageOut(BaseModel):
    """One server-side page of the enriched apartment list (fixes8 §2C)."""

    items: list[ApartmentListOut]
    total: int
    page: int
    page_size: int


class ApartmentBatchCreate(BaseModel):
    """Bulk generator (fixes7 §5): the Cartesian product of floors × labels."""

    building_id: int
    floor_ids: list[int]
    labels: list[str]


class ApartmentBatchResult(BaseModel):
    created: int
    skipped: int


class ReportNumberBuildingLink(BaseModel):
    """fixes23 §2: a distinct (report number → building) pair, driving the
    conditional building filter — a building appears only while it holds an
    apartment carrying one of the selected report numbers."""

    report_number_id: int
    building_id: int


class ApartmentBulkUpdate(BaseModel):
    """fixes23 §3: apply a change to every active apartment matching the page's
    current filters. The filter block mirrors the /list query params; the
    `set_*` flags disambiguate "leave unchanged" from "clear to empty"."""

    # Filters (same semantics as GET /api/apartments/list).
    building_ids: Optional[list[int]] = None
    area_ids: Optional[list[int]] = None
    report_number_ids: Optional[list[int]] = None
    jewish_status: Optional[list[str]] = None
    mezuzah_status: Optional[list[str]] = None
    q: Optional[str] = None
    # New values — each only applied when its companion flag is true.
    set_report_number: bool = False
    report_number_id: Optional[int] = None
    set_notes: bool = False
    apartment_notes: Optional[str] = None


class ApartmentBulkUpdateResult(BaseModel):
    updated: int


# --- Significant dates + reminders -----------------------------------------
class ReminderIn(BaseModel):
    offset_minutes: int = 0
    remind_at_time: Optional[time] = None
    channel: str = "email"


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    offset_minutes: int
    remind_at_time: Optional[time] = None
    channel: str
    last_sent_at: Optional[datetime] = None


class SignificantDateBase(BaseModel):
    special_date: datetime
    hebrew_date: Optional[str] = None
    special_date_type: Optional[str] = None
    special_date_title: Optional[str] = None
    is_set_reminder: bool = False


class SignificantDateCreate(SignificantDateBase):
    reminders: list[ReminderIn] = []


class SignificantDateUpdate(BaseModel):
    special_date: Optional[datetime] = None
    hebrew_date: Optional[str] = None
    special_date_type: Optional[str] = None
    special_date_title: Optional[str] = None
    is_set_reminder: Optional[bool] = None
    reminders: Optional[list[ReminderIn]] = None


class SignificantDateOut(SignificantDateBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    reminders: list[ReminderOut] = []


# --- Mekurav / Shliach sub-payloads ----------------------------------------
class MekuravData(BaseModel):
    apartment_id: Optional[int] = None
    admin_area_id: Optional[int] = None  # אזור מנהל (fixes9 §2C)
    tzedaka_potential: Optional[str] = None  # פוטנציאל לצדקה (fixes9 §3, free text)
    first_visit: Optional[datetime] = None
    potential_next_step: Optional[str] = None
    # fixes25: rebbe_connection moved to the visit (connection_to_rebbe).
    recommendations: Optional[str] = None
    background: Optional[str] = None


class MekuravOut(MekuravData):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int


class ShliachData(BaseModel):
    notes: Optional[str] = None
    # fixes19: shluchim are associated with report numbers (the apartment
    # coverage bridge was dropped).
    report_number_ids: list[int] = []
    area_ids: list[int] = []
    # fixes14: optional password for the shliach's login user. Without one the
    # account is Google-only — which locks the shliach out entirely when
    # Google sign-in isn't available. Never returned (input only).
    password: Optional[str] = None


class ShliachOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int
    user_id: Optional[int] = None
    notes: Optional[str] = None
    report_number_ids: list[int] = []
    area_ids: list[int] = []
    # fixes26 §4: state of the linked login account, resolved like
    # core/shliach.py (user_id link, else same-org email match) —
    # 'active' | 'disabled' | 'missing'.
    login_status: Optional[str] = None


# --- Contacts --------------------------------------------------------------
class ContactBase(BaseModel):
    name: str
    last_name: Optional[str] = None
    # Optional (data import): validated + unique-per-org only when provided.
    phone: Optional[str] = None
    email: Optional[str] = None
    contact_type: ContactType = "mekurav"
    # The owning user's GUID (fixes10 §2.1); defaults to the creator (§2.2).
    assigned_user_id: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    pipeline_status: Optional[str] = None
    color_tag: Optional[str] = None
    priority_score: Optional[int] = None


class ContactCreate(ContactBase):
    mekurav: Optional[MekuravData] = None
    shliach: Optional[ShliachData] = None
    # Dynamic picklist selections: { system_name: value | None }.
    picklist_values: dict[str, Optional[str]] = {}

    # Validate on input only (not on ContactOut) so existing rows with legacy
    # bad numbers still read back without erroring. Blank normalizes to NULL.
    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: Optional[str]) -> Optional[str]:
        return _validate_phone(v) if v and v.strip() else None

    _email_lower = field_validator("email")(_normalize_email)


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    assigned_user_id: Optional[str] = None  # user GUID (fixes10 §2.1)
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    pipeline_status: Optional[str] = None
    color_tag: Optional[str] = None
    priority_score: Optional[int] = None
    mekurav: Optional[MekuravData] = None
    shliach: Optional[ShliachData] = None
    picklist_values: Optional[dict[str, Optional[str]]] = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: Optional[str]) -> Optional[str]:
        # Blank clears the phone; a provided value must be valid.
        return _validate_phone(v) if v and v.strip() else None

    _email_lower = field_validator("email")(_normalize_email)


class ContactOut(ContactBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    created_at: datetime
    updated_at: datetime
    # Enriched by /list only (fixes15 §5.1 optional grid columns): the mekurav
    # apartment's building display name + its area name (+ fixes18: the linked
    # admin-area name). None elsewhere.
    building_name: Optional[str] = None
    area_name: Optional[str] = None
    admin_area_name: Optional[str] = None


class ContactDetailOut(ContactOut):
    mekurav: Optional[MekuravOut] = None
    shliach: Optional[ShliachOut] = None
    special_dates: list[SignificantDateOut] = []
    # Dynamic picklist selections: { system_name: value }.
    picklist_values: dict[str, str] = {}


class ContactPageOut(BaseModel):
    """One server-side page of the contacts list (fixes8 §2C pattern)."""

    items: list[ContactOut]
    total: int
    page: int
    page_size: int


# fixes25: the standalone Interaction schemas are gone — interactions are a
# JSON log on the visit (see VisitInteraction).


# --- Picklists -------------------------------------------------------------
class PicklistValueCreate(BaseModel):
    value: str
    hebrew_label: str
    english_value: Optional[str] = None
    color_hint: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True
    is_default: bool = False


class PicklistValueUpdate(BaseModel):
    value: Optional[str] = None
    hebrew_label: Optional[str] = None
    english_value: Optional[str] = None
    color_hint: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


class PicklistValueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    field_key: str
    value: str
    hebrew_label: str
    english_value: Optional[str] = None
    color_hint: Optional[str] = None
    sort_order: int
    is_active: bool
    is_default: bool


class PicklistReorder(BaseModel):
    ordered_ids: list[int]


class PicklistFieldOut(BaseModel):
    """A picklist *definition* (registry entry), DB-driven and bilingual."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    field_key: str  # == system_name
    label: str  # hebrew_display_name
    english_label: Optional[str] = None
    is_system: bool = True


class PicklistDefinitionCreate(BaseModel):
    system_name: str
    hebrew_display_name: str
    english_display_name: Optional[str] = None


class PicklistDefinitionUpdate(BaseModel):
    hebrew_display_name: Optional[str] = None
    english_display_name: Optional[str] = None


# --- Localization (UI strings) ---------------------------------------------
class LocalizationOut(BaseModel):
    id: int
    entity_type: str
    technical_name: str
    hebrew_label: str
    english_label: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class LocalizationUpdate(BaseModel):
    hebrew_label: Optional[str] = None
    english_label: Optional[str] = None


class LocalizationCreate(BaseModel):
    entity_type: str = "custom"
    technical_name: str
    hebrew_label: str
    english_label: Optional[str] = None


# --- Visit history ---------------------------------------------------------
class VisitInteraction(BaseModel):
    """One entry of a visit's interaction log (fixes25 — stored as JSON on the
    visit). `created_at`/`author_name` are stamped server-side when missing."""

    category: str
    note: str
    created_at: Optional[str] = None  # ISO string inside the JSON payload
    author_name: Optional[str] = None


class VisitCreate(BaseModel):
    contact_id: Optional[int] = None
    visit_date: datetime
    visit_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    # fixes25: visit-level engagement data.
    interactions: list[VisitInteraction] = []
    tefillin: bool = False
    tzedakah: bool = False
    shabbat_candles: bool = False
    torah_pamphlet: bool = False
    letter_in_torah: bool = False
    torah_thought: Optional[str] = None
    connection_to_rebbe: Optional[str] = None


class VisitUpdate(BaseModel):
    contact_id: Optional[int] = None
    visit_date: Optional[datetime] = None
    visit_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    interactions: Optional[list[VisitInteraction]] = None
    tefillin: Optional[bool] = None
    tzedakah: Optional[bool] = None
    shabbat_candles: Optional[bool] = None
    torah_pamphlet: Optional[bool] = None
    letter_in_torah: Optional[bool] = None
    torah_thought: Optional[str] = None
    connection_to_rebbe: Optional[str] = None


class VisitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    visit_date: datetime
    visit_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    interactions: list[VisitInteraction] = []
    tefillin: bool = False
    tzedakah: bool = False
    shabbat_candles: bool = False
    torah_pamphlet: bool = False
    letter_in_torah: bool = False
    torah_thought: Optional[str] = None
    connection_to_rebbe: Optional[str] = None


# --- Donations -------------------------------------------------------------
class DonationCreate(BaseModel):
    contact_id: Optional[int] = None
    donation_date: datetime
    amount: Optional[float] = None
    is_ongoing: bool = False
    number_of_payments: Optional[int] = None
    notes: Optional[str] = None


class DonationUpdate(BaseModel):
    contact_id: Optional[int] = None
    donation_date: Optional[datetime] = None
    amount: Optional[float] = None
    is_ongoing: Optional[bool] = None
    number_of_payments: Optional[int] = None
    notes: Optional[str] = None


class DonationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    donation_date: datetime
    amount: Optional[float] = None
    is_ongoing: bool
    number_of_payments: Optional[int] = None
    notes: Optional[str] = None


# --- Global search -----------------------------------------------------------
class SearchHit(BaseModel):
    """One result row. `type` tells the frontend which detail page to link to."""

    type: str  # 'contact' | 'area' | 'building' | 'apartment'
    id: int
    title: str
    subtitle: Optional[str] = None
    # For contacts only: 'mekurav' | 'shliach' (drives the מקורב/פעיל badge).
    contact_type: Optional[str] = None


class SearchOut(BaseModel):
    query: str
    results: list[SearchHit]


# --- AI chat (digital twin) --------------------------------------------------
class AiChatMessage(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class AiChatRequest(BaseModel):
    messages: list[AiChatMessage]


class AiChatResponse(BaseModel):
    reply: str
