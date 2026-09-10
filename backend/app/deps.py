"""Reusable FastAPI dependencies for authentication and role enforcement."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app import models
from app.core.security import decode_access_token
from app.database import get_db

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        if subject is None:
            raise credentials_exception
        user_id = int(subject)
    except (JWTError, ValueError):
        raise credentials_exception

    user = db.get(models.User, user_id)
    if user is None:
        raise credentials_exception
    # Security hardening: a token stays cryptographically valid for its full
    # lifetime even after an admin disables the user or their org — without
    # this, a disabled account (or a whole disabled org) keeps API access
    # until the token happens to expire (previously up to 30 days).
    if not user.is_active or user.organization is None or not user.organization.is_active:
        raise credentials_exception
    return user


def require_admin(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """Allow only admins through; raise 403 for staff."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


def require_superadmin(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """Allow only the platform superadmin (cross-tenant). 403 for everyone else."""
    if current_user.role != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin privileges required",
        )
    return current_user


def require_staff_or_admin(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """Allow admin or staff; block shliach (fixes10 §3.6 — org-level tooling
    like admin areas and the user directory is off-limits to shliach users)."""
    if current_user.role not in ("admin", "staff"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or staff privileges required",
        )
    return current_user


def require_staff_admin_or_campaign_manager(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """fixes58 §3.7: the Users ("Volunteers") directory read path — admin,
    staff, or campaign_manager; still blocks shliach, same reasoning as
    `require_staff_or_admin`."""
    if current_user.role not in ("admin", "staff", "campaign_manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin, staff, or campaign manager privileges required",
        )
    return current_user


def require_admin_or_campaign_manager(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """fixes58 §3.7: Campaign Manager gets full management of Apartments (and
    Campaigns/Tasks themselves), alongside admin."""
    if current_user.role not in ("admin", "campaign_manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or campaign manager privileges required",
        )
    return current_user


def forbid_campaign_manager(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """fixes58 §3.7: Campaign Manager is explicitly forbidden from Contacts,
    Visits, and global System Settings — applied to those routers'
    representative read/write endpoints, alongside whatever role check the
    endpoint already has."""
    if current_user.role == "campaign_manager":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Campaign managers cannot access this resource",
        )
    return current_user
