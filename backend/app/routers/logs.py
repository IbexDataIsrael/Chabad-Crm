"""fixes75 §6/§9: the admin's Logs section — the entry (login-attempt) log,
the error log, and the "Errors Admin Emails" setting.

An org admin sees only rows attributed to their own organization. The
platform superadmin sees every row (optionally narrowed to one org).
"""
import datetime
import re
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app import models
from app.core.error_log import client_ip, record_client_error
from app.database import get_db
from app.deps import get_current_user, require_admin, require_superadmin

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


def _org_names(db: Session, ids) -> dict[int, str]:
    """fixes83: the superadmin's cross-org view names each row's org."""
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {
        o.id: o.name
        for o in db.query(models.Organization.id, models.Organization.name).filter(
            models.Organization.id.in_(ids)
        )
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
    orgs = _org_names(db, [r.organization_id for r in rows])
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
                "organization_name": orgs.get(r.organization_id),
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
    orgs = _org_names(db, [r.organization_id for r in rows])
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
                "organization_name": orgs.get(r.organization_id),
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
                raise ValueError("Invalid email address")
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


# --- fixes101 §2c: crashes in the user's browser --------------------------------
class ClientErrorIn(BaseModel):
    error_type: str = Field("Error", max_length=200)
    message: str = Field("", max_length=4000)
    stack: str = Field("", max_length=20000)
    page: str = Field("", max_length=500)
    user_agent: str = Field("", max_length=500)


# Open to anonymous callers (a crash on the login page counts too), so cap
# what one IP can write: CLIENT_ERROR_LIMIT reports per CLIENT_ERROR_WINDOW.
CLIENT_ERROR_LIMIT = 20
CLIENT_ERROR_WINDOW = 600
_client_error_hits: dict[str, list[float]] = {}
_client_error_lock = threading.Lock()


def _client_error_allowed(ip: str) -> bool:
    now = time.monotonic()
    with _client_error_lock:
        hits = [t for t in _client_error_hits.get(ip, []) if now - t < CLIENT_ERROR_WINDOW]
        allowed = len(hits) < CLIENT_ERROR_LIMIT
        if allowed:
            hits.append(now)
        _client_error_hits[ip] = hits
        return allowed


@router.post("/client-error", status_code=status.HTTP_204_NO_CONTENT)
def report_client_error(payload: ClientErrorIn, request: Request) -> Response:
    if _client_error_allowed(client_ip(request) or "-"):
        record_client_error(
            request,
            error_type=payload.error_type.strip() or "Error",
            message=payload.message,
            stack=payload.stack,
            page=payload.page,
            user_agent=payload.user_agent,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- fixes102: the per-org activity log (superadmin only) ------------------------
def _activity_query(
    db: Session,
    organization_id: Optional[int],
    user_id: Optional[int],
    kind: Optional[str],
    action: Optional[str],
    date_from: Optional[datetime.date],
    date_to: Optional[datetime.date],
):
    Log = models.ActivityLog
    query = db.query(Log)
    if organization_id is not None:
        query = query.filter(Log.organization_id == organization_id)
    if user_id is not None:
        query = query.filter(Log.user_id == user_id)
    if kind:
        query = query.filter(Log.kind == kind)
    if action:
        query = query.filter(Log.action == action)
    if date_from:
        query = query.filter(Log.created_at >= datetime.datetime.combine(date_from, datetime.time.min))
    if date_to:
        query = query.filter(
            Log.created_at < datetime.datetime.combine(date_to + datetime.timedelta(days=1), datetime.time.min)
        )
    return query


@router.get("/activity")
def list_activity_log(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    organization_id: Optional[int] = None,
    user_id: Optional[int] = None,
    kind: Optional[str] = Query(None, pattern="^(action|page_view)$"),
    action: Optional[str] = None,
    date_from: Optional[datetime.date] = None,
    date_to: Optional[datetime.date] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
) -> dict:
    """Who did what, newest first. Only orgs the superadmin turned the
    log on for have rows."""
    Log = models.ActivityLog
    query = _activity_query(db, organization_id, user_id, kind, action, date_from, date_to)
    total = query.count()
    rows = query.order_by(Log.id.desc()).offset(offset).limit(limit).all()
    names = _user_names(db, [r.user_id for r in rows])
    orgs = _org_names(db, [r.organization_id for r in rows])
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "organization_id": r.organization_id,
                "organization_name": orgs.get(r.organization_id),
                "user_id": r.user_id,
                "user_name": names.get(r.user_id),
                "kind": r.kind,
                "action": r.action,
                "method": r.method,
                "route": r.route,
                "entity_id": r.entity_id,
                "page": r.page,
                "ip_address": r.ip_address,
            }
            for r in rows
        ],
    }


@router.get("/activity/options")
def activity_log_options(
    organization_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_superadmin),
) -> dict:
    """Filter choices: the users and actions that actually appear."""
    Log = models.ActivityLog
    base = db.query(Log)
    if organization_id is not None:
        base = base.filter(Log.organization_id == organization_id)
    user_ids = [u for (u,) in base.with_entities(Log.user_id).distinct() if u is not None]
    names = _user_names(db, user_ids)
    actions = sorted(a for (a,) in base.with_entities(Log.action).distinct())
    return {
        "users": sorted(
            ({"id": i, "name": names.get(i) or f"#{i}"} for i in user_ids), key=lambda u: u["name"]
        ),
        "actions": actions,
    }
