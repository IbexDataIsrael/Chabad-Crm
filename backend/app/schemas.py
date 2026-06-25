"""Pydantic request/response schemas."""
from datetime import datetime, time
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

Role = Literal["admin", "staff", "shliach"]
ContactType = Literal["mekurav", "shliach"]


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
    map_in_english: bool


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    map_in_english: Optional[bool] = None


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
    pass


class ApartmentUpdate(BaseModel):
    building_id: Optional[int] = None
    apartment_name: Optional[str] = None
    apartment_notes: Optional[str] = None


class ApartmentOut(ApartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    guid: str


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


class ShliachOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int
    user_id: Optional[int] = None
    notes: Optional[str] = None
    apartment_ids: list[int] = []


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
    area: Optional[str] = None
    pipeline_status: Optional[str] = None
    color_tag: Optional[str] = None
    priority_score: Optional[int] = None


class ContactCreate(ContactBase):
    mekurav: Optional[MekuravData] = None
    shliach: Optional[ShliachData] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    assigned_user_id: Optional[int] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    area: Optional[str] = None
    pipeline_status: Optional[str] = None
    color_tag: Optional[str] = None
    priority_score: Optional[int] = None
    mekurav: Optional[MekuravData] = None
    shliach: Optional[ShliachData] = None


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
    color_hint: Optional[str] = None
    sort_order: int = 0
    is_active: bool = True
    is_default: bool = False


class PicklistValueUpdate(BaseModel):
    value: Optional[str] = None
    hebrew_label: Optional[str] = None
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
    color_hint: Optional[str] = None
    sort_order: int
    is_active: bool
    is_default: bool


class PicklistReorder(BaseModel):
    ordered_ids: list[int]


class PicklistFieldOut(BaseModel):
    field_key: str
    label: str
