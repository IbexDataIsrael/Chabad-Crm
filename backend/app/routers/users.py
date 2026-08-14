"""Org user management, scoped to the caller's organization.

Reads (assignee selector / users page): admin or staff — shliach users are
blocked (fixes10 §3.2/§3.6; their contact ownership is forced, so they never
need the directory). Mutations
(fixes7 §1): admins only — an admin can provision additional admins or
restricted (staff) users. A user created without a password is a Google-only
account: the verified Google email is all that's needed to sign in (the
existing /api/auth/google flow links by email). New users get the same
welcome email template as new shliach accounts.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.core.email import send_shliach_welcome
from app.core.security import hash_password
from app.core.shliach import (
    apply_shliach_versioned_update,
    set_shliach_areas,
    set_shliach_report_numbers,
)
from app.database import get_db
from app.deps import require_admin, require_staff_or_admin
from app.schemas import OrgUserCreate, OrgUserUpdate, ShliachOut, UserOut, UserRecreateIn

router = APIRouter(prefix="/api/users", tags=["users"])

logger = logging.getLogger("app.users")


def _get_or_404(user_id: int, org_id: int, db: Session) -> models.User:
    user = (
        db.query(models.User)
        .filter(models.User.id == user_id, models.User.organization_id == org_id)
        .first()
    )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _shliach_out(sh: models.ContactShliach) -> ShliachOut:
    """fixes46: same shape _build_detail (routers/contacts.py) builds — kept
    local since it's UserOut's nested field here, not ContactDetailOut's."""
    return ShliachOut(
        id=sh.id,
        contact_id=sh.contact_id,
        user_id=sh.user_id,
        notes=sh.notes,
        full_name=sh.full_name,
        email=sh.email,
        phone=sh.phone,
        report_number_ids=[r.report_number_id for r in sh.report_numbers],
        area_ids=[a.area_id for a in sh.areas],
    )


def _linked_shliach(db: Session, user_id: int) -> Optional[models.ContactShliach]:
    return (
        db.query(models.ContactShliach)
        .filter(
            models.ContactShliach.user_id == user_id,
            models.ContactShliach.is_display.is_(True),
        )
        .first()
    )


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_or_admin),
):
    users = (
        db.query(models.User)
        .filter(models.User.organization_id == current_user.organization_id)
        .order_by(models.User.full_name)
        .all()
    )
    # fixes46: resolve every shliach link (User.id -> ContactShliach.user_id)
    # in one query instead of the old email-matching the frontend used to do.
    shliach_by_user = {
        sh.user_id: sh
        for sh in db.query(models.ContactShliach).filter(
            models.ContactShliach.organization_id == current_user.organization_id,
            models.ContactShliach.is_display.is_(True),
            models.ContactShliach.user_id.isnot(None),
        )
    }
    out = []
    for u in users:
        item = UserOut.model_validate(u)
        sh = shliach_by_user.get(u.id)
        if sh:
            item.shliach = _shliach_out(sh)
        out.append(item)
    return out


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: OrgUserCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    email = payload.email or ""  # schema-normalized: lowercase, blank → None
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email is required")
    # fixes14: email is unique per organization (the same email may exist in
    # other organizations — one login account per org). Case-insensitive so a
    # legacy mixed-case row still counts as a duplicate.
    dup_email = (
        db.query(models.User)
        .filter(
            models.User.organization_id == admin.organization_id,
            func.lower(models.User.email) == email,
        )
        .first()
    )
    if dup_email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    username = (payload.username or email).strip()
    dup = (
        db.query(models.User)
        .filter(
            models.User.organization_id == admin.organization_id,
            models.User.username == username,
        )
        .first()
    )
    if dup:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username already taken")

    user = models.User(
        organization_id=admin.organization_id,
        username=username,
        full_name=payload.full_name,
        email=email,
        phone=payload.phone,
        # No password => Google-only sign-in (identity = the verified email).
        password_hash=hash_password(payload.password) if payload.password else None,
        role=payload.role,
        is_active=True,
        email_verified=True,  # admin-provisioned accounts are trusted
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Welcome automation: same transactional template as new shliach accounts.
    org_name = admin.organization.name if admin.organization else ""
    first, _, last = payload.full_name.partition(" ")
    try:
        send_shliach_welcome(
            db,
            to=email,
            first_name=first,
            last_name=last,
            shliach_email=email,
            org_name=org_name,
            # fixes17 §1.3: replies go to the admin who created the account.
            reply_to=admin.email,
        )
    except Exception:  # pragma: no cover — email must not block creation
        logger.exception("Failed to send welcome email to %s", email)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: OrgUserUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    user = _get_or_404(user_id, admin.organization_id, db)
    # fixes46: `shliach` (notes/area_ids/report_number_ids) is handled on its
    # own below, alongside the identity fields — together they still collapse
    # into at most one new ContactShliach version per request.
    data = payload.model_dump(exclude_unset=True, exclude={"shliach"})
    sh_data = payload.shliach
    sh_sent = sh_data.model_dump(exclude_unset=True) if sh_data is not None else {}
    # fixes45: editing a shliach's login identity here is editing the same
    # versioned shliach entity the contacts-page edit path feeds — capture
    # which identity fields were actually sent before email/phone get popped
    # off `data` below.
    identity_sent = bool({"full_name", "email", "phone"} & data.keys())
    # Lockout guard: an admin can't demote or deactivate themselves.
    if user.id == admin.id and (
        data.get("role") == "staff" or data.get("is_active") is False
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "You cannot demote or deactivate yourself"
        )
    # fixes14: a shliach's role is managed by its contact link — editing the
    # user (e.g. to set a password) must never silently demote them to staff.
    if user.role == "shliach":
        data.pop("role", None)
    password = data.pop("password", None)
    if password:
        user.password_hash = hash_password(password)

    # fixes14 (user → contact sync): email/phone edits propagate to the linked
    # shliach contact so the two records never drift apart.
    linked = _linked_shliach(db, user.id)
    email = data.pop("email", None)
    if email and email != user.email:
        dup = (
            db.query(models.User)
            .filter(
                models.User.organization_id == admin.organization_id,
                func.lower(models.User.email) == email,
                models.User.id != user.id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")
        # The username follows only when it *was* the email (shliach accounts).
        if user.username == user.email:
            username_taken = (
                db.query(models.User)
                .filter(
                    models.User.organization_id == admin.organization_id,
                    models.User.username == email,
                    models.User.id != user.id,
                )
                .first()
            )
            if not username_taken:
                user.username = email
        user.email = email
        if linked and linked.contact:
            linked.contact.email = email
    if "phone" in data:
        phone = data.pop("phone")
        user.phone = phone
        if linked and linked.contact:
            linked.contact.phone = phone

    for field, value in data.items():
        setattr(user, field, value)

    # fixes45/fixes46: a shliach's login-identity edit — or a notes/area/
    # report-number edit from this page's own columns — produces a new
    # ContactShliach version, exactly like an edit from the contact's own
    # shliach form. One request still yields at most one new version.
    if linked and (identity_sent or sh_sent):
        changes: dict = {}
        if identity_sent:
            changes.update(full_name=user.full_name, email=user.email, phone=user.phone)
        if "notes" in sh_sent:
            changes["notes"] = sh_data.notes
        new = apply_shliach_versioned_update(db, linked, changes, admin)
        if "report_number_ids" in sh_sent:
            set_shliach_report_numbers(db, new, sh_data.report_number_ids, admin.organization_id)
        if "area_ids" in sh_sent:
            set_shliach_areas(db, new, sh_data.area_ids, admin.organization_id)
        db.commit()
        linked = new

    db.commit()
    db.refresh(user)
    out = UserOut.model_validate(user)
    if linked:
        db.refresh(linked)
        out.shliach = _shliach_out(linked)
    return out


@router.post("/recreate", response_model=UserOut)
def recreate_user(
    payload: UserRecreateIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes26 §4: one-click recovery of a shliach's login. Reactivates the
    same-org account with the contact's email, or provisions a fresh
    role='shliach' user, and re-links the ContactShliach record."""
    email = payload.email or ""
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email is required")
    org_id = admin.organization_id
    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.organization_id == org_id,
            models.Contact.contact_type == "shliach",
            func.lower(models.Contact.email) == email,
        )
        .first()
    )
    if not contact:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No shliach contact with this email"
        )

    user = (
        db.query(models.User)
        .filter(
            models.User.organization_id == org_id,
            func.lower(models.User.email) == email,
        )
        .first()
    )
    if user:
        # fixes28 §2: never turn a restricted (staff) or admin account into an
        # activist login — a ContactShliach may only bind to a shliach role.
        if user.role != "shliach":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "כתובת אימייל זו שייכת למשתמש קיים בארגון שאינו פעיל",
            )
        # The account may serve another shliach contact — never steal a login.
        linked_elsewhere = (
            db.query(models.ContactShliach)
            .filter(
                models.ContactShliach.user_id == user.id,
                models.ContactShliach.contact_id != contact.id,
                models.ContactShliach.is_display.is_(True),
            )
            .first()
        )
        if linked_elsewhere:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון",
            )
        user.is_active = True
    else:
        full_name = " ".join(filter(None, [contact.last_name, contact.name]))
        user = models.User(
            organization_id=org_id,
            username=contact.email,
            full_name=full_name or contact.name,
            email=contact.email,
            first_name=contact.name,
            last_name=contact.last_name,
            phone=contact.phone,
            # No password: Google-only until the admin sets one on the contact.
            password_hash=None,
            role="shliach",
            is_active=True,
            email_verified=True,
        )
        db.add(user)
        db.flush()

    # fixes45: re-linking (or first-linking) the login user is a shliach
    # identity change like any other — version it, except when bootstrapping
    # the lineage's very first row (nothing to retire yet).
    if contact.shliach is None:
        contact.shliach = models.ContactShliach(
            organization_id=org_id,
            contact_id=contact.id,
            user_id=user.id,
            full_name=user.full_name,
            email=user.email,
            phone=user.phone,
        )
    else:
        contact.shliach = apply_shliach_versioned_update(
            db,
            contact.shliach,
            {
                "user_id": user.id,
                "full_name": user.full_name,
                "email": user.email,
                "phone": user.phone,
            },
            admin,
        )
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    user = _get_or_404(user_id, admin.organization_id, db)
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete yourself")
    # Unassign their contacts instead of blocking the delete (guid FK, fixes10).
    db.query(models.Contact).filter(
        models.Contact.assigned_user_id == user.guid
    ).update({models.Contact.assigned_user_id: None}, synchronize_session=False)
    # fixes45: deliberately unfiltered by is_display — every historical
    # version carries this user_id forward too, and all of them must be
    # nulled or the FK blocks the delete below.
    db.query(models.ContactShliach).filter(
        models.ContactShliach.user_id == user.id
    ).update({models.ContactShliach.user_id: None}, synchronize_session=False)
    # fixes26 §4: saved UI preferences (fixes17) are a NOT-NULL FK — any user
    # who ever logged in couldn't be deleted (FK violation → 500).
    db.query(models.UserPreference).filter(
        models.UserPreference.user_id == user.id
    ).delete(synchronize_session=False)
    # fixes25: interactions live inside visit JSON (the author survives as a
    # plain-text name) — no user-owned interaction rows to re-home anymore.
    db.delete(user)
    db.commit()
