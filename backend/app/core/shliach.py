"""Resolve the shliach ContactShliach record for a logged-in shliach user, and
the fixes45 versioning helpers shared by every place that edits one.

A shliach contact is normally bound to its login user via
`ContactShliach.user_id` (set when the login is provisioned). But that link can
be missing: imported shliach contacts get no login user (the data import
provisions none), and a login created separately afterwards is never wired to
the contact. When the link is absent, resolving the shliach by `user_id` alone
returns nothing, so the shliach sees **zero** apartments/areas even when a
report number (or area) is assigned to their contact — fixes21 §1.

Fall back to matching the shliach contact by the login user's email within the
same organization, which covers those unlinked cases.
"""
import datetime

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models


def resolve_shliach(
    db: Session, user: models.User
) -> Optional[models.ContactShliach]:
    """The active shliach contact version for `user`: by the user_id link,
    else by email."""
    shliach = (
        db.query(models.ContactShliach)
        .filter(
            models.ContactShliach.user_id == user.id,
            models.ContactShliach.organization_id == user.organization_id,
            models.ContactShliach.is_display.is_(True),
        )
        .first()
    )
    if shliach:
        return shliach
    if user.email:
        shliach = (
            db.query(models.ContactShliach)
            .join(
                models.Contact,
                models.Contact.id == models.ContactShliach.contact_id,
            )
            .filter(
                models.ContactShliach.organization_id == user.organization_id,
                models.ContactShliach.is_display.is_(True),
                func.lower(models.Contact.email) == user.email.strip().lower(),
            )
            .first()
        )
    return shliach


def activist_names_by_contact(db: Session, contact_ids) -> dict[int, str]:
    """fixes75 §1: {contact_id: users.full_name} for shliach contacts bound
    to a login. The users table is the source of truth for an activist's
    name; the contact's name columns are only a fallback for a contact with
    no login at all."""
    ids = {cid for cid in contact_ids if cid is not None}
    if not ids:
        return {}
    rows = (
        db.query(models.ContactShliach.contact_id, models.User.full_name)
        .join(models.User, models.User.id == models.ContactShliach.user_id)
        .filter(
            models.ContactShliach.contact_id.in_(ids),
            models.ContactShliach.is_display.is_(True),
        )
        .all()
    )
    return {cid: name for cid, name in rows if name}


# fixes45: the real columns copied from a retired version into its successor
# — same idea as apartments._VERSIONED_COLUMNS. contact_id/user_id identify
# the lineage/login and are never part of `changes`, but do need copying
# forward like any other column.
SHLIACH_VERSIONED_COLUMNS = (
    "contact_id",
    "user_id",
    "notes",
    "full_name",
    "email",
    "phone",
)


def copy_shliach_children(db: Session, from_id: int, to_id: int) -> None:
    """Copy every coverage link (areas + report numbers) from one
    ContactShliach row onto another. Same "copy, don't move" contract as
    picklist_utils.copy_links: the retired row keeps its own historical
    links, the new row starts with the same ones."""
    for link in (
        db.query(models.ContactShliachArea)
        .filter(models.ContactShliachArea.contact_shliach_id == from_id)
        .all()
    ):
        db.add(
            models.ContactShliachArea(
                organization_id=link.organization_id,
                contact_shliach_id=to_id,
                area_id=link.area_id,
            )
        )
    for link in (
        db.query(models.ReportNumberContactShliach)
        .filter(models.ReportNumberContactShliach.contact_shliach_id == from_id)
        .all()
    ):
        db.add(
            models.ReportNumberContactShliach(
                organization_id=link.organization_id,
                contact_shliach_id=to_id,
                report_number_id=link.report_number_id,
            )
        )


def apply_shliach_versioned_update(
    db: Session,
    active: models.ContactShliach,
    changes: dict,
    editor: models.User,
) -> models.ContactShliach:
    """Core of the fixes45 versioning (mirrors apartments'
    _apply_versioned_update): retire the active row (is_display=False +
    last_edit/editor_id stamp) and insert a new active row carrying
    `changes` on top of the copied-forward columns. Coverage links (areas /
    report numbers) are copied onto the new row first, so a caller that only
    changes e.g. `notes` doesn't have to also pass them through. Commits and
    returns the new row."""
    org_id = active.organization_id
    active.is_display = False
    active.last_edit = datetime.datetime.utcnow()
    active.editor_id = editor.id

    values = {col: getattr(active, col) for col in SHLIACH_VERSIONED_COLUMNS}
    values.update(changes)
    new = models.ContactShliach(
        **values,
        organization_id=org_id,
        is_display=True,
        root_id=active.root_id or active.id,
    )
    db.add(new)
    db.flush()
    copy_shliach_children(db, active.id, new.id)
    db.commit()
    db.refresh(new)
    return new


# fixes46: shared by both edit surfaces (the contact's own shliach form and
# the Users page) — moved out of routers/contacts.py so routers/users.py can
# reuse them without a router-to-router import.
def validate_area(area_id: int, org_id: int, db: Session) -> None:
    ok = (
        db.query(models.Area)
        .filter(models.Area.id == area_id, models.Area.organization_id == org_id)
        .first()
    )
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "area_id does not exist")


def set_shliach_areas(
    db: Session, shliach: models.ContactShliach, area_ids: list[int], org_id: int
) -> None:
    for a in shliach.areas:
        db.delete(a)
    db.flush()
    for area_id in dict.fromkeys(area_ids):  # de-dupe, keep order
        validate_area(area_id, org_id, db)
        db.add(
            models.ContactShliachArea(
                organization_id=org_id,
                contact_shliach_id=shliach.id,
                area_id=area_id,
            )
        )


def validate_report_number(report_number_id: int, org_id: int, db: Session) -> None:
    ok = (
        db.query(models.ReportNumber)
        .filter(
            models.ReportNumber.id == report_number_id,
            models.ReportNumber.organization_id == org_id,
        )
        .first()
    )
    if not ok:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "report_number_id does not exist"
        )


def set_shliach_report_numbers(
    db: Session,
    shliach: models.ContactShliach,
    report_number_ids: list[int],
    org_id: int,
) -> None:
    """fixes19: replace-all semantics, like the shliach area links."""
    for link in shliach.report_numbers:
        db.delete(link)
    db.flush()
    for rn_id in dict.fromkeys(report_number_ids):  # de-dupe, keep order
        validate_report_number(rn_id, org_id, db)
        db.add(
            models.ReportNumberContactShliach(
                organization_id=org_id,
                contact_shliach_id=shliach.id,
                report_number_id=rn_id,
            )
        )
