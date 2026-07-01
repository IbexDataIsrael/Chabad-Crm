"""Authentication: signup (SaaS), email verification, login, register (legacy), profile.

- `signup`        — creates an organization + a **pending admin** (inactive until the
                    emailed verification link is used).
- `verify-email`  — activates the admin and provisions the org's picklists.
- `register`      — legacy/dev path: creates an immediately-active user in a new org.
                    Retired in Phase 9.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError
from sqlalchemy.orm import Session

from app import models
from app.core.email import send_verification_email
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
    GoogleLoginRequest,
    GoogleSignupRequest,
    ResendRequest,
    SignupRequest,
    Token,
    UserCreate,
    UserOut,
)
from app.seed import provision_org

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> dict:
    """Create an organization + pending admin, then email a verification link."""
    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    org = models.Organization(
        name=payload.organization_name, logo_url=payload.organization_logo_url
    )
    db.add(org)
    db.flush()

    full_name = f"{payload.first_name} {payload.last_name}".strip()
    user = models.User(
        organization_id=org.id,
        username=payload.username,
        full_name=full_name,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role="admin",
        is_active=False,
        email_verified=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    send_verification_email(user, create_email_token(user.id))
    return {"status": "pending_verification", "email": user.email}


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
    """Re-issue a verification link. Always 200 (no email enumeration)."""
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if user and not user.email_verified:
        send_verification_email(user, create_email_token(user.id))
    return {"status": "ok"}


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> models.User:
    if payload.email:
        if db.query(models.User).filter(models.User.email == payload.email).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )

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


@router.post("/token", response_model=Token)
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    user = (
        db.query(models.User)
        .filter(models.User.username == form_data.username)
        .first()
    )
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.email_verified or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in",
        )
    token = create_access_token(subject=str(user.id), role=user.role)
    return Token(access_token=token)


@router.post("/google", response_model=Token)
def google_login(payload: GoogleLoginRequest, db: Session = Depends(get_db)) -> Token:
    """Google Identity Services login. Links to an existing user by email."""
    try:
        info = verify_google_token(payload.credential)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token",
        )
    email = info["email"]
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="לא נמצא משתמש עם כתובת אימייל זו. יש להירשם או לקבל הזמנה תחילה.",
        )
    # First Google sign-in: bind the Google subject and activate the account.
    if not user.google_sub:
        user.google_sub = info.get("sub")
    if not user.email_verified:
        user.email_verified = True
    user.is_active = True
    db.commit()
    return Token(access_token=create_access_token(subject=str(user.id), role=user.role))


@router.post("/google-signup", response_model=Token, status_code=status.HTTP_201_CREATED)
def google_signup(payload: GoogleSignupRequest, db: Session = Depends(get_db)) -> Token:
    """Create an organization + admin from a Google identity, then log in.

    Unlike the password signup, no email-verification round-trip is needed: Google has
    already verified the email, so the account is active immediately.
    """
    try:
        info = verify_google_token(payload.credential)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token"
        )
    email = info["email"]
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )

    org = models.Organization(
        name=payload.organization_name, logo_url=payload.organization_logo_url
    )
    db.add(org)
    db.flush()

    full_name = (info.get("name") or email.split("@")[0]).strip()
    user = models.User(
        organization_id=org.id,
        username=email.split("@")[0],  # unique within the brand-new org
        full_name=full_name,
        email=email,
        first_name=info.get("given_name"),
        last_name=info.get("family_name"),
        google_sub=info.get("sub"),
        password_hash=None,  # Google-only account
        role="admin",
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    provision_org(db, org.id)
    return Token(access_token=create_access_token(subject=str(user.id), role=user.role))


@router.get("/me", response_model=UserOut)
def me(current_user: models.User = Depends(get_current_user)) -> models.User:
    return current_user
