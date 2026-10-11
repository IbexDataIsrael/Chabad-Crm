"""Contact CRUD + sub-resources (significant dates).

Contacts are split: the `contacts` row carries core CRM data + a `contact_type`
(מקורב | פעיל). Mekurav/shliach specifics live in their own tables. Creating a
shliach also provisions a login `User` (role 'shliach') linked by email.

Shliach users see only mekuravim in apartments they cover (scoped reads).

fixes25: the community checklist (Mivtzoim), interactions and custom-field
values moved to the visit level — the related sub-resources live on visits.
"""
import datetime
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import custom_field_utils, models, picklist_utils
from app.core.display import building_display_name
from app.core.email import send_shliach_welcome
from app.core.geocode import geocode_address
from app.core import org_prefs
from app.core.natural_sort import natural_sort_keys
from app.core.security import hash_password
from app.core.shliach import (
    apply_shliach_versioned_update,
    copy_shliach_children,
    email_taken_error,
    set_shliach_areas,
    set_shliach_report_numbers,
    validate_area,
    validate_report_number,
)
from app.database import get_db
from app.deps import (
    forbid_campaign_manager,
    get_current_user,
    require_admin,
    require_staff_or_admin,
)
from app.picklist_utils import validate_picklist_value
from app.schemas import (
    ContactBulkUpdate,
    ContactBulkUpdateResult,
    ContactCreate,
    ContactDetailOut,
    ContactOut,
    ContactPageOut,
    ContactUpdate,
    MekuravOut,
    ReminderOut,
    ShliachClearReportNumbersIn,
    ShliachClearReportNumbersResult,
    ShliachOut,
    ShliachVersionOut,
    SignificantDateCreate,
    SignificantDateOut,
    SignificantDateUpdate,
)
from app.core.errors import api_error

router = APIRouter(prefix="/api/contacts", tags=["contacts"])
logger = logging.getLogger("app.contacts")


# --- Shliach scoping --------------------------------------------------------
def _shliach_contacts_blocked(db: Session, user: models.User) -> bool:
    """fixes18 §6: unless the org opted in (shliach_can_view_contacts, off by
    default), shliach users may not view mekurav contacts at all."""
    if user.role != "shliach":
        return False
    org = db.get(models.Organization, user.organization_id)
    return not (org and org.shliach_can_view_contacts)


def _get_contact_or_404(
    contact_id: int, user: models.User, db: Session
) -> models.Contact:
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == contact_id,
            models.Contact.organization_id == user.organization_id,
        )
        .first()
    )
    if not contact:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    if user.role == "shliach" and not _can_shliach_see(db, user, contact):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    if (
        contact.contact_type == "mekurav"
        and _shliach_contacts_blocked(db, user)
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return contact


def _can_shliach_see(db: Session, user: models.User, contact: models.Contact) -> bool:
    """fixes10 §3.5: a shliach sees only contacts assigned to them (i.e. the
    ones they created — ownership is forced on creation), plus their own
    shliach contact record."""
    if contact.shliach and contact.shliach.user_id == user.id:
        return True  # their own shliach record
    return contact.assigned_user_id == user.guid


# --- Validation helpers -----------------------------------------------------
def _validate_fks(data: dict, org_id: int, db: Session) -> None:
    # assigned_user_id holds the user's GUID (fixes10 §2.1).
    user_guid = data.get("assigned_user_id")
    if user_guid is not None:
        user = (
            db.query(models.User)
            .filter(
                models.User.guid == user_guid,
                models.User.organization_id == org_id,
            )
            .first()
        )
        if not user:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "assigned_user_id does not exist"
            )


_CONTACT_PICKLISTS = {
    "contact_type": "contact.contact_type",
    "pipeline_status": "contact.pipeline_status",
    "color_tag": "contact.color_tag",
}

# Of the 3 above, contact_type is a structural type discriminator and stays a
# real column (fixes32 §0 — excluded from the migration); these 2 move to
# PicklistLink and need popping out of any payload dict before it reaches the
# Contact(**data) constructor / setattr loop.
_CONTACT_LINK_FIELDS = {
    "pipeline_status": "contact.pipeline_status",
    "color_tag": "contact.color_tag",
}


def _validate_picklists(data: dict, org_id: int, db: Session) -> None:
    for field, field_key in _CONTACT_PICKLISTS.items():
        if field in data and data[field] is not None:
            validate_picklist_value(db, org_id, field_key, data[field])


def _split_contact_link_changes(data: dict) -> dict[str, Optional[str]]:
    """Pop pipeline_status/color_tag out of a payload dict (mutates `data`),
    returning field_key -> value ready for `picklist_utils.set_value`."""
    return {
        field_key: data.pop(field)
        for field, field_key in _CONTACT_LINK_FIELDS.items()
        if field in data
    }


def _apply_contact_picklist_fields(out, values: dict[str, Optional[str]]) -> None:
    """Populate an out schema's pipeline_status/color_tag fields from a
    resolved {field_key: value} map (fixes32 — no longer real columns), plus
    (fixes34 §1.1) every other resolved picklist (custom, admin-added contact
    picklists) into `out.picklist_values` — mirroring
    apartments._apply_picklist_fields exactly, so the contacts list/detail
    payloads carry custom picklist values the same way apartments already do."""
    for field, field_key in _CONTACT_LINK_FIELDS.items():
        setattr(out, field, values.get(field_key))
    out.picklist_values = {
        k: v for k, v in values.items() if k not in _CONTACT_LINK_FIELDS.values()
    }


def _check_phone_unique(
    db: Session, org_id: int, phone: str, exclude_id: Optional[int] = None
) -> None:
    query = db.query(models.Contact).filter(
        models.Contact.organization_id == org_id,
        models.Contact.phone == phone,
    )
    if exclude_id is not None:
        query = query.filter(models.Contact.id != exclude_id)
    if query.first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This phone number already exists in the organization")


def _geocode_fallback(data: dict) -> None:
    if data.get("address") and (
        data.get("latitude") is None or data.get("longitude") is None
    ):
        coords = geocode_address(data["address"])
        if coords:
            data["latitude"], data["longitude"] = coords


def _validate_apartment(apartment_id: Optional[int], org_id: int, db: Session) -> None:
    if apartment_id is None:
        return
    ok = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.id == apartment_id,
            models.Apartment.organization_id == org_id,
            # fixes19 §3: only the active version is linkable — historical
            # apartment rows are read-only snapshots.
            models.Apartment.is_display.is_(True),
        )
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "apartment_id does not exist")


def _validate_admin_area(admin_area_id: Optional[int], org_id: int, db: Session) -> None:
    if admin_area_id is None:
        return
    ok = (
        db.query(models.AdminArea)
        .filter(
            models.AdminArea.id == admin_area_id,
            models.AdminArea.organization_id == org_id,
        )
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "admin_area_id does not exist")


# fixes51 §3: contact_shliach.manager_jewish_status is admin-only to edit —
# every other role gets it read-only (rendering side: ContactView.tsx).
_ADMIN_ONLY_PICKLIST_FIELDS = {"contact_shliach.manager_jewish_status"}


def _check_admin_only_picklist_fields(
    current_user: models.User, values: dict
) -> None:
    if current_user.role == "admin":
        return
    blocked = _ADMIN_ONLY_PICKLIST_FIELDS & values.keys()
    if blocked:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "error.admin_only_fields",
            "Only admins may set {fields}", fields=", ".join(sorted(blocked)),
        )


# --- Dynamic picklist values (generic store) -------------------------------
def _apply_picklist_values(
    db: Session, org_id: int, contact: models.Contact, values: dict
) -> None:
    """Upsert (or clear) a contact's dynamic-picklist selections by system_name.
    The picklist must already be a registered definition — `set_value` 400s
    otherwise, the same "unknown picklist" guard this always had."""
    for system_name, value in values.items():
        picklist_utils.set_value(db, org_id, "contacts", contact.id, system_name, value)


# fixes35: a Contact's `contact_type` ("mekurav" | "shliach") is the bare
# column value; custom_field_utils keys definitions by the fuller
# "contact_mekurav" | "contact_shliach" entity_type.
def _custom_field_entity_type(contact_type: str) -> str:
    return f"contact_{contact_type}"


def _apply_contact_custom_field_values(
    db: Session, org_id: int, contact: models.Contact, values: dict
) -> None:
    """Upsert (or clear) a contact's non-select custom field values, scoped
    to whichever entity_type this contact's own contact_type resolves to."""
    entity_type = _custom_field_entity_type(contact.contact_type)
    for field_key, value in values.items():
        custom_field_utils.set_value(db, org_id, entity_type, contact.id, field_key, value)


# --- Detail assembly --------------------------------------------------------
def _shliach_login_status(contact: models.Contact, db: Session) -> str:
    """State of the shliach's login account (fixes26 §4): resolved by the
    user_id link, else by a same-org email match (mirrors core/shliach.py) —
    'active' | 'disabled' | 'missing'."""
    user = None
    if contact.shliach and contact.shliach.user_id:
        user = db.get(models.User, contact.shliach.user_id)
    if user is None and contact.email:
        user = (
            db.query(models.User)
            .filter(
                models.User.organization_id == contact.organization_id,
                func.lower(models.User.email) == contact.email.strip().lower(),
            )
            .first()
        )
    if user is None:
        return "missing"
    return "active" if user.is_active else "disabled"


def _build_detail(contact: models.Contact, db: Session) -> ContactDetailOut:
    org_id = contact.organization_id
    detail = ContactDetailOut.model_validate(contact)
    _apply_contact_picklist_fields(
        detail, picklist_utils.get_values(db, org_id, "contacts", contact.id)
    )
    detail.custom_field_values = custom_field_utils.get_values(
        db, org_id, _custom_field_entity_type(contact.contact_type), contact.id
    )
    _apply_mekurav_geo(detail, contact)
    if contact.mekurav:
        detail.mekurav = MekuravOut.model_validate(contact.mekurav)
        detail.mekurav.potential_next_step = picklist_utils.get_values(
            db, org_id, "contact_mekurav", contact.mekurav.id,
            ["contact.potential_next_step"],
        )["contact.potential_next_step"]
        detail.special_dates = [
            _sd_out(db, org_id, link.special_date_obj)
            for link in contact.mekurav.special_dates
        ]
    if contact.shliach:
        detail.shliach = ShliachOut(
            id=contact.shliach.id,
            contact_id=contact.shliach.contact_id,
            user_id=contact.shliach.user_id,
            notes=contact.shliach.notes,
            full_name=contact.shliach.full_name,
            email=contact.shliach.email,
            phone=contact.shliach.phone,
            report_number_ids=[
                r.report_number_id for r in contact.shliach.report_numbers
            ],
            area_ids=[a.area_id for a in contact.shliach.areas],
            login_status=_shliach_login_status(contact, db),
        )
    return detail


def _sd_out(db: Session, org_id: int, sd: models.SignificantDate) -> SignificantDateOut:
    special_date_type = picklist_utils.get_values(
        db, org_id, "significant_dates", sd.id, ["significant_date.type"]
    )["significant_date.type"]
    return SignificantDateOut(
        id=sd.id,
        guid=sd.guid,
        special_date=sd.special_date,
        hebrew_date=sd.hebrew_date,
        special_date_type=special_date_type,
        special_date_title=sd.special_date_title,
        is_set_reminder=sd.is_set_reminder,
        reminders=[ReminderOut.model_validate(r) for r in sd.reminders],
    )


# --- Shliach login provisioning --------------------------------------------
def _check_shliach_email_unique(
    db: Session, org_id: int, email: str, exclude_contact_id: Optional[int] = None
) -> None:
    """fixes14: one shliach contact per email within an organization (the same
    email may exist in *other* organizations)."""
    query = db.query(models.Contact).filter(
        models.Contact.organization_id == org_id,
        models.Contact.contact_type == "shliach",
        func.lower(models.Contact.email) == email.strip().lower(),
    )
    if exclude_contact_id is not None:
        query = query.filter(models.Contact.id != exclude_contact_id)
    taken = query.first()
    if taken:
        raise email_taken_error(taken)


def _sync_user_email(db: Session, user: models.User, email: Optional[str]) -> bool:
    """fixes14: keep the shliach's login identity in step with the contact
    email. An empty contact email never blanks the login (it's the auth
    identity). The username follows only when it *was* the email."""
    email = email.strip().lower() if email else None
    if not email or email == (user.email or "").lower():
        return False
    dup = (
        db.query(models.User)
        .filter(
            models.User.organization_id == user.organization_id,
            func.lower(models.User.email) == email,
            models.User.id != user.id,
        )
        .first()
    )
    if dup:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This email is already used by another user in the organization",
        )
    if user.username == user.email:
        username_taken = (
            db.query(models.User)
            .filter(
                models.User.organization_id == user.organization_id,
                models.User.username == email,
                models.User.id != user.id,
            )
            .first()
        )
        if not username_taken:
            user.username = email
    user.email = email
    # fixes65 §5: a paper-only activist who now has an email is a regular
    # (Google-or-password) login from here on.
    user.is_manual = False
    return True


def _provision_shliach_user(
    db: Session, org_id: int, contact: models.Contact,
    password: Optional[str] = None,
) -> Optional[models.User]:
    """Create (or reuse) a login User with role 'shliach' for this contact.

    The reuse lookup is org-scoped (fixes14): the same email in another
    organization is a different account and must never be linked across
    tenants. A same-org user already serving a different shliach contact
    is rejected — one login per shliach.

    fixes65 §5: an activist with no email (the admin's "No email" checkbox —
    a paper-only activist who never logs in) still gets a User row, marked
    `is_manual` with no email/password, so they appear in the org's user
    list and can be assigned tasks / credited on paper entries. Adding an
    email later upgrades this same user (see `_sync_user_email`)."""
    if not contact.email:
        full_name = " ".join(filter(None, [contact.last_name, contact.name])) or contact.name
        base = "_".join(full_name.split())[:40] or "activist"
        username, suffix = base, 2
        while (
            db.query(models.User.id)
            .filter(models.User.organization_id == org_id, models.User.username == username)
            .first()
        ):
            username = f"{base}_{suffix}"
            suffix += 1
        user = models.User(
            organization_id=org_id,
            username=username,
            full_name=full_name,
            first_name=contact.name,
            last_name=contact.last_name,
            phone=contact.phone,
            password_hash=None,
            role="shliach",
            is_active=True,
            is_manual=True,
            email_verified=True,
        )
        db.add(user)
        db.flush()
        return user
    existing = (
        db.query(models.User)
        .filter(
            func.lower(models.User.email) == contact.email.strip().lower(),
            models.User.organization_id == org_id,
        )
        .first()
    )
    if existing:
        # fixes28 §2: only a shliach-role account may back a shliach contact —
        # silently reusing a restricted (staff) or admin login would associate
        # a ContactShliach with a non-activist user.
        if existing.role != "shliach":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "This email belongs to an existing user in the organization who is not an activist",
            )
        linked_elsewhere = (
            db.query(models.ContactShliach)
            .filter(
                models.ContactShliach.user_id == existing.id,
                models.ContactShliach.contact_id != contact.id,
                models.ContactShliach.is_display.is_(True),
            )
            .first()
        )
        if linked_elsewhere:
            raise email_taken_error(linked_elsewhere.contact)
        return existing
    full_name = " ".join(filter(None, [contact.last_name, contact.name]))
    user = models.User(
        organization_id=org_id,
        username=contact.email,
        full_name=full_name or contact.name,
        email=contact.email,
        first_name=contact.name,
        last_name=contact.last_name,
        phone=contact.phone,
        # fixes14: without a password the account is Google-only.
        password_hash=hash_password(password) if password else None,
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


# --- CRUD -------------------------------------------------------------------
def _contacts_query(
    db: Session,
    current_user: models.User,
    pipeline_status: Optional[str],
    contact_type: Optional[str],
    assigned_user_id: Optional[str],
    q: Optional[str] = None,
    area_ids: Optional[list[int]] = None,
    building_ids: Optional[list[int]] = None,
    has_mitzvot: bool = False,
    tzedaka_potential: Optional[str] = None,
    admin_area_ids: Optional[list[int]] = None,
    visit_from: Optional[datetime.datetime] = None,
    visit_to: Optional[datetime.datetime] = None,
    torah_thought: Optional[list[str]] = None,
    connection_to_rebbe: Optional[str] = None,
    custom_fields: Optional[list[str]] = None,
    picklist: Optional[list[str]] = None,
    record_status: str = "active",
):
    """The org-scoped, filtered, shliach-aware contacts query (shared by the
    plain list, the paginated list and the bulk-email address list).

    fixes15 §5.1: `q` matches name / last name / phone / email; `area_ids` /
    `building_ids` narrow geographically — a mekurav belongs through its
    apartment's building, a shliach through its coverage links; `has_mitzvot`
    keeps only contacts with at least one community-mitzvah checked. fixes18
    §3: `tzedaka_potential` is an exact match (the value comes from the
    aggregated dropdown); `admin_area_ids` narrows to mekuravim linked to
    those admin areas. fixes39: `has_mitzvot` used to check a fixed set of
    `VisitHistory` boolean columns — now that those are ordinary
    entity_type="visit" boolean custom fields, it generalizes to "any active
    one is checked" (covers admin-added checklist items too, e.g.
    "mezuzah"). The old *named*-list `mitzvot` param (AND-across-keys) is
    gone — `custom_fields` below is mechanistically identical to it now that
    the fields it names are just custom fields, so it absorbed that job
    instead of the app carrying two params that do the same query."""
    query = db.query(models.Contact).filter(
        models.Contact.organization_id == current_user.organization_id,
        # Instinct drafts stay out of every regular list (and the bulk-email /
        # bulk-update sets built on this query) until approved — the contacts
        # page fetches them separately via /list?status=draft.
        models.Contact.status == record_status,
    )
    if pipeline_status is not None:
        query = query.filter(
            models.Contact.id.in_(
                picklist_utils.matching_entity_ids(
                    "contacts", "contact.pipeline_status", [pipeline_status]
                )
            )
        )
    if contact_type is not None:
        query = query.filter(models.Contact.contact_type == contact_type)
    if assigned_user_id is not None:
        query = query.filter(models.Contact.assigned_user_id == assigned_user_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                models.Contact.name.ilike(like),
                models.Contact.last_name.ilike(like),
                models.Contact.phone.ilike(like),
                models.Contact.email.ilike(like),
            )
        )
    # Geographic filters via IN-subqueries — the shliach-role scoping below
    # already outer-joins ContactShliach, so joining again would duplicate rows.
    if contact_type == "shliach":
        # fixes45: ContactShliach is versioned now — every scoping subquery
        # below is scoped to the active row, or a retired version's
        # copied-forward links would resurrect a since-changed assignment.
        if area_ids:
            query = query.filter(
                models.Contact.id.in_(
                    select(models.ContactShliach.contact_id)
                    .join(
                        models.ContactShliachArea,
                        models.ContactShliachArea.contact_shliach_id
                        == models.ContactShliach.id,
                    )
                    .where(
                        models.ContactShliachArea.area_id.in_(area_ids),
                        models.ContactShliach.is_display.is_(True),
                    )
                )
            )
        if building_ids:
            # fixes19: the shliach↔apartment bridge is gone — a shliach relates
            # to geography through covered areas only, so a building filter
            # matches shluchim covering the building's area.
            query = query.filter(
                models.Contact.id.in_(
                    select(models.ContactShliach.contact_id)
                    .join(
                        models.ContactShliachArea,
                        models.ContactShliachArea.contact_shliach_id
                        == models.ContactShliach.id,
                    )
                    .join(
                        models.Building,
                        models.Building.area_id == models.ContactShliachArea.area_id,
                    )
                    .where(
                        models.Building.id.in_(building_ids),
                        models.ContactShliach.is_display.is_(True),
                    )
                )
            )
        # fixes28 §2: the shluchim page must not show rows backed by a
        # restricted (staff) login. Resolution mirrors _login_status_map:
        # the ContactShliach.user_id link decides when present; otherwise a
        # same-org email match.
        staff_ids = select(models.User.id).where(
            models.User.organization_id == current_user.organization_id,
            models.User.role == "staff",
        )
        staff_emails = select(func.lower(models.User.email)).where(
            models.User.organization_id == current_user.organization_id,
            models.User.role == "staff",
            models.User.email.isnot(None),
        )
        linked_to_staff = select(models.ContactShliach.contact_id).where(
            models.ContactShliach.user_id.in_(staff_ids),
            models.ContactShliach.is_display.is_(True),
        )
        linked_to_any = select(models.ContactShliach.contact_id).where(
            models.ContactShliach.user_id.isnot(None),
            models.ContactShliach.is_display.is_(True),
        )
        query = query.filter(
            ~models.Contact.id.in_(linked_to_staff),
            or_(
                # A user_id link to a shliach login wins over any email match.
                models.Contact.id.in_(linked_to_any),
                models.Contact.email.is_(None),
                ~func.lower(models.Contact.email).in_(staff_emails),
            ),
        )
    else:
        if building_ids:
            query = query.filter(
                models.Contact.id.in_(
                    select(models.ContactMekurav.contact_id)
                    .join(
                        models.Apartment,
                        models.Apartment.id == models.ContactMekurav.apartment_id,
                    )
                    .where(models.Apartment.building_id.in_(building_ids))
                )
            )
        if area_ids:
            query = query.filter(
                models.Contact.id.in_(
                    select(models.ContactMekurav.contact_id)
                    .join(
                        models.Apartment,
                        models.Apartment.id == models.ContactMekurav.apartment_id,
                    )
                    .join(
                        models.Building,
                        models.Building.id == models.Apartment.building_id,
                    )
                    .where(models.Building.area_id.in_(area_ids))
                )
            )
    # fixes15 §5.1 / fixes39: at least one active entity_type="visit" boolean
    # custom field is checked on one of the contact's visits — the fixed
    # 5-column check generalizes to "any active one" now that those columns
    # are ordinary custom fields alongside any admin-added checklist item.
    if has_mitzvot:
        query = query.filter(
            models.Contact.id.in_(
                select(models.VisitHistory.contact_id)
                .join(
                    models.CustomFieldValue,
                    models.CustomFieldValue.visit_id == models.VisitHistory.id,
                )
                .join(
                    models.CustomFieldDefinition,
                    models.CustomFieldDefinition.id
                    == models.CustomFieldValue.definition_id,
                )
                .where(
                    models.VisitHistory.contact_id.isnot(None),
                    models.CustomFieldDefinition.organization_id
                    == current_user.organization_id,
                    models.CustomFieldDefinition.entity_type == "visit",
                    models.CustomFieldDefinition.field_type == "boolean",
                    models.CustomFieldDefinition.is_active.is_(True),
                    models.CustomFieldValue.checked.is_(True),
                )
            )
        )
    if tzedaka_potential and tzedaka_potential.strip():
        query = query.filter(
            models.Contact.id.in_(
                select(models.ContactMekurav.contact_id).where(
                    func.trim(models.ContactMekurav.tzedaka_potential)
                    == tzedaka_potential.strip()
                )
            )
        )
    # fixes18 §3.5: filter by the mekurav's admin-area link.
    if admin_area_ids:
        query = query.filter(
            models.Contact.id.in_(
                select(models.ContactMekurav.contact_id).where(
                    models.ContactMekurav.admin_area_id.in_(admin_area_ids)
                )
            )
        )
    # fixes27 §1: more visit-level filters, same through-any-visit semantics
    # as the custom-field filters below.
    if torah_thought:
        query = query.filter(
            models.Contact.id.in_(
                select(models.VisitHistory.contact_id).where(
                    models.VisitHistory.contact_id.isnot(None),
                    models.VisitHistory.id.in_(
                        picklist_utils.matching_entity_ids(
                            "visit_history", "checklist.torah_thought", torah_thought
                        )
                    ),
                )
            )
        )
    # fixes39: connection_to_rebbe is now a text-type entity_type="visit"
    # custom field (CustomFieldValue.value) — no longer a VisitHistory column.
    if connection_to_rebbe and connection_to_rebbe.strip():
        query = query.filter(
            models.Contact.id.in_(
                select(models.VisitHistory.contact_id)
                .join(
                    models.CustomFieldValue,
                    models.CustomFieldValue.visit_id == models.VisitHistory.id,
                )
                .join(
                    models.CustomFieldDefinition,
                    models.CustomFieldDefinition.id
                    == models.CustomFieldValue.definition_id,
                )
                .where(
                    models.VisitHistory.contact_id.isnot(None),
                    models.CustomFieldDefinition.organization_id
                    == current_user.organization_id,
                    models.CustomFieldDefinition.entity_type == "visit",
                    models.CustomFieldDefinition.field_key == "connection_to_rebbe",
                    models.CustomFieldValue.value.ilike(
                        f"%{connection_to_rebbe.strip()}%"
                    ),
                )
            )
        )
    # fixes27 §1 / fixes39: dynamic custom-field filters — every named
    # field_key must be checked on at least one visit (AND across keys). This
    # is also where the pre-fixes39 `mitzvot` filter's job lives now that
    # tefillin/tzedakah/shabbat_candles/torah_pamphlet/letter_in_torah are
    # ordinary boolean custom fields like any admin-added one.
    if custom_fields:
        org_keys = {
            row[0]: row[1]
            for row in db.query(
                models.CustomFieldDefinition.field_key,
                models.CustomFieldDefinition.is_active,
            )
            .filter(
                models.CustomFieldDefinition.organization_id
                == current_user.organization_id,
                # fixes35: this filter is specifically the visit-scoped
                # boolean checklist (joined through VisitHistory below) —
                # field_key is now only unique per (org, entity_type), so
                # scope explicitly instead of risking a same-named
                # non-visit custom field shadowing this lookup.
                models.CustomFieldDefinition.entity_type == "visit",
                models.CustomFieldDefinition.field_type == "boolean",
            )
            .all()
        }
        for key in custom_fields:
            if key not in org_keys:
                raise api_error(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, "error.not_a_custom_field",
                    "'{key}' is not a custom field", key=key,
                )
            # fixes28 §3: a deactivated (hidden) custom field never filters.
            if not org_keys[key]:
                continue
            query = query.filter(
                models.Contact.id.in_(
                    select(models.VisitHistory.contact_id)
                    .join(
                        models.CustomFieldValue,
                        models.CustomFieldValue.visit_id == models.VisitHistory.id,
                    )
                    .join(
                        models.CustomFieldDefinition,
                        models.CustomFieldDefinition.id
                        == models.CustomFieldValue.definition_id,
                    )
                    .where(
                        models.VisitHistory.contact_id.isnot(None),
                        models.CustomFieldDefinition.field_key == key,
                        models.CustomFieldValue.checked.is_(True),
                    )
                )
            )
    # fixes34 §1.1: dynamic filter for any custom (org-added) contact
    # picklist, sent as repeated "field_key:value" pairs (OR within a
    # field_key, AND across) — mirrors apartments' `picklist` param exactly.
    if picklist:
        by_key: dict[str, list[str]] = {}
        for entry in picklist:
            key, sep, value = entry.partition(":")
            if sep:
                by_key.setdefault(key, []).append(value)
        for field_key, values in by_key.items():
            if values:
                query = query.filter(
                    models.Contact.id.in_(
                        picklist_utils.matching_entity_ids(
                            "contacts", field_key, values
                        )
                    )
                )
    # fixes25 §4: visit date range (טווח תאריכי ביקור) — only contacts holding
    # at least one visit inside the range (the spec's inner-join semantics).
    if visit_from is not None or visit_to is not None:
        conds = [models.VisitHistory.contact_id.isnot(None)]
        if visit_from is not None:
            conds.append(models.VisitHistory.visit_date >= visit_from)
        if visit_to is not None:
            # A date-only bound means "through the end of that day".
            upper = visit_to
            if upper.time() == datetime.time.min:
                upper = upper + datetime.timedelta(days=1)
                conds.append(models.VisitHistory.visit_date < upper)
            else:
                conds.append(models.VisitHistory.visit_date <= upper)
        query = query.filter(
            models.Contact.id.in_(select(models.VisitHistory.contact_id).where(*conds))
        )

    if current_user.role == "shliach":
        # fixes10 §3.5: ownership isolation — only contacts assigned to this
        # shliach (they created them), plus their own shliach contact record.
        # fixes45: the join condition (not a WHERE filter — this is a LEFT
        # OUTER JOIN) is scoped to the active version, or a contact with N
        # retired versions would fan out into N+1 duplicate result rows.
        query = query.outerjoin(
            models.ContactShliach,
            (models.ContactShliach.contact_id == models.Contact.id)
            & (models.ContactShliach.is_display.is_(True)),
        ).filter(
            (models.Contact.assigned_user_id == current_user.guid)
            | (models.ContactShliach.user_id == current_user.id)
        )
        # fixes18 §6: without the org's opt-in, mekurav contacts vanish
        # entirely (their own shliach record keeps resolving).
        if _shliach_contacts_blocked(db, current_user):
            query = query.filter(models.Contact.contact_type == "shliach")
    return query


@router.get("", response_model=list[ContactOut])
def list_contacts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
    pipeline_status: Optional[str] = None,
    contact_type: Optional[str] = None,
    assigned_user_id: Optional[str] = None,
):
    query = _contacts_query(
        db, current_user, pipeline_status, contact_type, assigned_user_id
    )
    # fixes52 §6: natural sort.
    rows = query.order_by(*natural_sort_keys(models.Contact.name, db)).all()
    picklist_map = picklist_utils.get_values_bulk(
        db, current_user.organization_id, "contacts", [c.id for c in rows]
    )
    custom_field_map = _custom_field_map_bulk(
        db, current_user.organization_id, [c.id for c in rows]
    )
    return [
        _list_item(c, picklist_map.get(c.id, {}), custom_field_map.get(c.id, {}))
        for c in rows
    ]


def _custom_field_map_bulk(db: Session, org_id: int, contact_ids: list[int]) -> dict[int, dict]:
    """fixes35: a list of contacts can mix both contact_types (e.g. the plain
    unfiltered /api/contacts), so bulk-fetch both entity_types' values and
    merge — a given contact only ever appears in the map matching its own
    contact_type, since values are only ever written under that type."""
    mekurav_map = custom_field_utils.get_values_bulk(db, org_id, "contact_mekurav", contact_ids)
    shliach_map = custom_field_utils.get_values_bulk(db, org_id, "contact_shliach", contact_ids)
    return {
        cid: {**mekurav_map.get(cid, {}), **shliach_map.get(cid, {})} for cid in contact_ids
    }


def _apply_mekurav_geo(out: ContactOut, contact: models.Contact) -> None:
    """Populate the building/area/admin-area display names (fixes15 §5.1,
    fixes18 §3.4) plus the raw apartment_id/admin_area_id an inline editor
    needs as its current value (fixes48 §2) — shared by the list rows and the
    single-contact detail response, so a PATCH result merged straight into a
    grid row carries fresh names, not stale/missing ones."""
    if not contact.mekurav:
        return
    out.apartment_id = contact.mekurav.apartment_id
    out.admin_area_id = contact.mekurav.admin_area_id
    apartment = contact.mekurav.apartment
    if apartment and apartment.building:
        out.building_name = building_display_name(apartment.building)
        if apartment.building.area:
            out.area_name = apartment.building.area.area_name
    if contact.mekurav.admin_area:
        out.admin_area_name = contact.mekurav.admin_area.name


def _list_item(
    contact: models.Contact,
    picklist_map: dict[str, Optional[str]],
    custom_field_map: Optional[dict[str, object]] = None,
) -> ContactOut:
    """A list row enriched with the mekurav apartment's building/area names
    (fixes15 §5.1 optional grid columns)."""
    out = ContactOut.model_validate(contact)
    _apply_contact_picklist_fields(out, picklist_map)
    out.custom_field_values = custom_field_map or {}
    _apply_mekurav_geo(out, contact)
    return out


def _login_status_map(db: Session, rows: list[models.Contact]) -> dict[int, str]:
    """contact_id → login-account state for the shliach rows of a list page
    (fixes27 §3). One batched user lookup; resolution mirrors core/shliach.py
    (user_id link first, else a same-org email match)."""
    shluchim = [c for c in rows if c.contact_type == "shliach"]
    if not shluchim:
        return {}
    org_id = shluchim[0].organization_id
    user_ids = {c.shliach.user_id for c in shluchim if c.shliach and c.shliach.user_id}
    emails = {c.email.strip().lower() for c in shluchim if c.email and c.email.strip()}
    users = (
        db.query(models.User)
        .filter(
            models.User.organization_id == org_id,
            or_(
                models.User.id.in_(user_ids or {0}),
                func.lower(models.User.email).in_(emails or {""}),
            ),
        )
        .all()
    )
    by_id = {u.id: u for u in users}
    by_email = {u.email.strip().lower(): u for u in users if u.email}
    out: dict[int, str] = {}
    for c in shluchim:
        user = by_id.get(c.shliach.user_id) if c.shliach and c.shliach.user_id else None
        if user is None and c.email:
            user = by_email.get(c.email.strip().lower())
        if user is None:
            out[c.id] = "missing"
        else:
            out[c.id] = "active" if user.is_active else "disabled"
    return out


@router.get("/list", response_model=ContactPageOut)
def list_contacts_paginated(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
    pipeline_status: Optional[str] = None,
    contact_type: Optional[str] = None,
    assigned_user_id: Optional[str] = None,
    q: Optional[str] = None,
    area_ids: Optional[list[int]] = Query(None),
    building_ids: Optional[list[int]] = Query(None),
    has_mitzvot: bool = False,
    tzedaka_potential: Optional[str] = None,
    admin_area_ids: Optional[list[int]] = Query(None),
    visit_from: Optional[datetime.datetime] = None,
    visit_to: Optional[datetime.datetime] = None,
    torah_thought: Optional[list[str]] = Query(None),
    connection_to_rebbe: Optional[str] = None,
    custom_fields: Optional[list[str]] = Query(None),
    picklist: Optional[list[str]] = Query(None),
    sort: Literal["name", "created"] = "name",
    dir: Literal["asc", "desc"] = "asc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    # `status` itself would shadow fastapi.status inside this function.
    record_status: Literal["active", "draft"] = Query("active", alias="status"),
):
    """One server-side page of contacts (same fixes8 §2C pattern as the
    apartments list) — the contacts page uses this instead of the full dump.
    Sorting (fixes11 §2.3): alphabetical (`name`) or `created` (creation date);
    the page's default presentation is created-descending. fixes15 §5.1 adds
    the apartments-style filters (q / area_ids / building_ids / has_mitzvot)."""
    if page_size not in (20, 50, 100):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "page_size must be 20, 50 or 100"
        )
    query = _contacts_query(
        db, current_user, pipeline_status, contact_type, assigned_user_id,
        q=q, area_ids=area_ids, building_ids=building_ids, has_mitzvot=has_mitzvot,
        tzedaka_potential=tzedaka_potential,
        admin_area_ids=admin_area_ids, visit_from=visit_from, visit_to=visit_to,
        torah_thought=torah_thought, connection_to_rebbe=connection_to_rebbe,
        custom_fields=custom_fields, picklist=picklist, record_status=record_status,
    )
    total = query.count()
    if sort == "created":
        order = [
            models.Contact.created_at.desc()
            if dir == "desc"
            else models.Contact.created_at.asc()
        ]
    else:
        # fixes52 §6: natural sort.
        order = [
            k.desc() if dir == "desc" else k.asc()
            for k in natural_sort_keys(models.Contact.name, db)
        ]
    rows = (
        query.order_by(*order, models.Contact.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    picklist_map = picklist_utils.get_values_bulk(
        db, current_user.organization_id, "contacts", [c.id for c in rows]
    )
    custom_field_map = _custom_field_map_bulk(
        db, current_user.organization_id, [c.id for c in rows]
    )
    items = [
        _list_item(c, picklist_map.get(c.id, {}), custom_field_map.get(c.id, {}))
        for c in rows
    ]
    # fixes27 §3: shliach rows carry their login-account state so the list can
    # flag suspended/deleted logins inline.
    statuses = _login_status_map(db, rows)
    for item in items:
        if item.id in statuses:
            item.login_status = statuses[item.id]
    return ContactPageOut(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/emails", response_model=list[str])
def list_contact_emails(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    pipeline_status: Optional[str] = None,
    contact_type: Optional[str] = None,
    assigned_user_id: Optional[str] = None,
    q: Optional[str] = None,
    area_ids: Optional[list[int]] = Query(None),
    building_ids: Optional[list[int]] = Query(None),
    has_mitzvot: bool = False,
    tzedaka_potential: Optional[str] = None,
    admin_area_ids: Optional[list[int]] = Query(None),
    torah_thought: Optional[list[str]] = Query(None),
    connection_to_rebbe: Optional[str] = None,
    custom_fields: Optional[list[str]] = Query(None),
    picklist: Optional[list[str]] = Query(None),
):
    """The distinct email addresses of every contact matching the same filter
    set as /list (fixes15 §5.2) — feeds the bulk `mailto:` BCC action, so it
    spans the whole filtered set, not just the visible page."""
    query = _contacts_query(
        db, current_user, pipeline_status, contact_type, assigned_user_id,
        q=q, area_ids=area_ids, building_ids=building_ids, has_mitzvot=has_mitzvot,
        tzedaka_potential=tzedaka_potential,
        admin_area_ids=admin_area_ids, torah_thought=torah_thought,
        connection_to_rebbe=connection_to_rebbe, custom_fields=custom_fields,
        picklist=picklist,
    )
    rows = (
        query.filter(models.Contact.email.isnot(None), models.Contact.email != "")
        .order_by(*natural_sort_keys(models.Contact.name, db))
        .all()
    )
    seen: set[str] = set()
    emails: list[str] = []
    for c in rows:
        key = c.email.strip().lower()
        if key and key not in seen:
            seen.add(key)
            emails.append(c.email.strip())
    return emails


@router.get("/tzedaka-values", response_model=list[str])
def list_tzedaka_values(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """The distinct non-empty tzedaka-potential values in the org (fixes18 §3.2)
    — feeds the contacts page's dropdown filter. Scoped like the list itself,
    so a shliach only aggregates values from contacts they can see."""
    query = _contacts_query(db, current_user, None, "mekurav", None)
    rows = (
        query.join(
            models.ContactMekurav,
            models.ContactMekurav.contact_id == models.Contact.id,
        )
        .with_entities(models.ContactMekurav.tzedaka_potential)
        .filter(models.ContactMekurav.tzedaka_potential.isnot(None))
        .distinct()
        .all()
    )
    return sorted({r[0].strip() for r in rows if r[0] and r[0].strip()})


@router.post("/bulk-update", response_model=ContactBulkUpdateResult)
def bulk_update_contacts(
    payload: ContactBulkUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes43 §1: reassign "Assigned To" on every contact matching the page's
    current filters — mirrors the apartments bulk-update pattern (fixes23 §3):
    the filter block is identical to GET /api/contacts/list, so "everything
    currently on screen" is exactly what this touches. A shliach cannot
    reassign ownership (same guard as the single-record PATCH)."""
    if current_user.role == "shliach":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "shliach users cannot reassign contacts"
        )
    if payload.new_assigned_user_id is not None:
        _validate_fks(
            {"assigned_user_id": payload.new_assigned_user_id},
            current_user.organization_id,
            db,
        )
    query = _contacts_query(
        db, current_user, payload.pipeline_status, payload.contact_type,
        payload.assigned_user_id,
        q=payload.q, area_ids=payload.area_ids, building_ids=payload.building_ids,
        has_mitzvot=payload.has_mitzvot,
        tzedaka_potential=payload.tzedaka_potential,
        admin_area_ids=payload.admin_area_ids,
        visit_from=payload.visit_from, visit_to=payload.visit_to,
        torah_thought=payload.torah_thought,
        connection_to_rebbe=payload.connection_to_rebbe,
        custom_fields=payload.custom_fields, picklist=payload.picklist,
    )
    contacts = query.all()
    for c in contacts:
        c.assigned_user_id = payload.new_assigned_user_id
    db.commit()
    return ContactBulkUpdateResult(updated=len(contacts))


@router.post("/shliach/clear-report-numbers", response_model=ShliachClearReportNumbersResult)
def clear_shliach_report_numbers(
    payload: ShliachClearReportNumbersIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes43 §3.4 / fixes48 §3: "ניקוי שיבוצים" — clear the report-number
    assignment from every shliach contact in `contact_ids` (the Users page's
    current filtered view). Admin-only, irreversible (the frontend confirms
    before calling). fixes45: applied as a versioned edit per shliach, same as
    any other coverage change, only touching the active row of each lineage.
    fixes48: this originally cleared `areas` instead — area assignment must
    be left untouched, only report_numbers is in scope for this action."""
    shluchim = (
        db.query(models.ContactShliach)
        .join(models.Contact, models.Contact.id == models.ContactShliach.contact_id)
        .filter(
            models.Contact.organization_id == admin.organization_id,
            models.ContactShliach.contact_id.in_(payload.contact_ids),
            models.ContactShliach.is_display.is_(True),
        )
        .all()
    )
    updated = 0
    for shliach in shluchim:
        if not shliach.report_numbers:
            continue
        new = apply_shliach_versioned_update(db, shliach, {}, admin)
        set_shliach_report_numbers(db, new, [], org_id=admin.organization_id)
        db.commit()
        updated += 1
    return ShliachClearReportNumbersResult(updated=updated)


@router.post("", response_model=ContactDetailOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
):
    org_id = current_user.organization_id
    data = payload.model_dump(
        exclude={"mekurav", "shliach", "picklist_values", "custom_field_values"}
    )

    # fixes10 §3.3/§3.4: a shliach may create mekurav contacts only (creating a
    # shliach contact provisions a login user — admin/staff flows), and their
    # ownership is forced regardless of the payload.
    if current_user.role == "shliach":
        if data.get("contact_type") == "shliach":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "A shliach cannot create shliach contacts",
            )
        data["assigned_user_id"] = current_user.guid
    # fixes54 §8: the superadmin "Activist system" toggle — off blocks
    # provisioning new activist logins for this org (existing ones are
    # untouched; see org_prefs.effective_flags for the cascade this lives in).
    if data.get("contact_type") == "shliach" and not org_prefs.effective_flags(
        db, org_id
    )["activist_system_enabled"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "The activist system is disabled for this organization",
        )
    # fixes10 §2.2: every new contact is owned by its creator unless the
    # payload explicitly assigns someone else.
    elif not data.get("assigned_user_id"):
        data["assigned_user_id"] = current_user.guid

    _validate_fks(data, org_id, db)
    _validate_picklists(data, org_id, db)
    if data.get("phone"):
        _check_phone_unique(db, org_id, data["phone"])
    if data.get("contact_type") == "shliach" and data.get("email"):
        _check_shliach_email_unique(db, org_id, data["email"])
    _geocode_fallback(data)
    link_changes = _split_contact_link_changes(data)

    contact = models.Contact(**data, organization_id=org_id)
    db.add(contact)
    db.flush()
    for field_key, value in link_changes.items():
        if value is not None:
            picklist_utils.set_value(db, org_id, "contacts", contact.id, field_key, value)

    if contact.contact_type == "shliach":
        sh = payload.shliach
        user = _provision_shliach_user(
            db, org_id, contact, password=sh.password if sh else None
        )
        # fixes45: the first version of the lineage — seed the identity
        # snapshot from the just-(re)provisioned login user, falling back to
        # the contact itself when no login could be created (no email yet).
        shliach = models.ContactShliach(
            organization_id=org_id,
            contact_id=contact.id,
            notes=sh.notes if sh else None,
            full_name=user.full_name if user else contact.name,
            email=user.email if user else contact.email,
            phone=user.phone if user else contact.phone,
        )
        if user:
            shliach.user_id = user.id
        db.add(shliach)
        db.flush()
        if sh and sh.report_number_ids:
            set_shliach_report_numbers(db, shliach, sh.report_number_ids, org_id)
        if sh and sh.area_ids:
            set_shliach_areas(db, shliach, sh.area_ids, org_id)
        # Email the new shliach their access link (admin-triggered).
        if contact.email:
            org_name = (
                current_user.organization.name if current_user.organization else ""
            )
            try:
                send_shliach_welcome(
                    db,
                    to=contact.email,
                    first_name=contact.name,
                    last_name=contact.last_name or "",
                    shliach_email=contact.email,
                    org_name=org_name,
                    # fixes17 §1.3: replies go to the admin who created them.
                    reply_to=current_user.email,
                    # Activist mail carries the organization's logo.
                    org_logo_url=current_user.organization.logo_url if current_user.organization else None,
                )
            except Exception:  # pragma: no cover - email must not block creation
                logger.exception("Failed to send shliach welcome email")
    else:
        mk = payload.mekurav
        mk_data = mk.model_dump() if mk else {}
        potential_next_step = mk_data.pop("potential_next_step", None)
        if potential_next_step:
            validate_picklist_value(
                db, org_id, "contact.potential_next_step", potential_next_step
            )
        _validate_apartment(mk_data.get("apartment_id"), org_id, db)
        _validate_admin_area(mk_data.get("admin_area_id"), org_id, db)
        mekurav = models.ContactMekurav(
            organization_id=org_id, contact_id=contact.id, **mk_data
        )
        db.add(mekurav)
        if potential_next_step:
            db.flush()
            picklist_utils.set_value(
                db, org_id, "contact_mekurav", mekurav.id,
                "contact.potential_next_step", potential_next_step,
            )

    if payload.picklist_values:
        _check_admin_only_picklist_fields(current_user, payload.picklist_values)
        _apply_picklist_values(db, org_id, contact, payload.picklist_values)
    if payload.custom_field_values:
        _apply_contact_custom_field_values(db, org_id, contact, payload.custom_field_values)

    db.commit()
    db.refresh(contact)
    return _build_detail(contact, db)


@router.post("/{contact_id}/approve", response_model=ContactDetailOut)
def approve_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_or_admin),
):
    """Approve an Instinct draft: status 'draft' -> 'active', which moves it
    into the regular contacts lists. Idempotent on an already-active contact."""
    contact = _get_contact_or_404(contact_id, current_user, db)
    if contact.status != "active":
        contact.status = "active"
        db.commit()
        db.refresh(contact)
    return _build_detail(contact, db)


@router.get("/{contact_id}", response_model=ContactDetailOut)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = _get_contact_or_404(contact_id, current_user, db)
    return _build_detail(contact, db)


@router.get(
    "/{contact_id}/shliach-history", response_model=list[ShliachVersionOut]
)
def shliach_edit_history(
    contact_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes45: previous versions of this shliach's lineage, newest first —
    same full-row-snapshot history view as the Apartments module's."""
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.id == contact_id,
            models.Contact.organization_id == admin.organization_id,
            models.Contact.contact_type == "shliach",
        )
        .first()
    )
    if not contact or not contact.shliach:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shliach contact not found")
    root_id = contact.shliach.root_id or contact.shliach.id
    versions = (
        db.query(models.ContactShliach)
        .filter(
            models.ContactShliach.organization_id == admin.organization_id,
            models.ContactShliach.is_display.is_(False),
            or_(
                models.ContactShliach.root_id == root_id,
                models.ContactShliach.id == root_id,
            ),
        )
        .order_by(
            models.ContactShliach.last_edit.desc().nullslast(),
            models.ContactShliach.id.desc(),
        )
        .all()
    )
    return [
        ShliachVersionOut(
            id=v.id,
            contact_id=v.contact_id,
            user_id=v.user_id,
            notes=v.notes,
            full_name=v.full_name,
            email=v.email,
            phone=v.phone,
            report_number_ids=[rn.report_number_id for rn in v.report_numbers],
            area_ids=[a.area_id for a in v.areas],
            last_edit=v.last_edit,
            editor_name=v.editor.full_name if v.editor else None,
        )
        for v in versions
    ]


# PATCH is an alias (fixes26 §2): the handler is already partial via
# exclude_unset, and the inline-editing autosave sends one field at a time.
@router.put("/{contact_id}", response_model=ContactDetailOut)
@router.patch("/{contact_id}", response_model=ContactDetailOut)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    _forbid: models.User = Depends(forbid_campaign_manager),
):
    org_id = current_user.organization_id
    contact = _get_contact_or_404(contact_id, current_user, db)
    data = payload.model_dump(
        exclude_unset=True,
        exclude={"mekurav", "shliach", "picklist_values", "custom_field_values"},
    )
    if current_user.role == "shliach":
        data.pop("assigned_user_id", None)  # a shliach cannot reassign ownership

    # fixes53 §7/§8: a shliach editing their OWN profile ("Edit your data")
    # can never touch Email, Report Numbers, or Areas — always locked, since
    # those are integrity-sensitive (self-reassigning your own coverage, or
    # your login identity). An admin can additionally lock name/last_name/
    # phone/notes via shliach_view_config.self_edit_locked_fields (§8's
    # field-lock UI); dynamic admin-added shliach fields are guarded
    # client-side only, not enforced here.
    is_self_edit = (
        current_user.role == "shliach"
        and contact.contact_type == "shliach"
        and contact.shliach is not None
        and contact.shliach.user_id == current_user.id
    )
    self_edit_locked: set = set()
    if is_self_edit:
        data.pop("email", None)
        org = db.get(models.Organization, org_id)
        if org and org.shliach_view_config:
            self_edit_locked = set(org.shliach_view_config.get("self_edit_locked_fields") or [])
        for key in ("name", "last_name", "phone"):
            if key in self_edit_locked:
                data.pop(key, None)
    _validate_fks(data, org_id, db)
    _validate_picklists(data, org_id, db)
    if data.get("phone"):
        _check_phone_unique(db, org_id, data["phone"], exclude_id=contact_id)
    _geocode_fallback(data)
    link_changes = _split_contact_link_changes(data)
    for field, value in data.items():
        setattr(contact, field, value)
    for field_key, value in link_changes.items():
        picklist_utils.set_value(db, org_id, "contacts", contact.id, field_key, value)
    if contact.contact_type == "shliach" and data.get("email"):
        _check_shliach_email_unique(
            db, org_id, contact.email, exclude_contact_id=contact.id
        )

    if payload.mekurav is not None and contact.contact_type == "mekurav":
        mk_data = payload.mekurav.model_dump(exclude_unset=True)
        has_next_step = "potential_next_step" in mk_data
        potential_next_step = mk_data.pop("potential_next_step", None)
        if potential_next_step:
            validate_picklist_value(
                db, org_id, "contact.potential_next_step", potential_next_step
            )
        if "apartment_id" in mk_data:
            _validate_apartment(mk_data["apartment_id"], org_id, db)
        if "admin_area_id" in mk_data:
            _validate_admin_area(mk_data["admin_area_id"], org_id, db)
        if contact.mekurav is None:
            contact.mekurav = models.ContactMekurav(
                organization_id=org_id, contact_id=contact.id
            )
            db.flush()
        for field, value in mk_data.items():
            setattr(contact.mekurav, field, value)
        if has_next_step:
            picklist_utils.set_value(
                db, org_id, "contact_mekurav", contact.mekurav.id,
                "contact.potential_next_step", potential_next_step,
            )

    if contact.contact_type == "shliach":
        # fixes45: every shliach edit — whether it came in as a `shliach`
        # sub-payload (notes/report numbers/areas/password) or as a plain
        # contact-field edit (name/last_name/phone/email) — collapses into
        # at most one new ContactShliach version, mirroring apartments'
        # "one edit, one version" contract instead of the old field-level
        # diff log.
        sh_data = payload.shliach
        # fixes26 §2: only touch what the client actually sent — a per-field
        # autosave patching {shliach: {notes}} must not wipe the report-number
        # and area links (their schema defaults are empty lists).
        sh_sent = sh_data.model_dump(exclude_unset=True) if sh_data is not None else {}
        if is_self_edit:
            sh_sent.pop("report_number_ids", None)
            sh_sent.pop("area_ids", None)
            if "notes" in self_edit_locked:
                sh_sent.pop("notes", None)
        active = contact.shliach

        if active is None:
            # No prior row to retire — this is the lineage's first version.
            user = _provision_shliach_user(
                db, org_id, contact,
                password=sh_data.password if sh_data else None,
            )
            active = models.ContactShliach(
                organization_id=org_id,
                contact_id=contact.id,
                notes=sh_data.notes if sh_data else None,
                full_name=user.full_name if user else contact.name,
                email=user.email if user else contact.email,
                phone=user.phone if user else contact.phone,
                user_id=user.id if user else None,
            )
            db.add(active)
            db.flush()
            if "report_number_ids" in sh_sent:
                set_shliach_report_numbers(
                    db, active, sh_data.report_number_ids, org_id
                )
            if "area_ids" in sh_sent:
                set_shliach_areas(db, active, sh_data.area_ids, org_id)
            contact.shliach = active
        else:
            changes: dict = {}
            if "notes" in sh_sent:
                changes["notes"] = sh_data.notes
            # Contact-level identity edits (from the Contacts page) feed the
            # same versioned snapshot as a shliach sub-payload edit.
            if {"name", "last_name"} & data.keys():
                changes["full_name"] = (
                    " ".join(filter(None, [contact.last_name, contact.name]))
                    or contact.name
                )
            if "phone" in data:
                changes["phone"] = contact.phone
            if "email" in data:
                changes["email"] = contact.email
            if active.user_id is None:
                user = _provision_shliach_user(
                    db, org_id, contact,
                    password=sh_data.password if sh_data else None,
                )
                if user:
                    changes["user_id"] = user.id
            elif sh_data and sh_data.password:
                # fixes14: let the admin (re)set the shliach's login password
                # — without one the account is Google-only and may be locked
                # out. A password reset alone doesn't warrant a new version.
                login_user = db.get(models.User, active.user_id)
                if login_user:
                    login_user.password_hash = hash_password(sh_data.password)

            if changes or "report_number_ids" in sh_sent or "area_ids" in sh_sent:
                new = apply_shliach_versioned_update(db, active, changes, current_user)
                if "report_number_ids" in sh_sent:
                    set_shliach_report_numbers(db, new, sh_data.report_number_ids, org_id)
                if "area_ids" in sh_sent:
                    set_shliach_areas(db, new, sh_data.area_ids, org_id)
                db.commit()
                contact.shliach = new

    welcome_to: Optional[str] = None
    # Keep the shliach's *login user* in sync with the contact. The user's
    # full_name (shown in their own session) is a separate field from the
    # contact name an admin edits — without this, the shliach kept seeing the
    # old name after an admin renamed them. fixes14: the email (the login
    # identity itself) is synced too.
    if (
        contact.contact_type == "shliach"
        and contact.shliach
        and contact.shliach.user_id
    ):
        user = db.get(models.User, contact.shliach.user_id)
        if user:
            user.full_name = (
                " ".join(filter(None, [contact.last_name, contact.name]))
                or contact.name
            )
            user.first_name = contact.name
            user.last_name = contact.last_name
            user.phone = contact.phone
            if _sync_user_email(db, user, contact.email):
                welcome_to = user.email

    if payload.picklist_values is not None:
        _check_admin_only_picklist_fields(current_user, payload.picklist_values)
        _apply_picklist_values(db, org_id, contact, payload.picklist_values)
    if payload.custom_field_values is not None:
        _apply_contact_custom_field_values(db, org_id, contact, payload.custom_field_values)

    db.commit()
    db.refresh(contact)
    if welcome_to:
        # fixes75 §10: a login email changed from the contact form gets the
        # same welcome email as a new user. The users page already did this
        # (fixes69); this edit path never did.
        try:
            send_shliach_welcome(
                db,
                to=welcome_to,
                first_name=contact.name,
                last_name=contact.last_name or "",
                shliach_email=welcome_to,
                org_name=current_user.organization.name if current_user.organization else "",
                reply_to=current_user.email,
                # Activist mail carries the organization's logo.
                org_logo_url=current_user.organization.logo_url if current_user.organization else None,
            )
        except Exception:  # pragma: no cover — email must not block the edit
            logger.exception("Failed to send welcome email to %s", welcome_to)
    return _build_detail(contact, db)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = _get_contact_or_404(contact_id, current_user, db)
    # fixes32: picklist_links aren't cascade-deleted at the DB level (entity_id
    # isn't a real FK) — clean up the contact's own links plus its mekurav
    # (cascade-deleted with it) and its visits (also cascade-deleted).
    visit_ids = [v.id for v in contact.visits]
    mekurav_id = contact.mekurav.id if contact.mekurav else None
    picklist_utils.delete_links(db, "contacts", contact.id)
    if mekurav_id is not None:
        picklist_utils.delete_links(db, "contact_mekurav", mekurav_id)
    picklist_utils.delete_links_many(db, "visit_history", visit_ids)
    # fixes35: contact-scoped (contact_mekurav/contact_shliach) custom field
    # values — visit-scoped ones are cleaned up by VisitHistory.custom_values'
    # own delete-orphan cascade instead (they still populate visit_id).
    custom_field_utils.delete_values(db, "contacts", contact.id)
    db.delete(contact)
    db.commit()


# fixes25: the checklist + custom-fields sub-resources moved to visits — see
# routers/visits.py (/api/visits/{id}/custom-fields; Mivtzoim flags are plain
# visit columns).


# --- Significant dates sub-resource (mekurav only) -------------------------
def _require_mekurav(contact: models.Contact, db: Session) -> models.ContactMekurav:
    if contact.contact_type != "mekurav":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Significant dates apply to mekurav contacts"
        )
    if contact.mekurav is None:
        contact.mekurav = models.ContactMekurav(
            organization_id=contact.organization_id, contact_id=contact.id
        )
        db.flush()
    return contact.mekurav


def _apply_reminders(
    db: Session, sd: models.SignificantDate, reminders, org_id: int
) -> None:
    for r in list(sd.reminders):
        db.delete(r)
    db.flush()
    for r in reminders or []:
        db.add(
            models.SignificantDateReminder(
                organization_id=org_id,
                significant_date_id=sd.id,
                offset_minutes=r.offset_minutes,
                remind_at_time=r.remind_at_time,
                channel=r.channel,
            )
        )


@router.get("/{contact_id}/special-dates", response_model=list[SignificantDateOut])
def list_special_dates(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = _get_contact_or_404(contact_id, current_user, db)
    if not contact.mekurav:
        return []
    org_id = current_user.organization_id
    return [
        _sd_out(db, org_id, link.special_date_obj)
        for link in contact.mekurav.special_dates
    ]


@router.post(
    "/{contact_id}/special-dates",
    response_model=SignificantDateOut,
    status_code=status.HTTP_201_CREATED,
)
def add_special_date(
    contact_id: int,
    payload: SignificantDateCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    contact = _get_contact_or_404(contact_id, current_user, db)
    mekurav = _require_mekurav(contact, db)
    # special_date_title is free text (fixes4); only the type is picklist-constrained.
    validate_picklist_value(
        db, org_id, "significant_date.type", payload.special_date_type
    )

    sd = models.SignificantDate(
        organization_id=org_id,
        special_date=payload.special_date,
        hebrew_date=payload.hebrew_date,
        special_date_title=payload.special_date_title,
        is_set_reminder=payload.is_set_reminder,
    )
    db.add(sd)
    db.flush()
    if payload.special_date_type is not None:
        picklist_utils.set_value(
            db, org_id, "significant_dates", sd.id,
            "significant_date.type", payload.special_date_type,
        )
    _apply_reminders(db, sd, payload.reminders, org_id)
    db.add(
        models.ContactMekuravSpecialDate(
            organization_id=org_id,
            contact_mekurav_id=mekurav.id,
            special_date_id=sd.id,
        )
    )
    db.commit()
    db.refresh(sd)
    return _sd_out(db, org_id, sd)


@router.put(
    "/{contact_id}/special-dates/{sd_id}", response_model=SignificantDateOut
)
def update_special_date(
    contact_id: int,
    sd_id: int,
    payload: SignificantDateUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    contact = _get_contact_or_404(contact_id, current_user, db)
    sd = (
        db.query(models.SignificantDate)
        .filter(
            models.SignificantDate.id == sd_id,
            models.SignificantDate.organization_id == org_id,
        )
        .first()
    )
    if not sd:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Significant date not found")
    data = payload.model_dump(exclude_unset=True)
    reminders = data.pop("reminders", None)
    if "special_date_type" in data:
        picklist_utils.set_value(
            db, org_id, "significant_dates", sd.id,
            "significant_date.type", data.pop("special_date_type"),
        )
    # special_date_title is free text (fixes4) — no picklist validation.
    for field, value in data.items():
        setattr(sd, field, value)
    if reminders is not None:
        _apply_reminders(db, sd, payload.reminders, org_id)
    db.commit()
    db.refresh(sd)
    return _sd_out(db, org_id, sd)


@router.delete(
    "/{contact_id}/special-dates/{sd_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_special_date(
    contact_id: int,
    sd_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    _get_contact_or_404(contact_id, current_user, db)
    sd = (
        db.query(models.SignificantDate)
        .filter(
            models.SignificantDate.id == sd_id,
            models.SignificantDate.organization_id == org_id,
        )
        .first()
    )
    if not sd:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Significant date not found")
    picklist_utils.delete_links(db, "significant_dates", sd.id)
    db.delete(sd)
    db.commit()
