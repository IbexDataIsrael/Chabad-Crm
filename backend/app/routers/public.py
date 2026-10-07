"""fixes65: unauthenticated endpoints behind the branded org landing page
(`/org/<slug>`) and the QR task-claim page (`/tasks/claim/<token>`).

- `GET  /api/public/orgs/{slug}`      — landing-page content.
- `POST /api/public/register`         — activist self-registration (email +
  password), from a landing page (`org_slug`) or a claim link (`claim_token`,
  which also auto-claims the task in the same transaction).
- `POST /api/public/register-google`  — the same, from a Google identity.
- `GET  /api/public/claim/{token}`    — what a claim link points at; when a
  valid bearer token is sent, the state is relative to that user ("yours").

Registration grants instant access (no email verification) and notifies the
org's admins by email in a background task — a mail failure never fails it.
"""
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.core import org_prefs
from app.core.email import send_email
from app.core.shliach import apply_shliach_versioned_update
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_google_token,
)
from app.core.task_claim import claim, claim_state_for, task_apartment_count, task_from_token
from app.database import get_db
from app.routers.auth import _is_strong_password
from app.schemas import (
    ClaimInfoOut,
    PublicGoogleRegisterRequest,
    PublicOrgOut,
    PublicRegisterRequest,
    PublicRegisterResponse,
)

router = APIRouter(prefix="/api/public", tags=["public"])

logger = logging.getLogger("app.public")


def _active_org_by_slug(db: Session, slug: str) -> models.Organization:
    org = (
        db.query(models.Organization)
        .filter(
            models.Organization.slug == (slug or "").strip().lower(),
            models.Organization.is_active.is_(True),
        )
        .first()
    )
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page not found")
    return org


def _optional_user(request: Request, db: Session) -> Optional[models.User]:
    """The caller, when a valid bearer token rides along — public endpoints
    must still answer anonymous visitors, so no 401 here."""
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        user_id = int(decode_access_token(auth[7:].strip()).get("sub"))
    except (JWTError, TypeError, ValueError):
        return None
    user = db.get(models.User, user_id)
    if user is None or not user.is_active:
        return None
    return user


@router.get("/orgs/{slug}", response_model=PublicOrgOut)
def get_public_org(slug: str, db: Session = Depends(get_db)):
    org = _active_org_by_slug(db, slug)
    return PublicOrgOut(
        id=org.id,
        slug=org.slug,
        name=org.name,
        subtitle=org.public_subtitle,
        name_en=org.name_en,
        subtitle_en=org.public_subtitle_en,
        logo_url=org.logo_url,
        gallery=list(org.public_gallery or []),
        self_registration_enabled=org.self_registration_enabled,
        public_footer_html=org.public_footer_html,
    )


@router.get("/claim/{token}", response_model=ClaimInfoOut)
def get_claim_info(token: str, request: Request, db: Session = Depends(get_db)):
    task = task_from_token(db, token)
    if task is None:
        return ClaimInfoOut(state="invalid")
    org = db.get(models.Organization, task.organization_id)
    if org is None or not org.is_active:
        return ClaimInfoOut(state="invalid")
    user = _optional_user(request, db)
    if user is not None and user.organization_id != task.organization_id:
        user = None  # another org's session is irrelevant to this task
    return ClaimInfoOut(
        state=claim_state_for(task, user),
        organization_id=org.id,
        organization_name=org.name,
        organization_slug=org.slug,
        organization_logo_url=org.logo_url,
        campaign_name=task.campaign.name if task.campaign else None,
        report_number_names=sorted(rn.report_number.name for rn in task.report_numbers),
        apartment_count=task_apartment_count(db, task.id),
        has_activist=task.volunteer_user_id is not None,
    )


def _resolve_registration_target(
    db: Session, org_slug: Optional[str], claim_token: Optional[str]
) -> tuple[models.Organization, Optional[models.Task], str]:
    """(org, task-to-claim, registration_source). A live claim token decides
    the org and authorizes registration on its own (the org printed that QR
    on purpose); a landing-page registration needs the org's switch ON."""
    if claim_token:
        task = task_from_token(db, claim_token)
        if task is None:
            raise HTTPException(
                status.HTTP_410_GONE, "This task link is no longer valid"
            )
        org = db.get(models.Organization, task.organization_id)
        if org is None or not org.is_active:
            raise HTTPException(status.HTTP_410_GONE, "This task link is no longer valid")
        return org, task, "qr"
    if not org_slug:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organization is required")
    org = _active_org_by_slug(db, org_slug)
    if not org.self_registration_enabled:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Registration is closed for this organization"
        )
    return org, None, "public"


def _create_activist(
    db: Session,
    org: models.Organization,
    *,
    full_name: str,
    email: str,
    phone: Optional[str],
    password: Optional[str],
    google_sub: Optional[str],
    source: str,
) -> models.User:
    """The same trio an admin-created activist gets (routers/contacts.py
    create_contact): a shliach Contact, its first ContactShliach version and
    a role='shliach' login User — active immediately. An existing shliach
    contact with this email but no login (e.g. imported) is adopted rather
    than duplicated."""
    if not org_prefs.effective_flags(db, org.id)["activist_system_enabled"]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Registration is closed for this organization"
        )
    existing_user = (
        db.query(models.User.id)
        .filter(
            models.User.organization_id == org.id,
            func.lower(models.User.email) == email,
        )
        .first()
    )
    if existing_user:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This email is already registered — please sign in instead",
        )

    first, _, last = full_name.partition(" ")
    phone = (phone or "").strip() or None
    username = email[:50]  # users.username is String(50)
    if (
        db.query(models.User.id)
        .filter(models.User.organization_id == org.id, models.User.username == username)
        .first()
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This email is already registered — please sign in instead",
        )

    user = models.User(
        organization_id=org.id,
        username=username,
        full_name=full_name,
        email=email,
        first_name=first,
        last_name=last or None,
        phone=phone,
        password_hash=hash_password(password) if password else None,
        google_sub=google_sub,
        role="shliach",
        is_active=True,
        email_verified=True,  # spec §5: instant access, no verification barrier
        registration_source=source,
    )
    db.add(user)
    db.flush()

    contact = (
        db.query(models.Contact)
        .filter(
            models.Contact.organization_id == org.id,
            models.Contact.contact_type == "shliach",
            func.lower(models.Contact.email) == email,
        )
        .first()
    )
    if contact is not None and contact.shliach is not None and contact.shliach.user_id:
        # A shliach contact already bound to a (different) login — never
        # steal it; the new account gets its own contact instead.
        contact = None
    if contact is None:
        # contacts.phone is org-unique — keep a colliding phone on the user
        # only rather than failing the whole registration over it.
        phone_taken = phone and (
            db.query(models.Contact.id)
            .filter(models.Contact.organization_id == org.id, models.Contact.phone == phone)
            .first()
        )
        contact = models.Contact(
            organization_id=org.id,
            name=first,
            last_name=last or None,
            email=email,
            phone=None if phone_taken else phone,
            contact_type="shliach",
        )
        db.add(contact)
        db.flush()
    if contact.shliach is None:
        db.add(
            models.ContactShliach(
                organization_id=org.id,
                contact_id=contact.id,
                user_id=user.id,
                full_name=full_name,
                email=email,
                phone=phone,
            )
        )
    else:
        # fixes45: linking the login is a versioned identity change.
        apply_shliach_versioned_update(
            db, contact.shliach, {"user_id": user.id, "full_name": full_name}, user
        )
    db.flush()
    return user


def _notify_admins(
    admin_emails: list[str], org_name: str, full_name: str, email: str, source: str
) -> None:
    """Spec §7: email every org admin about the new activist. Runs as a
    background task after the response; each send is isolated so one bad
    address/SMTP hiccup neither blocks the others nor the registration."""
    how = "סריקת קוד QR של משימה" if source == "qr" else "דף ההרשמה הציבורי"
    subject = f"פעיל חדש נרשם — {full_name}"
    body = (
        f"פעיל חדש נרשם לארגון {org_name}.\n\n"
        f"שם: {full_name}\n"
        f"אימייל: {email}\n"
        f"מקור ההרשמה: {how}\n\n"
        "הפעיל מופיע כעת ברשימת המשתמשים של הארגון."
    )
    for to in admin_emails:
        try:
            send_email(to, subject, body, from_name=org_name or None)
        except Exception:  # noqa: BLE001 — notification must never break signup
            logger.exception("Failed to send new-activist notification to %s", to)


def _finish_registration(
    db: Session,
    background: BackgroundTasks,
    org: models.Organization,
    task: Optional[models.Task],
    user: models.User,
    source: str,
) -> PublicRegisterResponse:
    claim_state = None
    if task is not None:
        claim_state = claim(db, task, user)
    db.commit()
    db.refresh(user)
    try:
        admin_emails = [
            e
            for (e,) in db.query(models.User.email).filter(
                models.User.organization_id == org.id,
                models.User.role == "admin",
                models.User.is_active.is_(True),
                models.User.email.isnot(None),
            )
        ]
        if admin_emails:
            background.add_task(
                _notify_admins, admin_emails, org.name, user.full_name, user.email or "", source
            )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to queue new-activist notification for org %s", org.id)
    return PublicRegisterResponse(
        access_token=create_access_token(subject=str(user.id), role=user.role),
        claim_state=claim_state,
    )


@router.post("/register", response_model=PublicRegisterResponse, status_code=201)
def register(
    payload: PublicRegisterRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if not payload.email or "@" not in payload.email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A valid email is required")
    if not _is_strong_password(payload.password):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Password must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.",
        )
    org, task, source = _resolve_registration_target(db, payload.org_slug, payload.claim_token)
    user = _create_activist(
        db,
        org,
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password=payload.password,
        google_sub=None,
        source=source,
    )
    return _finish_registration(db, background, org, task, user, source)


@router.post("/register-google", response_model=PublicRegisterResponse, status_code=201)
def register_google(
    payload: PublicGoogleRegisterRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    try:
        info = verify_google_token(payload.credential)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Google token")
    email = (info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Google account has no email")
    org, task, source = _resolve_registration_target(db, payload.org_slug, payload.claim_token)
    user = _create_activist(
        db,
        org,
        full_name=payload.full_name,
        email=email,
        phone=payload.phone,
        password=None,
        google_sub=info.get("sub"),
        source=source,
    )
    return _finish_registration(db, background, org, task, user, source)
