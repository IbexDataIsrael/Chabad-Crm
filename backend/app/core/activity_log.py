"""fixes102: per-organization activity log — who did what, when.

Off by default; the superadmin turns it on per organization
(organization_prefs `activity_log_enabled`) and is the only one who reads it.

Two kinds of rows:
- `action`: every successful POST / PUT / PATCH / DELETE under /api/*, recorded
  by the request middleware in main.py — so a new feature is covered without
  any per-route code. The action name is derived from the route template:
  `PUT /api/apartments/{apartment_id}` -> resource "apartments", verb "update".
- `page_view`: the frontend reports each dashboard page it opens
  (POST /api/activity/page-view), only while the org has the log on.

Rows older than RETENTION_DAYS are purged daily by the scheduler.

Also home of `current_user_id`: the request's user id (from the bearer
token) for the duration of the request, so code that only has a logger —
the error capture in core/error_log.py — can still tell whose request it
was (fixes102 Part A).
"""
import contextvars
import datetime
import logging
import threading
import time
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.core import org_prefs

logger = logging.getLogger("app.activity")

RETENTION_DAYS = 90
PREF_KEY = "activity_log_enabled"

current_user_id: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "current_user_id", default=None
)

MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
VERBS = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}

# Not activity: logins/signups (the entry log has them), the superadmin's
# own tools, log endpoints, UI-state autosave, anonymous public pages,
# street2's own event sync and the machine (Instinct) API.
EXCLUDED_PREFIXES = (
    "/api/auth/",
    "/api/admin/",
    "/api/logs/",
    "/api/activity/",
    "/api/preferences",
    "/api/public/",
    "/api/street-activity",
    "/api/instinct",
)

# user id -> (organization_id, role) and org id -> enabled, cached briefly so
# an org with the log off costs no query on most writes.
_CACHE_SECONDS = 60
_user_cache: dict[int, tuple[float, Optional[int], Optional[str]]] = {}
_org_cache: dict[int, tuple[float, bool]] = {}
_cache_lock = threading.Lock()


def clear_cache() -> None:
    """Called when the superadmin flips the toggle, so it applies at once."""
    with _cache_lock:
        _org_cache.clear()
        _user_cache.clear()


def should_track(method: str, path: str) -> bool:
    return (
        method in MUTATING_METHODS
        and path.startswith("/api/")
        and not path.startswith(EXCLUDED_PREFIXES)
    )


def describe(route: str) -> str:
    """`/api/apartments/{apartment_id}/versions` -> "apartments.versions"."""
    parts = [p for p in route.split("/") if p and p != "api" and not p.startswith("{")]
    return ".".join(parts)[:150] or "unknown"


def entity_id_from(path_params: dict) -> Optional[int]:
    for value in path_params.values():
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return None


def _session() -> Session:
    from app import database  # looked up per call: tests swap SessionLocal

    return database.SessionLocal()


def enabled_org_for_user(user_id: int) -> Optional[int]:
    """The user's organization id if that org has the log on (and the user
    isn't the superadmin), else None. Cached."""
    now = time.monotonic()
    with _cache_lock:
        hit = _user_cache.get(user_id)
    if hit is None or now - hit[0] > _CACHE_SECONDS:
        db = _session()
        try:
            user = db.get(models.User, user_id)
            org_id, role = (user.organization_id, user.role) if user else (None, None)
        finally:
            db.close()
        with _cache_lock:
            _user_cache[user_id] = (now, org_id, role)
    else:
        _, org_id, role = hit
    if org_id is None or role == "superadmin":
        return None

    with _cache_lock:
        org_hit = _org_cache.get(org_id)
    if org_hit is None or now - org_hit[0] > _CACHE_SECONDS:
        db = _session()
        try:
            enabled = org_prefs.get_raw_prefs(db, org_id)[PREF_KEY]
        finally:
            db.close()
        with _cache_lock:
            _org_cache[org_id] = (now, enabled)
    else:
        enabled = org_hit[1]
    return org_id if enabled else None


def write(
    *,
    organization_id: int,
    user_id: Optional[int],
    kind: str,
    action: str,
    method: Optional[str] = None,
    route: Optional[str] = None,
    entity_id: Optional[int] = None,
    page: Optional[str] = None,
    ip: Optional[str] = None,
    db: Optional[Session] = None,
) -> None:
    """Insert one row. Never raises (activity logging must not break a
    request); uses its own session unless one is passed."""
    own = db is None
    db = db or _session()
    try:
        db.add(
            models.ActivityLog(
                organization_id=organization_id,
                user_id=user_id,
                kind=kind,
                action=action[:150],
                method=method,
                route=(route or "")[:300] or None,
                entity_id=entity_id,
                page=(page or "")[:500] or None,
                ip_address=ip,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.warning("could not write activity log row", exc_info=True)
    finally:
        if own:
            db.close()


def purge_old(days: int = RETENTION_DAYS) -> int:
    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    db = _session()
    try:
        n = (
            db.query(models.ActivityLog)
            .filter(models.ActivityLog.created_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if n:
            logger.info("activity log: purged %d rows older than %d days", n, days)
        return n
    finally:
        db.close()
