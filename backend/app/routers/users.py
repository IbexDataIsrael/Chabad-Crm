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
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.core.email import send_shliach_welcome
from app.core.security import hash_password
from app.core.user_delete import clear_user_references
from app.core.shliach import (
    apply_shliach_versioned_update,
    resolve_shliach,
    set_shliach_areas,
    set_shliach_report_numbers,
)
from app.database import get_db
from app.deps import (
    get_current_user,
    require_admin,
    require_staff_admin_or_campaign_manager,
)
from app.schemas import (
    OrgUserCreate,
    OrgUserUpdate,
    ShliachOut,
    ShliachRestoreField,
    UserOut,
    UserRecreateIn,
)

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


def _linked_shliach(db: Session, user: models.User) -> Optional[models.ContactShliach]:
    """fixes54 §6.2: delegates to core.shliach.resolve_shliach's user_id-then-
    email fallback. A raw user_id-only lookup left activists with an unlinked
    ContactShliach.user_id (imported contacts, or a login (re)created
    separately — fixes21's exact scenario) with `UserOut.shliach == null`,
    which silently disabled self-edit everywhere `isOwnShliachProfile` is
    derived from it, regardless of the /shliach-config field-lock settings."""
    return resolve_shliach(db, user)


def _user_out(db: Session, user: models.User) -> UserOut:
    """fixes47: single-user version of list_users' bulk enrichment below —
    used by GET /api/users/{id} and the PUT response."""
    item = UserOut.model_validate(user)
    sh = _linked_shliach(db, user)
    if sh:
        item.shliach = _shliach_out(sh)
    return item


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_admin_or_campaign_manager),
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


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_staff_admin_or_campaign_manager),
):
    """fixes47: backs the dedicated dashboard/users/{id} detail page — same
    single-record-fetch role list_contacts's GET /{id} plays for Contacts."""
    user = _get_or_404(user_id, current_user.organization_id, db)
    return _user_out(db, user)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: OrgUserCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    email = payload.email or None  # schema-normalized: lowercase, blank → None
    # fixes61 §2: a manual user (an activist tracked in the system with no
    # login of their own) doesn't need an email — everyone else still does.
    if not email and not payload.is_manual:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email is required")
    # fixes14: email is unique per organization (the same email may exist in
    # other organizations — one login account per org). Case-insensitive so a
    # legacy mixed-case row still counts as a duplicate. Skipped entirely for
    # a manual user with no email — multiple NULLs don't collide.
    if email:
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

    username = (payload.username or email or "").strip()
    if not username:
        # No email to default to (manual user, no explicit username) — derive
        # one from the name, disambiguating against an org collision.
        base = "_".join(payload.full_name.strip().split()) or "user"
        username = base
        suffix = 2
        while (
            db.query(models.User)
            .filter(
                models.User.organization_id == admin.organization_id,
                models.User.username == username,
            )
            .first()
        ):
            username = f"{base}_{suffix}"
            suffix += 1
    else:
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
        is_manual=payload.is_manual,
        email_verified=True,  # admin-provisioned accounts are trusted
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Welcome automation: same transactional template as new shliach accounts.
    # Skipped for a manual user — there's no email (and no login) to welcome.
    if email:
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
    # fixes58 §3.7/plan decision #6: `admin` here means "the caller" — a
    # campaign_manager may also reach this endpoint, but only for a
    # shliach-role target row (checked just below). Kept named `admin` to
    # avoid renaming its ~15 other uses through the rest of this function.
    admin: models.User = Depends(get_current_user),
):
    user = _get_or_404(user_id, admin.organization_id, db)
    if admin.role == "campaign_manager":
        if user.role != "shliach":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    elif admin.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
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
    linked = _linked_shliach(db, user)
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
        # fixes69 §Admin1: the old address is dead the moment the login
        # identity moves — without a fresh access link the user has no way
        # back in. Same template/best-effort-only contract as a new user's
        # welcome email in create_org_user above.
        org_name = admin.organization.name if admin.organization else ""
        first, _, last = user.full_name.partition(" ")
        try:
            send_shliach_welcome(
                db,
                to=email,
                first_name=first,
                last_name=last,
                shliach_email=email,
                org_name=org_name,
                reply_to=admin.email,
            )
        except Exception:  # pragma: no cover — email must not block the edit
            logger.exception("Failed to send welcome email to %s", email)
    if "phone" in data:
        phone = data.pop("phone")
        user.phone = phone
        if linked and linked.contact:
            linked.contact.phone = phone
    if "full_name" in data:
        full_name = data.pop("full_name")
        user.full_name = full_name
        # Keep the split copy in step too — otherwise a self-registered
        # activist's Google name lingers in welcome-mail {{first_name}} and
        # the global search after an admin renames them.
        user.first_name, _, last = full_name.partition(" ")
        user.last_name = last or None
        # GET /api/auth/me's display_name (dashboard header, activist landing
        # greeting) is resolved from Contact.name/last_name, not from this
        # User row (see auth._resolve_display_name) — without this, renaming
        # an activist here updated the login record but the name shown
        # everywhere else never moved.
        if linked and linked.contact:
            first, _, last = full_name.partition(" ")
            linked.contact.name = first
            linked.contact.last_name = last or None

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


# fixes48 §4: fields an admin may roll back on a shliach's linked contact —
# mirrors apartments._RESTORABLE_FIELDS. "areas"/"report_numbers" are the
# coverage link tables (not plain columns), handled specially below, same as
# apartments' picklist fields.
_SHLIACH_RESTORABLE_FIELDS = (
    "full_name", "email", "phone", "notes", "areas", "report_numbers",
)


@router.post("/{user_id}/shliach/restore-field", response_model=UserOut)
def restore_shliach_field(
    user_id: int,
    payload: ShliachRestoreField,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes48 §4: roll one field of the linked shliach back to the value it
    held in a previous version — same "new active version carrying just the
    restored field" contract as apartments.restore_apartment_field. Admin
    only; mirrors the history dashboard/users/{id} now shows."""
    user = _get_or_404(user_id, admin.organization_id, db)
    linked = _linked_shliach(db, user)
    if not linked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No linked shliach contact")
    if payload.field not in _SHLIACH_RESTORABLE_FIELDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"field '{payload.field}' cannot be restored"
        )
    root_id = linked.root_id or linked.id
    version = (
        db.query(models.ContactShliach)
        .filter(
            models.ContactShliach.id == payload.version_id,
            models.ContactShliach.organization_id == admin.organization_id,
            or_(
                models.ContactShliach.root_id == root_id,
                models.ContactShliach.id == root_id,
            ),
        )
        .first()
    )
    if not version:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "version not found in this shliach's history"
        )

    changes: dict = {}
    if payload.field in ("full_name", "email", "phone", "notes"):
        changes[payload.field] = getattr(version, payload.field)
    new = apply_shliach_versioned_update(db, linked, changes, admin)
    if payload.field == "areas":
        set_shliach_areas(
            db, new, [a.area_id for a in version.areas], admin.organization_id
        )
    elif payload.field == "report_numbers":
        set_shliach_report_numbers(
            db, new, [r.report_number_id for r in version.report_numbers], admin.organization_id
        )
    db.commit()
    db.refresh(user)
    db.refresh(new)
    out = UserOut.model_validate(user)
    out.shliach = _shliach_out(new)
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
    # fixes58 §3.7/plan decision #6: see update_user's comment above.
    admin: models.User = Depends(get_current_user),
):
    user = _get_or_404(user_id, admin.organization_id, db)
    if admin.role == "campaign_manager":
        if user.role != "shliach":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    elif admin.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete yourself")
    # fixes75 §11: tasks back to the pool, own report-number/area bindings
    # cleared, history rows kept with the reference nulled — every user can
    # be deleted (a user with tasks used to fail on the tasks FK).
    clear_user_references(db, user, admin)
    db.delete(user)
    db.commit()
