"""fixes75 §6/§9: the admin's Logs section — the entry (login-attempt) log,
the error log, and the "Errors Admin Emails" setting.

An org admin sees only rows attributed to their own organization. The
platform superadmin sees every row (optionally narrowed to one org).
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import get_current_user, require_admin

router = APIRouter(prefix="/api/logs", tags=["logs"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def require_log_viewer(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    if current_user.role not in ("admin", "superadmin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    return current_user


def _scoped(query, model, viewer: models.User, organization_id: Optional[int]):
    if viewer.role == "superadmin":
        if organization_id is not None:
            query = query.filter(model.organization_id == organization_id)
        return query
    return query.filter(model.organization_id == viewer.organization_id)


def _user_names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {
        u.id: u.full_name
        for u in db.query(models.User.id, models.User.full_name).filter(models.User.id.in_(ids))
    }


@router.get("/access")
def list_access_log(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    status_filter: Optional[str] = Query(None, alias="status"),
    q: Optional[str] = None,
    organization_id: Optional[int] = None,
    db: Session = Depends(get_db),
    viewer: models.User = Depends(require_log_viewer),
) -> dict:
    """Login attempts, newest first: user, time, IP, outcome."""
    Log = models.SystemAccessLog
    query = _scoped(db.query(Log), Log, viewer, organization_id)
    if status_filter == "success":
        query = query.filter(Log.status == "SUCCESS")
    elif status_filter == "failed":
        query = query.filter(Log.status.like("FAILED%"))
    if q:
        query = query.filter(Log.username.ilike(f"%{q.strip()}%"))
    total = query.count()
    rows = query.order_by(Log.id.desc()).offset(offset).limit(limit).all()
    names = _user_names(db, [r.user_id for r in rows])
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "date": r.date.isoformat() if r.date else None,
                "time": r.time.strftime("%H:%M:%S") if r.time else None,
                "username": r.username,
                "user_id": r.user_id,
                "user_name": names.get(r.user_id),
                "status": r.status,
                "ip_address": r.ip_address,
                "organization_id": r.organization_id,
            }
            for r in rows
        ],
    }


@router.get("/errors")
def list_error_log(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    organization_id: Optional[int] = None,
    db: Session = Depends(get_db),
    viewer: models.User = Depends(require_log_viewer),
) -> dict:
    """Unhandled server errors, newest first."""
    Log = models.ErrorLog
    query = _scoped(db.query(Log), Log, viewer, organization_id)
    total = query.count()
    rows = query.order_by(Log.id.desc()).offset(offset).limit(limit).all()
    names = _user_names(db, [r.user_id for r in rows])
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "user_id": r.user_id,
                "user_name": names.get(r.user_id),
                "method": r.method,
                "path": r.path,
                "status_code": r.status_code,
                "error_type": r.error_type,
                "message": r.message,
                "traceback": r.traceback,
                "ip_address": r.ip_address,
                "organization_id": r.organization_id,
            }
            for r in rows
        ],
    }


class ErrorEmailsIn(BaseModel):
    errors_admin_emails: list[str]

    @field_validator("errors_admin_emails")
    @classmethod
    def _valid(cls, value: list[str]) -> list[str]:
        out: list[str] = []
        for raw in value:
            email = (raw or "").strip().lower()
            if not email:
                continue
            if not _EMAIL_RE.match(email):
                raise ValueError(f"Invalid email address: {raw}")
            if email not in out:
                out.append(email)
        return out


@router.get("/settings")
def get_log_settings(admin: models.User = Depends(require_admin)) -> dict:
    return {"errors_admin_emails": admin.organization.errors_admin_emails or []}


@router.put("/settings")
def update_log_settings(
    payload: ErrorEmailsIn,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
) -> dict:
    org = db.get(models.Organization, admin.organization_id)
    org.errors_admin_emails = payload.errors_admin_emails
    db.commit()
    return {"errors_admin_emails": org.errors_admin_emails or []}
