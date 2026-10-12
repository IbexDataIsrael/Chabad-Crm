"""fixes101: browser crashes + caught/logged errors are stored and emailed;
superadmin "notify emails" status (configured / where mail goes now)."""
import logging

import pytest

from app import models
from app.core.security import hash_password


@pytest.fixture
def superadmin_headers(client, db_session):
    org = models.Organization(name="System", is_active=True)
    db_session.add(org)
    db_session.flush()
    db_session.add(
        models.User(
            organization_id=org.id,
            username="superadmin",
            full_name="superadmin",
            email="root@system.local",
            password_hash=hash_password("pw12345"),
            role="superadmin",
            is_active=True,
            email_verified=True,
        )
    )
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "superadmin", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def alerts(monkeypatch):
    """Capture alert emails synchronously; platform list falls back to env."""
    from app.config import settings
    from app.core import error_log

    monkeypatch.setattr(settings, "platform_admin_email", "ops@x.com")
    monkeypatch.setattr(settings, "superadmin_email", "")
    monkeypatch.setattr(error_log, "_last_sent", {})
    sent = []
    monkeypatch.setattr(error_log, "_send_all", lambda to, subject, body: sent.append((to, subject, body)))

    class _SyncThread:
        def __init__(self, target, args, daemon=None):
            self._t, self._a = target, args

        def start(self):
            self._t(*self._a)

    monkeypatch.setattr(error_log.threading, "Thread", _SyncThread)
    return sent


def _errors(db_session):
    db_session.expire_all()
    return db_session.query(models.ErrorLog).order_by(models.ErrorLog.id).all()


# --- §2c browser crashes ---------------------------------------------------------
def test_client_error_anonymous_is_stored_and_emailed(client, db_session, alerts):
    r = client.post(
        "/api/logs/client-error",
        json={
            "error_type": "TypeError",
            "message": "x is undefined",
            "stack": "at foo (app.js:1:2)",
            "page": "/dashboard/street2",
            "user_agent": "Mobile Safari",
        },
    )
    assert r.status_code == 204
    [row] = _errors(db_session)
    assert (row.method, row.path, row.error_type, row.organization_id) == (
        "BROWSER", "/dashboard/street2", "TypeError", None,
    )
    assert "Mobile Safari" in row.traceback
    assert alerts and alerts[0][0] == ["ops@x.com"]
    assert "Browser error: TypeError" in alerts[0][1]


def test_client_error_is_attributed_to_the_users_org(client, db_session, admin_headers, alerts):
    r = client.post(
        "/api/logs/client-error",
        json={"error_type": "Error", "message": "boom", "page": "/dashboard"},
        headers=admin_headers,
    )
    assert r.status_code == 204
    [row] = _errors(db_session)
    assert row.organization_id is not None and row.user_id is not None
    # The org admin sees it on their own Logs page.
    items = client.get("/api/logs/errors", headers=admin_headers).json()["items"]
    assert [i["method"] for i in items] == ["BROWSER"]


def test_client_error_is_rate_limited_per_ip(client, db_session, alerts, monkeypatch):
    from app.routers import logs as logs_router

    monkeypatch.setattr(logs_router, "_client_error_hits", {})
    monkeypatch.setattr(logs_router, "CLIENT_ERROR_LIMIT", 3)
    for _ in range(5):
        assert client.post("/api/logs/client-error", json={"message": "m"}).status_code == 204
    assert len(_errors(db_session)) == 3


def test_client_error_rejects_oversized_payload(client):
    r = client.post("/api/logs/client-error", json={"message": "m" * 5000})
    assert r.status_code == 422


# --- §2b caught + logged errors ----------------------------------------------------
def test_logged_exception_is_stored_and_emailed(db_session, alerts, monkeypatch):
    from app.core import error_log

    monkeypatch.setattr(error_log, "capture_background_errors", True)
    log = logging.getLogger("app.core.something")
    try:
        raise ValueError("smtp exploded")
    except ValueError:
        log.exception("sending welcome mail failed")
    log.error("plain error without a traceback is not an alert")

    [row] = _errors(db_session)
    assert row.method == "LOG" and row.error_type == "ValueError"
    assert row.path.startswith("app.core.something:")
    assert "sending welcome mail failed" in row.message and "smtp exploded" in row.message
    assert alerts[0][0] == ["ops@x.com"] and "Logged error: ValueError" in alerts[0][1]


def test_failing_alert_does_not_recurse(db_session, alerts, monkeypatch):
    """The alert mailer's own failures log on app.errors — never re-captured."""
    from app.core import error_log

    monkeypatch.setattr(error_log, "capture_background_errors", True)
    try:
        raise RuntimeError("alert send failed")
    except RuntimeError:
        error_log.logger.exception("error alert email to ops failed")
    assert _errors(db_session) == []


def test_logged_capture_is_off_unless_enabled(db_session, alerts):
    try:
        raise ValueError("x")
    except ValueError:
        logging.getLogger("app.core.other").exception("expected in tests")
    assert _errors(db_session) == []


# --- §1/§3 notify-emails status ------------------------------------------------------
def test_notify_emails_status(client, superadmin_headers, admin_headers, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "platform_admin_email", "ops@x.com")
    monkeypatch.setattr(settings, "superadmin_email", "Root@x.com")
    url = "/api/admin/notify-emails-status"
    assert client.get(url, headers=admin_headers).status_code == 403
    assert client.get(url, headers=superadmin_headers).json() == {
        "pending_signup": {"configured": False, "effective": ["ops@x.com", "root@x.com"]},
        "errors": {"configured": False, "effective": ["ops@x.com", "root@x.com"]},
    }
    client.put("/api/admin/error-notify-emails", json={"emails": ["dev@x.com"]}, headers=superadmin_headers)
    body = client.get(url, headers=superadmin_headers).json()
    assert body["errors"] == {"configured": True, "effective": ["dev@x.com"]}
    assert body["pending_signup"]["configured"] is False
