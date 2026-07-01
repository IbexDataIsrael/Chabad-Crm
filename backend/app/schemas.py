"""Pydantic request/response schemas."""
import re
from datetime import datetime, time
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, field_validator

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


class UserCreate(BaseModel):
    username: str
    full_name: str
    password: str
    role: Role = "staff"
    email: Optional[str] = None
    organization_name: Optional[str] = None


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


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    logo_url: Optional[str] = None
    map_in_english: Optional[bool] = None
    default_lat: Optional[float] = None
    default_lng: Optional[float] = None
    default_zoom: Optional[int] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    username: str
    full_name: str
    role: str
    created_at: datetime
    organization_id: int
    organization: Optional[OrganizationOut] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SignupRequest(BaseModel):
    organization_name: str
    organization_logo_url: Optional[str] = None
    first_name: str
    last_name: str
    email: str
    phone: str
    username: str
    password: str


class ResendRequest(BaseModel):
    email: str


class GoogleLoginRequest(BaseModel):
    """Google Identity Services flow: the browser posts the Google ID token."""

    credential: str


class GoogleSignupRequest(BaseModel):
    """Create a new org + admin from a Google identity. Org name still required."""

    credential: str
    organization_name: str
    organization_logo_url: Optional[str] = None


class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None


# --- Community checklist ---------------------------------------------------
class ChecklistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contact_id: int
    tefillin: bool
    tefillin_notes: Optional[str] = None
    tzedakah: bool
    charity_note: Optional[str] = None
    shabbat_candles: bool
    shabbat_candles_notes: Optional[str] = None
    torah_pamphlet: bool
    torah_pamphlet_notes: Optional[str] = None
    torah_thought: Optional[str] = None
    torah_letter: bool
    letter_torah_notes: Optional[str] = None


class ChecklistUpdate(BaseModel):
    tefillin: Optional[bool] = None
    tefillin_notes: Optional[str] = None
    tzedakah: Optional[bool] = None
    charity_note: Optional[str] = None
    shabbat_candles: Optional[bool] = None
    shabbat_candles_notes: Optional[str] = None
    torah_pamphlet: Optional[bool] = None
    torah_pamphlet_notes: Optional[str] = None
    torah_thought: Optional[str] = None
    torah_letter: Optional[bool] = None
    letter_torah_notes: Optional[str] = None


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
    """A custom field merged with a contact's value (for display/editing)."""

    definition_id: int
    field_key: str
    hebrew_label: str
    checked: bool
    note: Optional[str] = None


class CustomFieldValueIn(BaseModel):
    definition_id: int
    checked: bool = False
    note: Optional[str] = None


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


class BuildingBase(BaseModel):
    area_id: int
    building_name: str
    building_address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None


class BuildingCreate(BuildingBase):
    pass


class BuildingUpdate(BaseModel):
    area_id: Optional[int] = None
    building_name: Optional[str] = None
    building_address: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None


class BuildingOut(BuildingBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str


class ApartmentBase(BaseModel):
    building_id: int
    apartment_name: str
    apartment_notes: Optional[str] = None


class ApartmentCreate(ApartmentBase):
    # Optionally link an existing mekurav contact to the new apartment.
    contact_id: Optional[int] = None


class ApartmentUpdate(BaseModel):
    building_id: Optional[int] = None
    apartment_name: Optional[str] = None
    apartment_notes: Optional[str] = None


class ApartmentOut(ApartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str


class ApartmentListOut(ApartmentOut):
    """Apartment enriched with its building/area context + a linked contact (if any)."""

    building_name: Optional[str] = None
    area_name: Optional[str] = None
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None


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
    first_visit: Optional[datetime] = None
    potential_next_step: Optional[str] = None
    rebbe_connection: Optional[str] = None
    recommendations: Optional[str] = None
    background: Optional[str] = None


class MekuravOut(MekuravData):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int


class ShliachData(BaseModel):
    notes: Optional[str] = None
    apartment_ids: list[int] = []
    area_ids: list[int] = []


class ShliachOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int
    user_id: Optional[int] = None
    notes: Optional[str] = None
    apartment_ids: list[int] = []
    area_ids: list[int] = []


# --- Contacts --------------------------------------------------------------
class ContactBase(BaseModel):
    name: str
    last_name: Optional[str] = None
    phone: str
    email: Optional[str] = None
    contact_type: ContactType = "mekurav"
    assigned_user_id: Optional[int] = None
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
    # bad numbers still read back without erroring.
    @field_validator("phone")
    @classmethod
    def _check_phone(cls, v: str) -> str:
        return _validate_phone(v)


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    assigned_user_id: Optional[int] = None
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
        return _validate_phone(v)


class ContactOut(ContactBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    created_at: datetime
    updated_at: datetime


class ContactDetailOut(ContactOut):
    checklist: Optional[ChecklistOut] = None
    mekurav: Optional[MekuravOut] = None
    shliach: Optional[ShliachOut] = None
    special_dates: list[SignificantDateOut] = []
    # Dynamic picklist selections: { system_name: value }.
    picklist_values: dict[str, str] = {}


# --- Interactions ----------------------------------------------------------
class InteractionCreate(BaseModel):
    contact_id: int
    category: str
    note: str


class InteractionUpdate(BaseModel):
    category: Optional[str] = None
    note: Optional[str] = None


class InteractionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str
    contact_id: int
    created_by: int
    category: str
    note: str
    created_at: datetime


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
class VisitCreate(BaseModel):
    contact_id: Optional[int] = None
    visit_date: datetime
    visit_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None


class VisitUpdate(BaseModel):
    contact_id: Optional[int] = None
    visit_date: Optional[datetime] = None
    visit_type: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None


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
