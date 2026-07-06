"""Org user management, scoped to the caller's organization.

Reads (assignee selector / users page): any authenticated user. Mutations
(fixes7 §1): admins only — an admin can provision additional admins or
restricted (staff) users. A user created without a password is a Google-only
account: the verified Google email is all that's needed to sign in (the
existing /api/auth/google flow links by email). New users get the same
welcome email template as new shliach accounts.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.core.email import send_shliach_welcome
from app.core.security import hash_password
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import OrgUserCreate, OrgUserUpdate, UserOut

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


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.User)
        .filter(models.User.organization_id == current_user.organization_id)
        .order_by(models.User.full_name)
        .all()
    )


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: OrgUserCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    email = payload.email.strip().lower()
    if not email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email is required")
    if db.query(models.User).filter(models.User.email == email).first():
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
            to=email,
            first_name=first,
            last_name=last,
            shliach_email=email,
            org_name=org_name,
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
    data = payload.model_dump(exclude_unset=True)
    # Lockout guard: an admin can't demote or deactivate themselves.
    if user.id == admin.id and (
        data.get("role") == "staff" or data.get("is_active") is False
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "You cannot demote or deactivate yourself"
        )
    password = data.pop("password", None)
    if password:
        user.password_hash = hash_password(password)
    for field, value in data.items():
        setattr(user, field, value)
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
    # Unassign their contacts instead of blocking the delete.
    db.query(models.Contact).filter(
        models.Contact.assigned_user_id == user.id
    ).update({models.Contact.assigned_user_id: None}, synchronize_session=False)
    db.query(models.ContactShliach).filter(
        models.ContactShliach.user_id == user.id
    ).update({models.ContactShliach.user_id: None}, synchronize_session=False)
    db.delete(user)
    db.commit()
