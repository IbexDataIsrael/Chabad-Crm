"""fixes75 §4/§9: unhandled server errors are written to the `error_logs`
table and emailed to the organization's "Errors Admin Emails" list.

fixes101: errors logged by background work (BackgroundErrorHandler) and
browser crashes (record_client_error) take the same path.

fixes100: every error — with or without an organization behind it — also goes
to the superadmin's "error alerts" list (system settings), falling back to
PLATFORM_ADMIN_EMAIL / SUPERADMIN_EMAIL while that list is empty. The same
error (type + path) is emailed at most once per THROTTLE_SECONDS per
organization, so an error storm can't flood the inboxes or get the SMTP account blocked; every
occurrence is still logged.
"""
import logging
import threading
import time
import traceback as tb
from typing import Optional

from fastapi import Request

from app import models
from app.core.email import ERROR_NOTIFY_EMAILS_KEY, platform_notify_recipients, send_email
from app.core.security import decode_access_token
from app.database import get_db

logger = logging.getLogger("app.errors")

THROTTLE_SECONDS = 600
_last_sent: dict[tuple, float] = {}
_lock = threading.Lock()


def client_ip(request: Request) -> Optional[str]:
    """The caller's IP. Behind Render's proxy the real one is the first
    X-Forwarded-For entry."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64] or None
    return request.client.host if request.client else None


def _user_id_from_request(request: Request) -> Optional[int]:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    try:
        return int(decode_access_token(auth[7:].strip()).get("sub"))
    except Exception:  # noqa: BLE001 — a bad token just means "anonymous"
        return None


def recipients_for(db, org: Optional[models.Organization]) -> list[str]:
    out: list[str] = []
    org_list = (org.errors_admin_emails or []) if org is not None else []
    for addr in (*org_list, *platform_notify_recipients(db, ERROR_NOTIFY_EMAILS_KEY)):
        addr = (addr or "").strip().lower()
        if addr and addr not in out:
            out.append(addr)
    return out


def _should_email(key: tuple) -> bool:
    now = time.monotonic()
    with _lock:
        last = _last_sent.get(key)
        if last is not None and now - last < THROTTLE_SECONDS:
            return False
        _last_sent[key] = now
        return True


def _send_all(to: list[str], subject: str, body: str) -> None:
    for address in to:
        try:
            send_email(address, subject, body)
        except Exception:  # noqa: BLE001 — never let the alert itself fail loudly
            logger.exception("error alert email to %s failed", address)


def _store_and_alert(
    db,
    *,
    org: Optional[models.Organization],
    user: Optional[models.User],
    method: Optional[str],
    path: Optional[str],
    status_code: int,
    error_type: str,
    message: str,
    trace: str,
    ip: Optional[str],
    kind: str,
) -> int:
    """Write one error_logs row and email it (throttled, in a thread).
    `kind` names the source in the mail subject: server / logged / browser."""
    row = models.ErrorLog(
        organization_id=org.id if org else None,
        user_id=user.id if user else None,
        method=method,
        path=(path or "")[:500] or None,
        status_code=status_code,
        error_type=(error_type or "Error")[:200],
        message=(message or "")[:4000],
        traceback=(trace or "")[-20000:],
        ip_address=ip,
    )
    db.add(row)
    db.commit()
    row_id = row.id

    to = recipients_for(db, org)
    if to and _should_email((row.organization_id, kind, row.error_type, row.path)):
        subject = f"[{org.name if org else 'Mini CRM'}] {kind.capitalize()} error: {row.error_type}"
        body = (
            f"Time (UTC): {row.created_at:%Y-%m-%d %H:%M:%S}\n"
            f"Source: {kind}\n"
            f"Organization: {org.name if org else '-'}\n"
            f"User: {(user.full_name + ' <' + (user.email or user.username) + '>') if user else '-'}\n"
            f"Where: {row.method or ''} {row.path or '-'}\n"
            f"IP: {row.ip_address or '-'}\n"
            f"Error log id: {row_id}\n\n"
            f"{row.error_type}: {row.message}\n\n{(trace or '')[-6000:]}"
        )
        threading.Thread(target=_send_all, args=(to, subject, body), daemon=True).start()
    return row_id


def record_error(request: Request, exc: BaseException) -> Optional[int]:
    """Log one unhandled error to the DB and email it out. Never raises.
    Returns the error_logs id (None if even the DB write failed)."""
    trace = "".join(tb.format_exception(type(exc), exc, exc.__traceback__))
    # A fresh session (the request's own may be mid-failed-transaction),
    # through get_db so a test's dependency override is honoured.
    session_gen = request.app.dependency_overrides.get(get_db, get_db)()
    db = next(session_gen)
    _guard.active = True
    try:
        user = None
        uid = _user_id_from_request(request)
        if uid is not None:
            user = db.get(models.User, uid)
        org = user.organization if user is not None else None
        return _store_and_alert(
            db,
            org=org,
            user=user,
            method=request.method,
            path=str(request.url.path),
            status_code=500,
            error_type=type(exc).__name__,
            message=str(exc),
            trace=trace,
            ip=client_ip(request),
            kind="server",
        )
    except Exception:  # noqa: BLE001 — error logging must never mask the error
        logger.exception("could not record error log")
        db.rollback()
        return None
    finally:
        _guard.active = False
        session_gen.close()


def record_client_error(
    request: Request,
    *,
    error_type: str,
    message: str,
    stack: str,
    page: str,
    user_agent: str,
) -> Optional[int]:
    """fixes101 §2c: a crash in the user's browser, reported by the frontend."""
    session_gen = request.app.dependency_overrides.get(get_db, get_db)()
    db = next(session_gen)
    _guard.active = True
    try:
        user = None
        uid = _user_id_from_request(request)
        if uid is not None:
            user = db.get(models.User, uid)
        org = user.organization if user is not None else None
        return _store_and_alert(
            db,
            org=org,
            user=user,
            method="BROWSER",
            path=page,
            status_code=0,
            error_type=error_type,
            message=message,
            trace=f"{stack}\n\nUser agent: {user_agent}" if user_agent else stack,
            ip=client_ip(request),
            kind="browser",
        )
    except Exception:  # noqa: BLE001
        logger.exception("could not record client error")
        db.rollback()
        return None
    finally:
        _guard.active = False
        session_gen.close()


# --- fixes101 §2b: errors that were caught and logged ------------------------
# A request's own 500 goes through record_error. An error the code catches
# itself — background work (email sends, Cloudinary cleanup, geocoding,
# threads) or a handled failure inside a request — only ever reaches
# `logger.exception(...)`. This handler on the "app" logger turns every such
# ERROR record that carries a traceback into an error_logs row + alert. `_guard` stops recursion (a failing alert email logs again).
_guard = threading.local()
# Off in the test suite (conftest) except where a test opts in.
capture_background_errors = True


class BackgroundErrorHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.ERROR)

    def emit(self, record: logging.LogRecord) -> None:
        if not capture_background_errors or not record.exc_info:
            return
        if record.name == logger.name or getattr(_guard, "active", False):
            return
        exc = record.exc_info[1]
        if exc is None:
            return
        _guard.active = True
        try:
            from app import database  # looked up per call: tests swap SessionLocal

            from app.core.activity_log import current_user_id

            db = database.SessionLocal()
            try:
                trace = "".join(tb.format_exception(*record.exc_info))
                # fixes102 Part A: inside a request, whose request it was —
                # so the row is the org's and its errors list is mailed too.
                uid = current_user_id.get()
                user = db.get(models.User, uid) if uid is not None else None
                _store_and_alert(
                    db,
                    org=user.organization if user is not None else None,
                    user=user,
                    method="LOG",
                    path=f"{record.name}:{record.funcName}",
                    status_code=0,
                    error_type=type(exc).__name__,
                    message=f"{record.getMessage()} — {exc}",
                    trace=trace,
                    ip=None,
                    kind="logged",
                )
            except Exception:  # noqa: BLE001
                db.rollback()
            finally:
                db.close()
        except Exception:  # noqa: BLE001 — a logging handler must never raise
            pass
        finally:
            _guard.active = False


def install_background_error_handler() -> None:
    app_logger = logging.getLogger("app")
    if not any(isinstance(h, BackgroundErrorHandler) for h in app_logger.handlers):
        app_logger.addHandler(BackgroundErrorHandler())
