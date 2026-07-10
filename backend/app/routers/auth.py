"""Authentication: signup (SaaS), email verification, login, register (legacy), profile.

- `signup`        — creates an organization + a **pending admin** (inactive until the
                    emailed verification link is used).
- `verify-email`  — activates the admin and provisions the org's picklists.
- `register`      — legacy/dev path: creates an immediately-active user in a new org.
                    Retired in Phase 9.
"""
import datetime
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.core.email import (
    send_org_pending_admin,
    send_org_pending_user,
    send_verification_email,
)
from app.core.security import (
    create_access_token,
    create_email_token,
    decode_email_token,
    hash_password,
    verify_google_token,
    verify_password,
)
from app.database import get_db
from app.deps import get_current_user
from app.schemas import (
    ChangePasswordRequest,
    GoogleLoginRequest,
    GoogleSignupRequest,
    LoginResponse,
    OrgOption,
    ResendRequest,
    SignupRequest,
    UserCreate,
    UserOut,
)
from app.seed import provision_org

router = APIRouter(prefix="/api/auth", tags=["auth"])

logger = logging.getLogger("app.auth")


def _assert_org_active(org) -> None:
    """Block login for a disabled or not-yet-approved organization."""
    if org.is_active:
        return
    if getattr(org, "approval_status", "approved") == "pending":
        detail = "הארגון ממתין לאישור מנהל המערכת. נעדכן אותך במייל."
    else:
        detail = "This organization has been disabled. Contact support."
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _log_access(db: Session, username: str, outcome: str) -> None:
    """fixes14 §feature 3: audit every login attempt, success or failure.

    Committed immediately so the row survives the HTTPException raised right
    after a failed attempt (the request session is discarded without commit)."""
    now = datetime.datetime.utcnow()
    db.add(
        models.SystemAccessLog(
            date=now.date(), time=now.time(), username=username, status=outcome
        )
    )
    db.commit()


def _loginable(user: models.User) -> bool:
    """All the non-credential gates a user must pass to receive a token."""
    return (
        user.email_verified
        and user.is_active
        and user.organization is not None
        and user.organization.is_active
    )


def _org_selection_response(db: Session, identifier: str, users) -> LoginResponse:
    """fixes14 §feature 1: the verified identity maps to several organizations —
    withhold the token and let the user pick one explicitly."""
    _log_access(db, identifier, "ORG_SELECTION_REQUIRED")
    return LoginResponse(
        requires_org_selection=True,
        organizations=[
            OrgOption(
                id=u.organization.id,
                name=u.organization.name,
                logo_url=u.organization.logo_url,
            )
            for u in users
        ],
    )


def _send_verification_safely(user, token: str) -> None:
    """Email the verification link; never let a mail failure break signup.

    The org + pending admin are already committed, so a raised SMTP/template
    error here would 500 the signup while leaving an unusable account behind.
    Instead we log the exception AND the link, so the admin can still be
    activated and we can see *why* delivery failed in the Render logs.
    """
    try:
        link = send_verification_email(user, token)
        logger.info("Verification email dispatched to %s (link: %s)", user.email, link)
    except Exception:  # noqa: BLE001 — mail must never break the signup flow
        logger.exception("Failed to send verification email to %s", user.email)


def _create_pending_org(db: Session, org: models.Organization, user: models.User) -> None:
    """Persist a new org+admin as pending, then fire the two signup emails
    (both guarded — a mail failure must not fail the signup)."""
    db.add(org)
    db.flush()
    user.organization_id = org.id
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(org)
    try:
        send_org_pending_user(db, user.email, user.full_name, org.name)
    except Exception:
        logger.exception("Failed to send pending-user email to %s", user.email)
    try:
        send_org_pending_admin(org.name, user.full_name, user.email or "")
    except Exception:
        logger.exception("Failed to send pending-admin notification for org %s", org.name)


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> dict:
    """Register an organization for approval.

    Creates a PENDING org + its admin (email+password). The org is inactive and
    the owner can't log in until a superadmin approves it. Emails the user a
    "received, under review" note and the platform admin a notification.

    fixes14: the email may already exist in *other* organizations — email is
    unique per org, and login offers an org selection for multi-org identities.
    """
    org = models.Organization(
        name=payload.organization_name,
        logo_url=payload.organization_logo_url,
        is_active=False,
        approval_status="pending",
    )
    full_name = f"{payload.first_name} {payload.last_name}".strip()
    user = models.User(
        username=payload.username,
        full_name=full_name,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role="admin",
        is_active=True,      # gate is the org's approval, not the user flag
        email_verified=True,
    )
    _create_pending_org(db, org, user)
    return {"status": "pending_approval", "email": user.email}


@router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)) -> dict:
    """Activate the account behind a verification token and provision its org."""
    try:
        user_id = decode_email_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification token",
        )
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification token"
        )
    if not user.email_verified:
        user.email_verified = True
        user.is_active = True
        db.commit()
        provision_org(db, user.organization_id)
    return {"status": "verified", "organization_id": user.organization_id}


@router.post("/resend-verification")
def resend_verification(payload: ResendRequest, db: Session = Depends(get_db)) -> dict:
    """Re-issue a verification link. Always 200 (no email enumeration).
    fixes14: an email may exist in several orgs — cover every unverified one."""
    users = (
        db.query(models.User)
        .filter(func.lower(models.User.email) == (payload.email or ""))
        .all()
    )
    for user in users:
        if not user.email_verified:
            _send_verification_safely(user, create_email_token(user.id))
    return {"status": "ok"}


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> models.User:
    # Registration creates a brand-new org, so an email existing in *other*
    # orgs is allowed (fixes14: email is unique per organization).
    org = models.Organization(
        name=payload.organization_name or payload.full_name or payload.username
    )
    db.add(org)
    db.flush()

    user = models.User(
        organization_id=org.id,
        username=payload.username,
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
        email_verified=True,  # legacy path is immediately usable
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/token", response_model=LoginResponse)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    organization_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
) -> LoginResponse:
    """Password login. The identifier matches username *or* email; when the
    verified credentials map to users in several organizations (fixes14), the
    response asks for an explicit org selection instead of issuing a token —
    the client retries with `organization_id`."""
    identifier = form_data.username
    # Email matching is case-insensitive: new rows are stored lowercased, but
    # legacy rows (and typed identifiers) may carry uppercase letters.
    candidates = (
        db.query(models.User)
        .filter(
            (models.User.username == identifier)
            | (func.lower(models.User.email) == identifier.strip().lower())
        )
        .all()
    )
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not candidates:
        _log_access(db, identifier, "FAILED_NO_USER")
        raise credentials_error

    # Credentials first: org names are never revealed for a wrong password.
    verified = [
        u
        for u in candidates
        if u.password_hash and verify_password(form_data.password, u.password_hash)
    ]
    if not verified:
        _log_access(db, identifier, "FAILED_INVALID_PASSWORD")
        raise credentials_error
    if organization_id is not None:
        verified = [u for u in verified if u.organization_id == organization_id]
        if not verified:
            _log_access(db, identifier, "FAILED_NO_USER")
            raise credentials_error

    eligible = [u for u in verified if _loginable(u)]
    if not eligible:
        blocked = verified[0]
        if not blocked.email_verified or not blocked.is_active:
            _log_access(db, identifier, "FAILED_NOT_VERIFIED")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please verify your email before logging in",
            )
        _log_access(db, identifier, "FAILED_ORG_DISABLED")
        _assert_org_active(blocked.organization)  # raises with the org detail
        raise credentials_error  # unreachable safety net

    # One user per org (username/email are org-unique); dedupe defensively.
    by_org = {}
    for u in eligible:
        by_org.setdefault(u.organization_id, u)
    if organization_id is None and len(by_org) > 1:
        return _org_selection_response(db, identifier, list(by_org.values()))

    user = next(iter(by_org.values()))
    _log_access(db, identifier, "SUCCESS")
    token = create_access_token(subject=str(user.id), role=user.role)
    return LoginResponse(access_token=token)


@router.post("/google", response_model=LoginResponse)
def google_login(
    payload: GoogleLoginRequest, db: Session = Depends(get_db)
) -> LoginResponse:
    """Google Identity Services login. Links to existing users by email; when
    the email exists in several organizations (fixes14) the response asks for
    an explicit org selection — the client retries with `organization_id`."""
    try:
        info = verify_google_token(payload.credential)
    except ValueError:
        _log_access(db, "(google)", "FAILED_INVALID_PASSWORD")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token",
        )
    email = info["email"].strip().lower()
    no_user_error = HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="לא נמצא משתמש עם כתובת אימייל זו. יש להירשם או לקבל הזמנה תחילה.",
    )
    # Case-insensitive: a mixed-case stored email must not 403 the login
    # (Google ID tokens always carry the address lowercased).
    users = (
        db.query(models.User).filter(func.lower(models.User.email) == email).all()
    )
    if not users:
        _log_access(db, email, "FAILED_NO_USER")
        raise no_user_error
    if payload.organization_id is not None:
        users = [u for u in users if u.organization_id == payload.organization_id]
        if not users:
            _log_access(db, email, "FAILED_NO_USER")
            raise no_user_error

    # Google verified the email itself, so only the org gate applies here
    # (the first sign-in below flips email_verified/is_active on).
    active = [u for u in users if u.organization and u.organization.is_active]
    if not active:
        _log_access(db, email, "FAILED_ORG_DISABLED")
        _assert_org_active(users[0].organization)  # raises with the org detail
        raise no_user_error  # unreachable safety net

    if payload.organization_id is None and len(active) > 1:
        return _org_selection_response(db, email, active)

    user = active[0]
    # First Google sign-in: bind the Google subject and activate the account.
    if not user.google_sub:
        user.google_sub = info.get("sub")
    if not user.email_verified:
        user.email_verified = True
    user.is_active = True
    db.commit()
    _log_access(db, email, "SUCCESS")
    return LoginResponse(
        access_token=create_access_token(subject=str(user.id), role=user.role)
    )


@router.post("/google-signup", status_code=status.HTTP_201_CREATED)
def google_signup(payload: GoogleSignupRequest, db: Session = Depends(get_db)) -> dict:
    """Register an organization for approval from a Google identity.

    Google verifies the email, but the org still needs superadmin approval before
    it goes live — same pending flow as the password signup (no immediate login).
    """
    try:
        info = verify_google_token(payload.credential)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token"
        )
    email = info["email"]
    # fixes14: the email may already exist in *other* organizations — this
    # signup creates a brand-new org, so there is no per-org conflict.
    org = models.Organization(
        name=payload.organization_name,
        logo_url=payload.organization_logo_url,
        is_active=False,
        approval_status="pending",
    )
    full_name = (info.get("name") or email.split("@")[0]).strip()
    user = models.User(
        username=email.split("@")[0],  # unique within the brand-new org
        full_name=full_name,
        email=email,
        first_name=info.get("given_name"),
        last_name=info.get("family_name"),
        google_sub=info.get("sub"),
        password_hash=None,  # Google-only account
        role="admin",
        is_active=True,      # gate is the org's approval, not the user flag
        email_verified=True,
    )
    _create_pending_org(db, org, user)
    return {"status": "pending_approval", "email": user.email}


def _resolve_display_name(db: Session, user: models.User) -> Optional[str]:
    """fixes14 §feature 2: the user's full name as recorded on the contacts
    table — the linked shliach contact first, else a same-org contact carrying
    the user's email. None when the user has no contact record (e.g. staff)."""
    link = (
        db.query(models.ContactShliach)
        .filter(models.ContactShliach.user_id == user.id)
        .first()
    )
    contact = link.contact if link else None
    if contact is None and user.email:
        contact = (
            db.query(models.Contact)
            .filter(
                models.Contact.organization_id == user.organization_id,
                models.Contact.email == user.email,
            )
            .first()
        )
    if contact is None:
        return None
    return " ".join(filter(None, [contact.name, contact.last_name])) or None


@router.get("/me", response_model=UserOut)
def me(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> UserOut:
    out = UserOut.model_validate(current_user)
    out.display_name = _resolve_display_name(db, current_user)
    return out


def _is_strong_password(pw: str) -> bool:
    """Mirror the frontend rule: >=8 chars with an upper, a lower, and a digit."""
    import re

    return (
        len(pw) >= 8
        and bool(re.search(r"[A-Z]", pw))
        and bool(re.search(r"[a-z]", pw))
        and bool(re.search(r"\d", pw))
    )


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict:
    """Let a logged-in user change their own password."""
    if not current_user.password_hash or not verify_password(
        payload.current_password, current_user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    if not _is_strong_password(payload.new_password):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.",
        )
    current_user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"status": "ok"}
