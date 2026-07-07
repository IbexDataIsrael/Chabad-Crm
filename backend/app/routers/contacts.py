"""Contact CRUD + sub-resources (checklist, custom fields, significant dates).

Contacts are split: the `contacts` row carries core CRM data + a `contact_type`
(מקורב | פעיל). Mekurav/shliach specifics live in their own tables. Creating a
shliach also provisions a login `User` (role 'shliach') linked by email.

Shliach users see only mekuravim in apartments they cover (scoped reads).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.core.email import send_shliach_welcome
from app.core.geocode import geocode_address
from app.database import get_db
from app.deps import get_current_user, require_staff_or_admin
from app.picklist_utils import validate_picklist_value
from app.schemas import (
    ChecklistOut,
    ChecklistUpdate,
    ContactCreate,
    ContactCustomFieldOut,
    ContactDetailOut,
    ContactOut,
    ContactUpdate,
    CustomFieldValueIn,
    MekuravOut,
    ReminderOut,
    ShliachOut,
    SignificantDateCreate,
    SignificantDateOut,
    SignificantDateUpdate,
)

router = APIRouter(prefix="/api/contacts", tags=["contacts"])
logger = logging.getLogger("app.contacts")


# --- Shliach scoping --------------------------------------------------------
def _shliach_apartment_ids(db: Session, user: models.User) -> list[int]:
    """Apartment ids covered by the shliach contact linked to this user."""
    shliach = (
        db.query(models.ContactShliach)
        .filter(models.ContactShliach.user_id == user.id)
        .first()
    )
    if not shliach:
        return []
    return [
        row.apartment_id
        for row in db.query(models.ContactShliachApartment.apartment_id)
        .filter(models.ContactShliachApartment.contact_shliach_id == shliach.id)
        .all()
    ]


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
    return contact


def _can_shliach_see(db: Session, user: models.User, contact: models.Contact) -> bool:
    if contact.shliach and contact.shliach.user_id == user.id:
        return True  # their own shliach record
    if contact.mekurav and contact.mekurav.apartment_id is not None:
        return contact.mekurav.apartment_id in _shliach_apartment_ids(db, user)
    return False


# --- Validation helpers -----------------------------------------------------
def _validate_fks(data: dict, org_id: int, db: Session) -> None:
    user_id = data.get("assigned_user_id")
    if user_id is not None:
        user = (
            db.query(models.User)
            .filter(models.User.id == user_id, models.User.organization_id == org_id)
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


def _validate_picklists(data: dict, org_id: int, db: Session) -> None:
    for field, field_key in _CONTACT_PICKLISTS.items():
        if field in data and data[field] is not None:
            validate_picklist_value(db, org_id, field_key, data[field])


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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "מספר טלפון זה כבר קיים בארגון")


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


# --- Dynamic picklist values (generic store) -------------------------------
def _picklist_values_map(db: Session, contact: models.Contact) -> dict[str, str]:
    """The contact's selected dynamic-picklist values, keyed by system_name."""
    rows = (
        db.query(models.ContactPicklistValue.value, models.PicklistDefinition.system_name)
        .join(
            models.PicklistDefinition,
            models.PicklistDefinition.id == models.ContactPicklistValue.picklist_id,
        )
        .filter(models.ContactPicklistValue.contact_id == contact.id)
        .all()
    )
    return {system_name: value for value, system_name in rows}


def _apply_picklist_values(
    db: Session, org_id: int, contact: models.Contact, values: dict
) -> None:
    """Upsert (or clear) a contact's dynamic-picklist selections by system_name."""
    for system_name, value in values.items():
        definition = (
            db.query(models.PicklistDefinition)
            .filter(
                models.PicklistDefinition.organization_id == org_id,
                models.PicklistDefinition.system_name == system_name,
            )
            .first()
        )
        if not definition:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"unknown picklist '{system_name}'"
            )
        existing = (
            db.query(models.ContactPicklistValue)
            .filter(
                models.ContactPicklistValue.contact_id == contact.id,
                models.ContactPicklistValue.picklist_id == definition.id,
            )
            .first()
        )
        if not value:
            if existing:
                db.delete(existing)
            continue
        validate_picklist_value(db, org_id, system_name, value)
        if existing:
            existing.value = value
        else:
            db.add(
                models.ContactPicklistValue(
                    organization_id=org_id,
                    contact_id=contact.id,
                    picklist_id=definition.id,
                    value=value,
                )
            )


# --- Detail assembly --------------------------------------------------------
def _build_detail(contact: models.Contact, db: Session) -> ContactDetailOut:
    detail = ContactDetailOut.model_validate(contact)
    if contact.mekurav:
        detail.mekurav = MekuravOut.model_validate(contact.mekurav)
        detail.special_dates = [
            _sd_out(link.special_date_obj) for link in contact.mekurav.special_dates
        ]
    if contact.shliach:
        detail.shliach = ShliachOut(
            id=contact.shliach.id,
            contact_id=contact.shliach.contact_id,
            user_id=contact.shliach.user_id,
            notes=contact.shliach.notes,
            apartment_ids=[a.apartment_id for a in contact.shliach.apartments],
            area_ids=[a.area_id for a in contact.shliach.areas],
        )
    detail.picklist_values = _picklist_values_map(db, contact)
    return detail


def _sd_out(sd: models.SignificantDate) -> SignificantDateOut:
    return SignificantDateOut(
        id=sd.id,
        guid=sd.guid,
        special_date=sd.special_date,
        hebrew_date=sd.hebrew_date,
        special_date_type=sd.special_date_type,
        special_date_title=sd.special_date_title,
        is_set_reminder=sd.is_set_reminder,
        reminders=[ReminderOut.model_validate(r) for r in sd.reminders],
    )


# --- Shliach login provisioning --------------------------------------------
def _provision_shliach_user(
    db: Session, org_id: int, contact: models.Contact
) -> Optional[models.User]:
    """Create (or reuse) a login User with role 'shliach' for this contact."""
    if not contact.email:
        return None
    existing = (
        db.query(models.User).filter(models.User.email == contact.email).first()
    )
    if existing:
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
        password_hash=None,  # Google-login only
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _set_shliach_apartments(
    db: Session, shliach: models.ContactShliach, apartment_ids: list[int], org_id: int
) -> None:
    for ap in shliach.apartments:
        db.delete(ap)
    db.flush()
    for ap_id in dict.fromkeys(apartment_ids):  # de-dupe, keep order
        _validate_apartment(ap_id, org_id, db)
        db.add(
            models.ContactShliachApartment(
                organization_id=org_id,
                contact_shliach_id=shliach.id,
                apartment_id=ap_id,
            )
        )


def _validate_area(area_id: int, org_id: int, db: Session) -> None:
    ok = (
        db.query(models.Area)
        .filter(models.Area.id == area_id, models.Area.organization_id == org_id)
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "area_id does not exist")


def _set_shliach_areas(
    db: Session, shliach: models.ContactShliach, area_ids: list[int], org_id: int
) -> None:
    for a in shliach.areas:
        db.delete(a)
    db.flush()
    for area_id in dict.fromkeys(area_ids):  # de-dupe, keep order
        _validate_area(area_id, org_id, db)
        db.add(
            models.ContactShliachArea(
                organization_id=org_id,
                contact_shliach_id=shliach.id,
                area_id=area_id,
            )
        )


# --- CRUD -------------------------------------------------------------------
@router.get("", response_model=list[ContactOut])
def list_contacts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    pipeline_status: Optional[str] = None,
    contact_type: Optional[str] = None,
    assigned_user_id: Optional[int] = None,
):
    query = db.query(models.Contact).filter(
        models.Contact.organization_id == current_user.organization_id
    )
    if pipeline_status is not None:
        query = query.filter(models.Contact.pipeline_status == pipeline_status)
    if contact_type is not None:
        query = query.filter(models.Contact.contact_type == contact_type)
    if assigned_user_id is not None:
        query = query.filter(models.Contact.assigned_user_id == assigned_user_id)

    if current_user.role == "shliach":
        ap_ids = _shliach_apartment_ids(db, current_user)
        query = query.outerjoin(
            models.ContactMekurav,
            models.ContactMekurav.contact_id == models.Contact.id,
        ).outerjoin(
            models.ContactShliach,
            models.ContactShliach.contact_id == models.Contact.id,
        )
        cond = models.ContactShliach.user_id == current_user.id
        if ap_ids:
            cond = cond | models.ContactMekurav.apartment_id.in_(ap_ids)
        query = query.filter(cond)

    return query.order_by(models.Contact.name).all()


@router.post("", response_model=ContactDetailOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_or_admin),
):
    org_id = current_user.organization_id
    data = payload.model_dump(exclude={"mekurav", "shliach", "picklist_values"})
    _validate_fks(data, org_id, db)
    _validate_picklists(data, org_id, db)
    if data.get("phone"):
        _check_phone_unique(db, org_id, data["phone"])
    _geocode_fallback(data)

    contact = models.Contact(**data, organization_id=org_id)
    db.add(contact)
    db.flush()

    if contact.contact_type == "shliach":
        sh = payload.shliach
        shliach = models.ContactShliach(
            organization_id=org_id,
            contact_id=contact.id,
            notes=sh.notes if sh else None,
        )
        user = _provision_shliach_user(db, org_id, contact)
        if user:
            shliach.user_id = user.id
        db.add(shliach)
        db.flush()
        if sh and sh.apartment_ids:
            _set_shliach_apartments(db, shliach, sh.apartment_ids, org_id)
        if sh and sh.area_ids:
            _set_shliach_areas(db, shliach, sh.area_ids, org_id)
        # Email the new shliach their access link (admin-triggered).
        if contact.email:
            org_name = (
                current_user.organization.name if current_user.organization else ""
            )
            try:
                send_shliach_welcome(
                    to=contact.email,
                    first_name=contact.name,
                    last_name=contact.last_name or "",
                    shliach_email=contact.email,
                    org_name=org_name,
                )
            except Exception:  # pragma: no cover - email must not block creation
                logger.exception("Failed to send shliach welcome email")
    else:
        mk = payload.mekurav
        mk_data = mk.model_dump() if mk else {}
        if mk_data.get("potential_next_step"):
            validate_picklist_value(
                db, org_id, "contact.potential_next_step",
                mk_data["potential_next_step"],
            )
        _validate_apartment(mk_data.get("apartment_id"), org_id, db)
        _validate_admin_area(mk_data.get("admin_area_id"), org_id, db)
        db.add(
            models.ContactMekurav(
                organization_id=org_id, contact_id=contact.id, **mk_data
            )
        )
        contact.checklist = models.CommunityChecklist()

    if payload.picklist_values:
        _apply_picklist_values(db, org_id, contact, payload.picklist_values)

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


@router.put("/{contact_id}", response_model=ContactDetailOut)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    contact = _get_contact_or_404(contact_id, current_user, db)
    data = payload.model_dump(
        exclude_unset=True, exclude={"mekurav", "shliach", "picklist_values"}
    )
    _validate_fks(data, org_id, db)
    _validate_picklists(data, org_id, db)
    if data.get("phone"):
        _check_phone_unique(db, org_id, data["phone"], exclude_id=contact_id)
    _geocode_fallback(data)
    for field, value in data.items():
        setattr(contact, field, value)

    if payload.mekurav is not None and contact.contact_type == "mekurav":
        mk_data = payload.mekurav.model_dump(exclude_unset=True)
        if mk_data.get("potential_next_step"):
            validate_picklist_value(
                db, org_id, "contact.potential_next_step",
                mk_data["potential_next_step"],
            )
        if "apartment_id" in mk_data:
            _validate_apartment(mk_data["apartment_id"], org_id, db)
        if "admin_area_id" in mk_data:
            _validate_admin_area(mk_data["admin_area_id"], org_id, db)
        if contact.mekurav is None:
            contact.mekurav = models.ContactMekurav(
                organization_id=org_id, contact_id=contact.id
            )
        for field, value in mk_data.items():
            setattr(contact.mekurav, field, value)

    if payload.shliach is not None and contact.contact_type == "shliach":
        sh_data = payload.shliach
        if contact.shliach is None:
            contact.shliach = models.ContactShliach(
                organization_id=org_id, contact_id=contact.id
            )
            db.flush()
        if sh_data.notes is not None:
            contact.shliach.notes = sh_data.notes
        if contact.shliach.user_id is None:
            user = _provision_shliach_user(db, org_id, contact)
            if user:
                contact.shliach.user_id = user.id
        _set_shliach_apartments(db, contact.shliach, sh_data.apartment_ids, org_id)
        _set_shliach_areas(db, contact.shliach, sh_data.area_ids, org_id)

    # Keep the shliach's *login user* in sync with the contact. The user's
    # full_name (shown in their own session) is a separate field from the
    # contact name an admin edits — without this, the shliach kept seeing the
    # old name after an admin renamed them.
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

    if payload.picklist_values is not None:
        _apply_picklist_values(db, org_id, contact, payload.picklist_values)

    db.commit()
    db.refresh(contact)
    return _build_detail(contact, db)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = _get_contact_or_404(contact_id, current_user, db)
    db.delete(contact)
    db.commit()


# --- Community checklist sub-resource --------------------------------------
@router.get("/{contact_id}/checklist", response_model=ChecklistOut)
def get_checklist(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = _get_contact_or_404(contact_id, current_user, db)
    if contact.checklist is None:
        contact.checklist = models.CommunityChecklist()
        db.commit()
        db.refresh(contact)
    return contact.checklist


@router.put("/{contact_id}/checklist", response_model=ChecklistOut)
def update_checklist(
    contact_id: int,
    payload: ChecklistUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact = _get_contact_or_404(contact_id, current_user, db)
    if contact.checklist is None:
        contact.checklist = models.CommunityChecklist()
        db.flush()
    data = payload.model_dump(exclude_unset=True)
    if "torah_thought" in data:
        validate_picklist_value(
            db, current_user.organization_id, "checklist.torah_thought",
            data["torah_thought"],
        )
    for field, value in data.items():
        setattr(contact.checklist, field, value)
    db.commit()
    db.refresh(contact.checklist)
    return contact.checklist


# --- Custom checklist fields (per-contact values) --------------------------
@router.get("/{contact_id}/custom-fields", response_model=list[ContactCustomFieldOut])
def get_custom_fields(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    contact = _get_contact_or_404(contact_id, current_user, db)
    defs = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.is_active.is_(True),
        )
        .order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id)
        .all()
    )
    values = {v.definition_id: v for v in contact.custom_values}
    result = []
    for d in defs:
        v = values.get(d.id)
        result.append(
            ContactCustomFieldOut(
                definition_id=d.id,
                field_key=d.field_key,
                hebrew_label=d.hebrew_label,
                checked=v.checked if v else False,
                note=v.note if v else None,
            )
        )
    return result


@router.put("/{contact_id}/custom-fields", response_model=list[ContactCustomFieldOut])
def set_custom_fields(
    contact_id: int,
    payload: list[CustomFieldValueIn],
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    org_id = current_user.organization_id
    contact = _get_contact_or_404(contact_id, current_user, db)
    valid_ids = {
        d.id
        for d in db.query(models.CustomFieldDefinition.id)
        .filter(models.CustomFieldDefinition.organization_id == org_id)
        .all()
    }
    existing = {v.definition_id: v for v in contact.custom_values}
    for item in payload:
        if item.definition_id not in valid_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"definition_id {item.definition_id} does not exist",
            )
        v = existing.get(item.definition_id)
        if v:
            v.checked = item.checked
            v.note = item.note
        else:
            db.add(
                models.CustomFieldValue(
                    contact_id=contact.id,
                    definition_id=item.definition_id,
                    checked=item.checked,
                    note=item.note,
                )
            )
    db.commit()
    return get_custom_fields(contact_id, db, current_user)


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
    return [_sd_out(link.special_date_obj) for link in contact.mekurav.special_dates]


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
        special_date_type=payload.special_date_type,
        special_date_title=payload.special_date_title,
        is_set_reminder=payload.is_set_reminder,
    )
    db.add(sd)
    db.flush()
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
    return _sd_out(sd)


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
        validate_picklist_value(
            db, org_id, "significant_date.type", data["special_date_type"]
        )
    # special_date_title is free text (fixes4) — no picklist validation.
    for field, value in data.items():
        setattr(sd, field, value)
    if reminders is not None:
        _apply_reminders(db, sd, payload.reminders, org_id)
    db.commit()
    db.refresh(sd)
    return _sd_out(sd)


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
    db.delete(sd)
    db.commit()
