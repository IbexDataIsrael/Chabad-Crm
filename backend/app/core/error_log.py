"""fixes75 §4/§9: unhandled server errors are written to the `error_logs`
table and emailed to the organization's "Errors Admin Emails" list.

An error with no organization behind it (no/invalid token) is emailed to the
platform operator (PLATFORM_ADMIN_EMAIL) instead. The same error (type + path)
is emailed at most once per THROTTLE_SECONDS per organization, so an error
storm can't flood the inboxes or get the SMTP account blocked; every
occurrence is still logged.
"""
import logging
import threading
import time
import traceback as tb
from typing import Optional

from fastapi import Request

from app import models
from app.config import settings
from app.core.email import send_email
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


def recipients_for(org: Optional[models.Organization]) -> list[str]:
    if org is not None:
        return [e for e in (org.errors_admin_emails or []) if e]
    return [settings.platform_admin_email] if settings.platform_admin_email else []


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


def record_error(request: Request, exc: BaseException) -> Optional[int]:
    """Log one unhandled error to the DB and email it out. Never raises.
    Returns the error_logs id (None if even the DB write failed)."""
    trace = "".join(tb.format_exception(type(exc), exc, exc.__traceback__))
    # A fresh session (the request's own may be mid-failed-transaction),
    # through get_db so a test's dependency override is honoured.
    session_gen = request.app.dependency_overrides.get(get_db, get_db)()
    db = next(session_gen)
    try:
        user = None
        uid = _user_id_from_request(request)
        if uid is not None:
            user = db.get(models.User, uid)
        org = user.organization if user is not None else None
        row = models.ErrorLog(
            organization_id=org.id if org else None,
            user_id=user.id if user else None,
            method=request.method,
            path=str(request.url.path)[:500],
            status_code=500,
            error_type=type(exc).__name__[:200],
            message=str(exc)[:4000],
            traceback=trace[-20000:],
            ip_address=client_ip(request),
        )
        db.add(row)
        db.commit()
        row_id = row.id

        to = recipients_for(org)
        if to and _should_email((row.organization_id, row.error_type, row.path)):
            subject = f"[{org.name if org else 'Mini CRM'}] Server error: {row.error_type}"
            body = (
                f"Time (UTC): {row.created_at:%Y-%m-%d %H:%M:%S}\n"
                f"Organization: {org.name if org else '-'}\n"
                f"User: {(user.full_name + ' <' + (user.email or user.username) + '>') if user else '-'}\n"
                f"Request: {row.method} {row.path}\n"
                f"IP: {row.ip_address or '-'}\n"
                f"Error log id: {row_id}\n\n"
                f"{row.error_type}: {row.message}\n\n{trace[-6000:]}"
            )
            threading.Thread(target=_send_all, args=(to, subject, body), daemon=True).start()
        return row_id
    except Exception:  # noqa: BLE001 — error logging must never mask the error
        logger.exception("could not record error log")
        db.rollback()
        return None
    finally:
        session_gen.close()
