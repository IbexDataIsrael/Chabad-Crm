"""Pydantic request/response schemas."""
import re
from datetime import datetime, time
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["admin", "staff", "shliach"]
ContactType = Literal["mekurav", "shliach"]

# fixes35: one non-select custom field's value — text/number/boolean/date all
# fit here (date as an ISO string); select-type values live in
# picklist_values instead, never in custom_field_values.
CustomFieldValue = Union[str, float, bool, None]

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
    # fixes33 §6: free text injected at the top of every generated PDF report.
    report_notes: Optional[str] = None
    # fixes40 §4: global field-label text styling (null = app default).
    label_font_size: Optional[int] = None
    label_color: Optional[str] = None
    label_font_family: Optional[str] = None
    # fixes51 §4: the Shliach Role Configuration Panel's settings blob (null =
    # nothing configured yet).
    shliach_view_config: Optional[dict] = None
    # fixes54 §8: this org's cascaded feature-toggle flags (see OrgPrefsOut /
    # app.core.org_prefs) — set explicitly wherever OrganizationOut is built
    # for a regular (non-superadmin) auth response, since it isn't a stored
    # column on Organization. Defaults all-True so a session built before this
    # was wired up (or a code path that never sets it) fails open, not closed.
    feature_flags: dict[str, bool] = {}
    # fixes65 §1: public landing page + self-registration switch.
    slug: Optional[str] = None
    public_subtitle: Optional[str] = None
    public_gallery: Optional[list[str]] = None
    self_registration_enabled: bool = False


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    map_in_english: Optional[bool] = None
    default_lat: Optional[float] = None
    default_lng: Optional[float] = None
    default_zoom: Optional[int] = None
    shliach_can_view_contacts: Optional[bool] = None
    report_notes: Optional[str] = None
    shliach_view_config: Optional[dict] = None
    label_font_size: Optional[int] = None
    label_color: Optional[str] = None
    label_font_family: Optional[str] = None
    # fixes65 §1
    slug: Optional[str] = None
    public_subtitle: Optional[str] = None
    public_gallery: Optional[list[str]] = None
    self_registration_enabled: Optional[bool] = None

    @field_validator("slug")
    @classmethod
    def _check_slug(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip().lower()
        if not v:
            return None
        import re

        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?", v):
            raise ValueError(
                "Slug may contain only lowercase English letters, digits and dashes"
            )
        return v


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
    # fixes45: the active version's identity snapshot (mirrors the linked
    # User/Contact) — see models.ContactShliach docstring.
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    report_number_ids: list[int] = []
    area_ids: list[int] = []
    # fixes26 §4: state of the linked login account, resolved like
    # core/shliach.py (user_id link, else same-org email match) —
    # 'active' | 'disabled' | 'missing'.
    login_status: Optional[str] = None


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
    # fixes44 §1: was already a User column (kept in sync with a linked
    # shliach contact by PUT /api/users/{id}) but never exposed on reads —
    # the Users page derived it by re-matching contacts by email instead.
    phone: Optional[str] = None
    role: str
    is_active: bool = True
    # fixes61 §2: an activist tracked in the system with no login of their own.
    is_manual: bool = False
    # fixes65 §7: 'public' | 'qr' for a self-registered activist.
    registration_source: Optional[str] = None
    created_at: datetime
    organization_id: int
    organization: Optional[OrganizationOut] = None
    # fixes46: the linked ContactShliach (role='shliach' only), resolved by
    # the real user_id FK — replaces the frontend's old email-matching hack.
    # None for admin/staff, or a shliach login not yet linked to a contact.
    shliach: Optional[ShliachOut] = None


# --- Org user management (fixes7 §1: admins provision admins/staff) ---------
OrgRole = Literal["admin", "staff", "campaign_manager"]


class OrgUserCreate(BaseModel):
    """An admin provisions a user in their own org. Email is the identity —
    with no password the account signs in via Google (verified email only).

    fixes61 §2: `is_manual` covers an activist tracked in the system who never
    logs in themselves — email (their would-be login identity) is optional
    for them; the endpoint fills in a username instead of defaulting to it."""

    full_name: str
    email: Optional[str] = None
    role: OrgRole = "staff"
    username: Optional[str] = None  # defaults to the email
    password: Optional[str] = None  # omitted => Google-only account
    phone: Optional[str] = None
    is_manual: bool = False

    _email_lower = field_validator("email")(_normalize_email)


class OrgUserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None  # fixes14: propagates to a linked shliach contact
    phone: Optional[str] = None
    role: Optional[OrgRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    # fixes46: notes/areas/report_numbers on the linked ContactShliach —
    # editing them here versions the same lineage as the contact's own
    # shliach form (see routers/users.py::update_user). `password` on this
    # sub-model is unused here (the top-level `password` above is the one
    # that applies — this page always edits an existing login user, unlike
    # the contact-page flow ShliachData also serves, which may still need to
    # provision one).
    shliach: Optional[ShliachData] = None

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


class OrgPrefsOut(BaseModel):
    """fixes54 §8: an organization's feature-toggle state — `raw` is exactly
    what's stored (missing keys default to True); `effective` is `raw` after
    the Area→Building→Apartment→Activist cascade (a disabled ancestor forces
    every descendant False regardless of its own stored value)."""

    raw: dict[str, bool]
    effective: dict[str, bool]


class OrgPrefsUpdate(BaseModel):
    """Partial update — only keys present are changed; unknown keys ignored
    server-side (see app.core.org_prefs.ALL_KEYS)."""

    area_display_enabled: Optional[bool] = None
    building_display_enabled: Optional[bool] = None
    apartment_display_enabled: Optional[bool] = None
    activist_system_enabled: Optional[bool] = None
    ai_query_enabled: Optional[bool] = None


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
    # Clone only: caps how many rows are copied for one or more tables
    # (keyed by table name, e.g. {"apartments": 500}) — see
    # app.core.org_clone. Ignored by plain org creation.
    table_row_limits: Optional[dict[str, int]] = None


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
    english_label: Optional[str] = None
    # fixes35: contact_mekurav | contact_shliach | visit | apartment.
    entity_type: str = "visit"
    # fixes35: text | number | boolean | date | select.
    field_type: str = "boolean"
    # Required (non-empty) only when field_type == "select" — the field's
    # initial dropdown options (Hebrew labels); provisions a PicklistDefinition
    # + PicklistValue rows, see routers/custom_fields.py.
    picklist_options: Optional[list[str]] = None
    sort_order: int = 0


class CustomFieldDefinitionUpdate(BaseModel):
    hebrew_label: Optional[str] = None
    english_label: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CustomFieldDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    field_key: str
    hebrew_label: str
    english_label: Optional[str] = None
    entity_type: str
    field_type: str
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


class JewishCounts(BaseModel):
    """fixes53 §3/§4: calculated columns for the Report Numbers/Areas grids —
    apartment counts under a report number or area matching the Jewish-status
    categories in app.core.jewish_status."""

    jews: int
    engaged: int


class ShliachSummary(BaseModel):
    """fixes43 §4.2/4.3: a shliach contact already covering an area/report
    number — powers the reassignment conflict warning on the shliach edit
    form (frontend formats name+last_name via contactFullName)."""

    id: int
    name: str
    last_name: Optional[str] = None


ReportCompletionStatus = Literal["completed", "not_completed", "partial"]


class ReportCompletionCreate(BaseModel):
    """fixes53 §7: the "Report completed" button's 3-choice modal + comment."""

    status: ReportCompletionStatus
    comments: Optional[str] = None


class ReportCompletionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    status: ReportCompletionStatus
    comments: Optional[str] = None
    created_at: datetime
    # fixes53 §9: who submitted it, for the Messages-from-activists list.
    activist: ShliachSummary


class SystemCommentCreate(BaseModel):
    """fixes53 §7: the "Comments about the system" button."""

    comment: str


class SystemCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    comment: str
    created_at: datetime
    activist: ShliachSummary


class ShliachAnnouncementCreate(BaseModel):
    """fixes54 §5: an admin-authored announcement for the activist landing
    page's feed."""

    message_title: str
    message_content: str
    is_visible: bool = True


class ShliachAnnouncementUpdate(BaseModel):
    message_title: Optional[str] = None
    message_content: Optional[str] = None
    is_visible: Optional[bool] = None


class ShliachAnnouncementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    message_title: str
    message_content: str
    is_visible: bool
    created_at: datetime
    updated_at: datetime


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


class BuildingTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name_en: str
    name_he: str


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
    # fixes33 §2.2: nullable — an area delete may unassign its buildings.
    area_id: Optional[int] = None
    building_name: Optional[str] = None
    building_address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    is_town_house: bool = False
    # fixes63: 'building' | 'town_house' | 'divided_town_house'.
    building_type_id: str = "building"
    floors: list[FloorOut] = []
    # fixes63: derived from `building_type_id` (`Building.is_townhouse`
    # property) — true only for a plain, undivided town house. Drives the
    # small-house vs. standard-building icon in the UI.
    is_townhouse: bool = False


class BuildingListItemOut(BaseModel):
    """Lighter `BuildingOut` for the plain, unpaginated `GET /api/buildings`
    (filters/pickers across ~7 pages) — no `floors`. That field was never
    read by any of those callers, but with an org past a few thousand
    buildings the selectinload + per-building floor arrays made this
    endpoint's payload large enough to be slow/flaky, taking sibling
    parallel requests (areas/report-numbers/picklists) down with it — the
    exact "all filter boxes empty" bug this fixes."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    area_id: Optional[int] = None
    building_name: Optional[str] = None
    building_address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None
    is_town_house: bool = False
    building_type_id: str = "building"
    is_townhouse: bool = False


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
    # fixes51 §2.2: multi-select (was single-value, fixes13).
    language: Optional[list[str]] = None
    name: Optional[str] = None  # resident name
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None  # מספר דוח (fixes19)
    # fixes32: any apartment.* picklist beyond the 4 fixed fields above — an
    # admin-added custom picklist works without any dedicated schema field.
    picklist_values: dict[str, Optional[str]] = {}
    # fixes35: any non-select apartment custom field, keyed by field_key.
    custom_field_values: dict[str, CustomFieldValue] = {}

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
    language: Optional[list[str]] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None
    picklist_values: Optional[dict[str, Optional[str]]] = None
    custom_field_values: Optional[dict[str, CustomFieldValue]] = None

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
    language: Optional[list[str]] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None
    picklist_values: dict[str, Optional[str]] = {}
    custom_field_values: dict[str, CustomFieldValue] = {}
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
    # fixes53 §2: set only when sort="building" — the count of distinct
    # buildings matching the current filters, so the frontend pager can
    # paginate by building (not by row) in grouped view. `page_size` in that
    # mode means buildings-per-page, and `items` holds every apartment for
    # the buildings on this page (never a partial building).
    total_buildings: Optional[int] = None


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


class BuildingAggregate(BaseModel):
    """fixes30 §1: apartment count per building under the /list filters — the
    group-by-building view's header aggregates (filter-scoped, not
    page-scoped)."""

    building_id: int
    count: int


class ApartmentBulkChanges(BaseModel):
    """fixes52 §2.3: the "new values" half of a bulk edit — deliberately the
    same shape as `ApartmentUpdate` minus `apartment_name`/`building_id` (the
    spec excludes both from bulk editing; leaving them off the schema blocks
    a crafted request too, not just the UI). Key presence = "update this
    field" (`model_dump(exclude_unset=True)`, mirrors the single-apartment
    PATCH contract exactly) — an omitted field is left untouched, an explicit
    `null` clears it."""

    floor: Optional[str] = None
    apartment_notes: Optional[str] = None
    jewish_status: Optional[str] = None
    campaign_status: Optional[str] = None
    mezuzah_status: Optional[str] = None
    language: Optional[list[str]] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    report_number_id: Optional[int] = None
    picklist_values: Optional[dict[str, Optional[str]]] = None
    custom_field_values: Optional[dict[str, CustomFieldValue]] = None

    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: Optional[str]) -> Optional[str]:
        return _validate_phone(v) if v else None

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: Optional[str]) -> Optional[str]:
        return _validate_email(v)


class ApartmentBulkUpdate(BaseModel):
    """fixes23 §3, expanded fixes52 §2.3: apply a change to every active
    apartment matching the page's current filters. The filter block mirrors
    the /list query params exactly, so "matching the active filters" resolves
    to the same rows the grid shows."""

    # Filters (same semantics as GET /api/apartments/list).
    building_ids: Optional[list[int]] = None
    area_ids: Optional[list[int]] = None
    report_number_ids: Optional[list[int]] = None
    jewish_status: Optional[list[str]] = None
    mezuzah_status: Optional[list[str]] = None
    campaign_status: Optional[list[str]] = None
    language: Optional[list[str]] = None
    picklist: Optional[list[str]] = None
    custom_field_filter: Optional[list[str]] = None
    q: Optional[str] = None
    # The new values to apply — see ApartmentBulkChanges.
    changes: ApartmentBulkChanges = ApartmentBulkChanges()


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
    # fixes35: non-select custom field values (contact_mekurav or
    # contact_shliach, whichever the contact's own contact_type resolves to).
    custom_field_values: dict[str, CustomFieldValue] = {}

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
    custom_field_values: Optional[dict[str, CustomFieldValue]] = None

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
    # Read-only here (not on ContactBase, so no create/update payload can set
    # them): 'crm' | 'instinct', and 'active' | 'draft' (docs/system_api.md).
    source: str = "crm"
    status: str = "active"
    # Enriched by /list only (fixes15 §5.1 optional grid columns): the mekurav
    # apartment's building display name + its area name (+ fixes18: the linked
    # admin-area name). None elsewhere.
    building_name: Optional[str] = None
    area_name: Optional[str] = None
    admin_area_name: Optional[str] = None
    # fixes48 §2: the raw ids behind building_name/admin_area_name — a grid
    # inline editor needs these as its current value (the display names alone
    # aren't enough to pre-populate a select/picker). None when the contact
    # has no mekurav record or the field is unset.
    apartment_id: Optional[int] = None
    admin_area_id: Optional[int] = None
    # fixes27 §3: /list enrichment for shliach rows — the login account's state
    # ('active' | 'disabled' | 'missing'), driving the row-level suspended
    # notice. None for mekurav rows and outside /list.
    login_status: Optional[str] = None
    # fixes34 §1.1: dynamic (non-fixed) picklist selections beyond
    # pipeline_status/color_tag — { system_name: value | None }, populated on
    # every read path (list + detail), mirroring ApartmentOut.picklist_values.
    picklist_values: dict[str, Optional[str]] = {}
    # fixes35: non-select custom field values for this contact's own
    # contact_type (mekurav or shliach).
    custom_field_values: dict[str, CustomFieldValue] = {}


class ContactDetailOut(ContactOut):
    mekurav: Optional[MekuravOut] = None
    shliach: Optional[ShliachOut] = None
    special_dates: list[SignificantDateOut] = []


class ContactPageOut(BaseModel):
    """One server-side page of the contacts list (fixes8 §2C pattern)."""

    items: list[ContactOut]
    total: int
    page: int
    page_size: int


class ContactBulkUpdate(BaseModel):
    """fixes43 §1: reassign "Assigned To" on every contact matching the page's
    current filters. The filter block mirrors GET /api/contacts/list, so "all
    contacts currently matching the active filters" resolves to the exact
    same rows the user sees. `set_assigned_user_id` disambiguates "leave
    unchanged" from "clear to unassigned" (same pattern as ApartmentBulkUpdate)."""

    # Filters (same semantics as GET /api/contacts/list).
    pipeline_status: Optional[str] = None
    contact_type: Optional[str] = None
    assigned_user_id: Optional[str] = None
    q: Optional[str] = None
    area_ids: Optional[list[int]] = None
    building_ids: Optional[list[int]] = None
    has_mitzvot: bool = False
    tzedaka_potential: Optional[str] = None
    admin_area_ids: Optional[list[int]] = None
    visit_from: Optional[datetime] = None
    visit_to: Optional[datetime] = None
    torah_thought: Optional[list[str]] = None
    connection_to_rebbe: Optional[str] = None
    custom_fields: Optional[list[str]] = None
    picklist: Optional[list[str]] = None
    # New value — only applied because this endpoint only ever sets one field.
    new_assigned_user_id: Optional[str] = None


class ContactBulkUpdateResult(BaseModel):
    updated: int


class ShliachClearReportNumbersIn(BaseModel):
    """fixes43 §3.4 / fixes48 §3: "ניקוי שיבוצים" — clear the report-number
    assignment from every shliach contact in the given id set (the Users
    page's current filtered view). fixes48: this used to clear `areas`
    instead — the area assignment must be left untouched."""

    contact_ids: list[int]


class ShliachClearReportNumbersResult(BaseModel):
    updated: int


class ShliachRestoreField(BaseModel):
    """fixes48 §4: restore one field of the active shliach back to the value
    it held in a previous version — mirrors ApartmentRestoreField."""

    version_id: int  # the historical ContactShliach row to read the value from
    field: str  # which restorable field to roll back


class ShliachVersionOut(BaseModel):
    """fixes45: one historical shliach version (admin history view) — the
    full snapshot plus who retired it and when. Same shape as
    ApartmentVersionOut."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int
    user_id: Optional[int] = None
    notes: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    report_number_ids: list[int] = []
    area_ids: list[int] = []
    last_edit: Optional[datetime] = None
    editor_name: Optional[str] = None


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


class UsageOut(BaseModel):
    """fixes48 §1: dependent-record count for a definition/value about to be
    hard-deleted — the frontend confirms with a data-loss warning when
    count > 0, then purges on confirm."""

    count: int


class PicklistFieldOut(BaseModel):
    """A picklist *definition* (registry entry), DB-driven and bilingual."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    field_key: str  # == system_name
    label: str  # hebrew_display_name
    english_label: Optional[str] = None
    is_system: bool = True
    # fixes37: "contact_mekurav" | "contact_shliach" | "apartment" | "visit" |
    # "significant_date" — which logical entity this picklist belongs to.
    entity_type: str = "contact_mekurav"
    # fixes40 round 2 §3: display order within the field's section (shared
    # ordering surface with FieldSetting/CustomFieldDefinition via
    # /api/field-settings). None = unordered — the backing column is a
    # NOT-NULL default-0 tie-breaker predating this feature, so callers
    # normalize a raw 0 to None (0 was never a real admin-set position).
    sort_order: Optional[int] = None


class PicklistDefinitionCreate(BaseModel):
    system_name: str
    hebrew_display_name: str
    english_display_name: Optional[str] = None
    # fixes37: caller states which entity this new picklist belongs to
    # ("contact_mekurav" | "apartment" | "visit") — the router auto-upgrades
    # "contact_mekurav" to "contact_shliach" when system_name starts with
    # "shliach." (mirrors field_registry.py's identical convention), so
    # callers never need to pass "contact_shliach" or "significant_date"
    # themselves.
    entity_type: str


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
    torah_thought: Optional[str] = None
    # fixes35: non-select visit custom field values (boolean-type ones still
    # go through the legacy /custom-fields sub-resource instead). fixes39:
    # this is also where connection_to_rebbe (now field_type="text") and the
    # 5 Mivtzoim flags (via the legacy sub-resource) travel.
    custom_field_values: dict[str, CustomFieldValue] = {}
    # fixes35 §5: any admin-added visit-scoped select custom field, keyed by
    # system_name (checklist.<field_key>) — mirrors ApartmentBase/ContactBase's
    # own picklist_values; visits never had this generic dict before.
    picklist_values: dict[str, Optional[str]] = {}


class VisitUpdate(BaseModel):
    contact_id: Optional[int] = None
    visit_date: Optional[datetime] = None
    visit_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    interactions: Optional[list[VisitInteraction]] = None
    torah_thought: Optional[str] = None
    custom_field_values: Optional[dict[str, CustomFieldValue]] = None
    picklist_values: Optional[dict[str, Optional[str]]] = None


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
    torah_thought: Optional[str] = None
    custom_field_values: dict[str, CustomFieldValue] = {}
    picklist_values: dict[str, Optional[str]] = {}


# fixes38 §1.2/§1.3: "Summary of Visits" report + per-contact Visit Summary.
class VisitSummaryItem(BaseModel):
    visit_id: int
    visit_date: datetime
    contact_id: int
    contact_name: str


class VisitSummaryCategory(BaseModel):
    key: str
    # fixes39: the breakdown is now driven by CustomFieldDefinition rows
    # (any active entity_type="visit" boolean field, not a fixed tuple) — the
    # labels ride along so the frontend doesn't need a localization lookup
    # keyed on a fixed set of field names.
    hebrew_label: str
    english_label: Optional[str] = None
    count: int
    items: list[VisitSummaryItem]


class VisitSummaryOut(BaseModel):
    total: int
    categories: list[VisitSummaryCategory]


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

    type: str  # 'contact' | 'user' | 'area' | 'building' | 'apartment'
    id: int
    title: str
    subtitle: Optional[str] = None
    # For contacts only: 'mekurav' | 'shliach' (drives the מקורב/פעיל badge).
    contact_type: Optional[str] = None


class SearchOut(BaseModel):
    query: str
    results: list[SearchHit]


# --- AI query (natural language -> data grid) --------------------------------
class AiQueryRequest(BaseModel):
    prompt: str


class AiQueryColumn(BaseModel):
    key: str
    label_he: str
    label_en: str


class AiQueryResponse(BaseModel):
    table_title: str
    columns: list[AiQueryColumn]
    rows: list[dict]
    row_count: int
    truncated: bool


# --- Admin dashboard summary --------------------------------------------------
class DashboardStat(BaseModel):
    value: int
    previous_value: int


class DashboardTrendPoint(BaseModel):
    date: str  # ISO date (YYYY-MM-DD)
    contacts: int
    apartments: int


class DashboardActivistActivity(BaseModel):
    user_id: int
    name: str
    edits: int


class DashboardJewishStatusBreakdownItem(BaseModel):
    value: Optional[str] = None
    count: int


class DashboardJewishStatusChange(BaseModel):
    apartment_id: int
    label: str
    building_address: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_at: datetime
    editor_name: Optional[str] = None


class DashboardSummaryOut(BaseModel):
    range_days: int
    new_contacts: DashboardStat
    new_apartments: DashboardStat
    activist_edits: DashboardStat
    jewish_status_changes: DashboardStat
    trend: list[DashboardTrendPoint]
    top_activists: list[DashboardActivistActivity]
    jewish_status_breakdown: list[DashboardJewishStatusBreakdownItem]
    recent_jewish_changes: list[DashboardJewishStatusChange]


# --- fixes58: Campaign & Task entities -------------------------------------

TaskStatus = Literal["ACTIVE", "COMPLETED", "PAUSED"]


class CampaignCreate(BaseModel):
    name: str
    is_active: bool = False
    custom_stats_text: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Name is required")
        return v.strip()


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    custom_stats_text: Optional[str] = None


class CampaignOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    name: str
    is_active: bool
    custom_stats_text: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TaskCreate(BaseModel):
    campaign_id: int
    # fixes65 §2: None = "Assign Later" — the task enters the orphan pool.
    volunteer_user_id: Optional[int] = None
    custom_date_value_id: Optional[int] = None
    report_number_ids: list[int] = []
    status: TaskStatus = "ACTIVE"
    volunteer_report_summary: Optional[str] = None


class TaskUpdate(BaseModel):
    campaign_id: Optional[int] = None
    # fixes65 §4: assign an orphan / reassign (unassign has its own endpoint).
    volunteer_user_id: Optional[int] = None
    custom_date_value_id: Optional[int] = None
    report_number_ids: Optional[list[int]] = None
    status: Optional[TaskStatus] = None
    volunteer_report_summary: Optional[str] = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    campaign_id: int
    campaign_name: str
    volunteer_user_id: Optional[int] = None
    volunteer_name: str
    custom_date_value_id: Optional[int] = None
    # Raw picklist token (e.g. "first_candle_hanukkah"), matching every other
    # picklist-backed field's API shape — the frontend resolves the bilingual
    # label via usePicklist("task.custom_date").display(...).
    custom_date_value: Optional[str] = None
    report_number_ids: list[int] = []
    report_number_names: list[str] = []
    status: TaskStatus
    volunteer_report_summary: Optional[str] = None
    # fixes60 §1/decision #2: the volunteer's own most recent
    # ShliachReportCompletion — not literally scoped per-task (that table has
    # no task_id) — see routers/tasks.py::_latest_reports_by_volunteer.
    latest_report_status: Optional[str] = None
    latest_report_notes: Optional[str] = None
    # fixes65 §4: claim audit + derived pool state.
    claimed_at: Optional[datetime] = None
    claimed_via: Optional[str] = None
    is_orphan: bool = False
    apartment_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# --- fixes65: public landing page, self-registration, QR claim, paper entry --


class PublicOrgOut(BaseModel):
    id: int
    slug: str
    name: str
    subtitle: Optional[str] = None
    logo_url: Optional[str] = None
    gallery: list[str] = []
    self_registration_enabled: bool = False


class PublicRegisterRequest(BaseModel):
    """Activist self-registration — from an org landing page (`org_slug`) or
    the QR claim flow (`claim_token`; the org is the task's). Email is the
    login and is always required on this path."""

    full_name: str
    email: str
    password: str
    phone: Optional[str] = None
    org_slug: Optional[str] = None
    claim_token: Optional[str] = None

    _email_lower = field_validator("email")(_normalize_email)

    @field_validator("full_name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Full name is required")
        return " ".join(v.split())


class PublicGoogleRegisterRequest(BaseModel):
    credential: str
    phone: Optional[str] = None
    org_slug: Optional[str] = None
    claim_token: Optional[str] = None


class PublicRegisterResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # Result of the atomic auto-claim when a claim_token rode along.
    claim_state: Optional[str] = None


ClaimState = Literal["available", "claimed", "yours", "taken", "invalid"]


class ClaimInfoOut(BaseModel):
    state: ClaimState
    organization_id: Optional[int] = None
    organization_name: Optional[str] = None
    organization_slug: Optional[str] = None
    organization_logo_url: Optional[str] = None
    campaign_name: Optional[str] = None
    report_number_names: list[str] = []
    apartment_count: int = 0


class ClaimResultOut(BaseModel):
    state: ClaimState
    task_id: Optional[int] = None
    detail: Optional[str] = None


class TaskPrintApartment(BaseModel):
    id: int
    building_id: int
    building_name: Optional[str] = None
    building_address: Optional[str] = None
    floor: Optional[str] = None
    apartment_name: Optional[str] = None
    name: Optional[str] = None
    report_number_name: Optional[str] = None


class TaskPrintOut(BaseModel):
    task: TaskOut
    # Only for an orphan task — the frontend turns it into the QR's URL.
    claim_token: Optional[str] = None
    apartments: list[TaskPrintApartment] = []


class PaperEntryApartmentUpdate(BaseModel):
    apartment_id: int
    jewish_status: Optional[str] = None
    mezuzah_status: Optional[str] = None
    language: Optional[list[str]] = None
    apartment_notes: Optional[str] = None
    # Which of the above were actually filled in on the sheet — unlisted
    # keys are left untouched (a blank cell is not "clear this value").
    fields: list[str] = []


PerformerType = Literal["user", "name", "unknown"]


class PaperEntryCreate(BaseModel):
    performer_type: PerformerType
    performer_user_id: Optional[int] = None
    performer_name: Optional[str] = None
    notes: Optional[str] = None
    apartments: list[PaperEntryApartmentUpdate] = []


class PaperEntryOut(BaseModel):
    id: int
    task_id: int
    performer_type: PerformerType
    performer_user_id: Optional[int] = None
    performer_name: Optional[str] = None
    entered_by_name: Optional[str] = None
    apartment_count: int
    notes: Optional[str] = None
    created_at: datetime


class NewSignupsOut(BaseModel):
    count: int
    since: Optional[datetime] = None


class GeneratePolygonResult(BaseModel):
    """fixes60 §5: one area's outcome from a convex-hull polygon generation
    run — `ok` means area_polygon was written; `skipped` names why not
    (typically too few geocoded buildings)."""

    area_id: int
    area_name: str
    ok: bool
    building_count: int
    skipped_reason: Optional[str] = None


class TaskStatusWithId(BaseModel):
    """fixes60 §2: report_number_campaign_task_status's per-cell value — a
    plain status string couldn't be PUT against, since there's no task id in
    it to address. Report Numbers' inline status toggle needs task_id."""

    status: TaskStatus
    task_id: int


class TaskPageOut(BaseModel):
    items: list[TaskOut]
    total: int
    page: int
    page_size: int


class CampaignActiveStat(BaseModel):
    """fixes58 §3.2: one active campaign's homepage tile — `count` is the
    number of distinct report numbers currently under that campaign's active
    tasks, org-wide, with `custom_stats_text`'s `{{count}}` tag substituted
    client-side."""

    id: int
    name: str
    custom_stats_text: Optional[str] = None
    count: int
