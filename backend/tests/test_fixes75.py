"""fixes75: user-delete cleanup, logs, password resets, login messages,
errors-admin emails, welcome email on email edit."""
import pytest

from app import models
from tests.test_fixes74 import (  # noqa: F401 — fixtures re-used
    _activist_with_contact,
    _task,
    org_id,
    setup,
)


# --- §11: deleting a user cleans up its bindings ------------------------------
def test_delete_user_with_tasks_and_bindings(client, admin_headers, setup, db_session, org_id):
    user = _activist_with_contact(db_session, org_id, "del75")
    other = _activist_with_contact(db_session, org_id, "keep75")
    open_task = _task(client, admin_headers, setup, names=("1",), volunteer_user_id=user.id)
    done_task = _task(client, admin_headers, setup, names=("2",), volunteer_user_id=user.id)
    client.put(f"/api/tasks/{done_task['id']}", json={"status": "COMPLETED"}, headers=admin_headers)

    # Direct report-number + area bindings, for both activists.
    for u in (user, other):
        r = client.put(
            f"/api/users/{u.id}",
            json={"shliach": {"report_number_ids": [setup["rns"]["3"]], "area_ids": []}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
    sh = (
        db_session.query(models.ContactShliach)
        .filter_by(user_id=user.id, is_display=True)
        .one()
    )
    contact_id = sh.contact_id
    # History rows pointing at the user.
    paper = models.TaskPaperEntry(
        organization_id=org_id, task_id=open_task["id"], performer_user_id=user.id,
        entered_by_user_id=user.id,
    )
    db_session.add(paper)
    db_session.commit()
    paper_id = paper.id

    user_id, other_id = user.id, other.id
    r = client.delete(f"/api/users/{user_id}", headers=admin_headers)
    assert r.status_code == 204, r.text
    db_session.expire_all()

    assert db_session.get(models.User, user_id) is None
    t_open = db_session.get(models.Task, open_task["id"])
    assert t_open.volunteer_user_id is None and t_open.status == "AVAILABLE"
    t_done = db_session.get(models.Task, done_task["id"])
    assert t_done.volunteer_user_id is None and t_done.status == "COMPLETED"

    current = (
        db_session.query(models.ContactShliach)
        .filter_by(contact_id=contact_id, is_display=True)
        .one()
    )
    assert current.user_id is None
    assert current.report_numbers == [] and current.areas == []
    # The retired version still shows what they had.
    retired = (
        db_session.query(models.ContactShliach)
        .filter_by(contact_id=contact_id, is_display=False)
        .all()
    )
    assert any(v.report_numbers for v in retired)

    # The binding feature itself still works for everyone else.
    other_sh = (
        db_session.query(models.ContactShliach)
        .filter_by(user_id=other_id, is_display=True)
        .one()
    )
    assert [r.report_number_id for r in other_sh.report_numbers] == [setup["rns"]["3"]]

    kept = db_session.get(models.TaskPaperEntry, paper_id)
    assert kept is not None
    assert kept.performer_user_id is None and kept.entered_by_user_id is None


# --- §10: login email changed from the contact form → welcome email ----------
def test_contact_form_email_edit_sends_welcome(client, admin_headers, monkeypatch):
    from tests.test_fixes14 import _mk_shliach

    sent = []
    monkeypatch.setattr(
        "app.routers.contacts.send_shliach_welcome",
        lambda *a, **kw: sent.append(kw.get("to")),
    )
    contact = _mk_shliach(client, admin_headers, "c75old@example.com").json()
    sent.clear()  # creation's own welcome

    # Unchanged email -> nothing sent.
    r = client.put(f"/api/contacts/{contact['id']}", json={"notes": "x"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert sent == []

    r = client.put(
        f"/api/contacts/{contact['id']}", json={"email": "c75new@example.com"}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert sent == ["c75new@example.com"]


# --- §3: superadmin resets a user's password ---------------------------------
from tests.test_fixes10 import superadmin_headers  # noqa: E402,F401
from app.core.security import hash_password  # noqa: E402


def _mk_user(db_session, org_id, username, password="Passw0rd!", email=None):
    user = models.User(
        organization_id=org_id, username=username, full_name=f"{username} name",
        email=email or f"{username}@example.com", password_hash=hash_password(password),
        role="staff", is_active=True, email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_superadmin_resets_password(client, admin_headers, superadmin_headers, db_session, org_id):
    user = _mk_user(db_session, org_id, "reset3")
    r = client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "weak"}, headers=superadmin_headers,
    )
    assert r.status_code == 422
    r = client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "NewPass123"}, headers=superadmin_headers,
    )
    assert r.status_code == 200, r.text
    assert client.post("/api/auth/token", data={"username": "reset3", "password": "NewPass123"}).status_code == 200
    assert client.post("/api/auth/token", data={"username": "reset3", "password": "Passw0rd!"}).status_code == 401
    # An org admin can't use it.
    r = client.post(
        f"/api/admin/users/{user.id}/reset-password",
        json={"new_password": "NewPass123"}, headers=admin_headers,
    )
    assert r.status_code == 403


# --- §5/§6: entry log with user, time, IP; org-scoped view -------------------
def test_entry_log_records_ip_and_user(client, admin_headers, db_session, org_id):
    user = _mk_user(db_session, org_id, "entry5")
    client.post(
        "/api/auth/token", data={"username": "entry5", "password": "wrong"},
        headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.1"},
    )
    client.post(
        "/api/auth/token", data={"username": "entry5", "password": "Passw0rd!"},
        headers={"X-Forwarded-For": "203.0.113.8"},
    )
    client.post("/api/auth/token", data={"username": "nobody-at-all", "password": "x"})

    r = client.get("/api/logs/access", headers=admin_headers)
    assert r.status_code == 200, r.text
    rows = [i for i in r.json()["items"] if i["username"] == "entry5"]
    assert [(i["status"], i["ip_address"], i["user_id"]) for i in rows] == [
        ("SUCCESS", "203.0.113.8", user.id),
        ("FAILED_INVALID_PASSWORD", "203.0.113.7", user.id),
    ]
    assert rows[0]["user_name"] == "entry5 name" and rows[0]["time"]
    # An attempt for an unknown identifier can't be tied to this org.
    assert all(i["username"] != "nobody-at-all" for i in r.json()["items"])
    failed = client.get("/api/logs/access?status=failed", headers=admin_headers).json()
    assert {i["status"] for i in failed["items"]} <= {
        "FAILED_INVALID_PASSWORD", "FAILED_NO_USER", "FAILED_NOT_VERIFIED", "FAILED_ORG_DISABLED"
    }


def test_logs_are_admin_only_and_org_scoped(client, admin_headers, auth_headers, db_session):
    assert client.get("/api/logs/access", headers=auth_headers).status_code == 403
    assert client.get("/api/logs/errors", headers=auth_headers).status_code == 403
    other = models.Organization(name="Other75")
    db_session.add(other)
    db_session.flush()
    db_session.add(models.ErrorLog(organization_id=other.id, error_type="X", status_code=500))
    db_session.commit()
    items = client.get("/api/logs/errors", headers=admin_headers).json()["items"]
    assert all(i["organization_id"] != other.id for i in items)


# --- §4/§9: unhandled errors are logged and emailed ---------------------------
def test_unhandled_error_is_logged_and_emailed(client, admin_headers, monkeypatch, org_id):
    from fastapi.testclient import TestClient

    from app.core import error_log
    from app.main import app

    r = client.put(
        "/api/logs/settings",
        json={"errors_admin_emails": ["Ops@Example.com", "ops@example.com", "", "dev@example.com"]},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["errors_admin_emails"] == ["ops@example.com", "dev@example.com"]
    assert client.put(
        "/api/logs/settings", json={"errors_admin_emails": ["not-an-email"]}, headers=admin_headers
    ).status_code == 422

    sent = []
    monkeypatch.setattr(error_log, "_send_all", lambda to, subject, body: sent.append((to, subject)))

    class _SyncThread:
        def __init__(self, target, args, daemon=None):
            self._t, self._a = target, args

        def start(self):
            self._t(*self._a)

    monkeypatch.setattr(error_log.threading, "Thread", _SyncThread)
    monkeypatch.setattr(error_log, "_last_sent", {})

    from app.routers import logs as logs_router

    real_user_names = logs_router._user_names
    calls = []

    def boom_once(db, ids):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("kaboom 75")
        return real_user_names(db, ids)

    monkeypatch.setattr(logs_router, "_user_names", boom_once)
    raw = TestClient(app, raise_server_exceptions=False)
    r = raw.get("/api/logs/access", headers=admin_headers)
    assert r.status_code == 500
    assert r.json()["error_id"]

    items = client.get("/api/logs/errors", headers=admin_headers).json()["items"]
    assert items[0]["error_type"] == "RuntimeError"
    assert items[0]["message"] == "kaboom 75"
    assert items[0]["path"] == "/api/logs/access"
    assert "Traceback" in items[0]["traceback"]
    assert sent and sent[0][0] == ["ops@example.com", "dev@example.com"]


def test_error_emails_are_throttled(monkeypatch):
    from app.core import error_log

    monkeypatch.setattr(error_log, "_last_sent", {})
    key = (1, "RuntimeError", "/x")
    assert error_log._should_email(key) is True
    assert error_log._should_email(key) is False
    assert error_log._should_email((1, "RuntimeError", "/y")) is True


# --- §7: forgot password -------------------------------------------------------
def test_forgot_and_reset_password(client, admin_headers, db_session, org_id, monkeypatch):
    from app.routers import auth as auth_router

    _mk_user(db_session, org_id, "forgot7", email="forgot7@example.com")
    links = []
    monkeypatch.setattr(
        auth_router, "send_password_reset", lambda db, user, link, minutes: links.append(link)
    )
    monkeypatch.setattr(auth_router, "_reset_last_sent", {})

    # Unknown address: same answer, nothing sent.
    assert client.post("/api/auth/forgot-password", json={"email": "nope@example.com"}).json() == {"status": "ok"}
    assert links == []
    assert client.post("/api/auth/forgot-password", json={"email": "Forgot7@Example.com"}).status_code == 200
    assert len(links) == 1
    token = links[0].split("token=", 1)[1]

    # The reset token is not a login token.
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    r = client.post("/api/auth/reset-password", json={"token": token, "new_password": "weak"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "auth.error.password_weak"
    r = client.post("/api/auth/reset-password", json={"token": token, "new_password": "Brand1New"})
    assert r.status_code == 200, r.text
    assert client.post("/api/auth/token", data={"username": "forgot7", "password": "Brand1New"}).status_code == 200
    # Single use.
    r = client.post("/api/auth/reset-password", json={"token": token, "new_password": "Again1New"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "auth.error.reset_link_invalid"
    r = client.post("/api/auth/reset-password", json={"token": "garbage", "new_password": "Again1New"})
    assert r.status_code == 400


def test_email_verify_token_is_not_a_login_token(client, db_session, org_id, admin_headers):
    from app.core.security import create_email_token

    user = _mk_user(db_session, org_id, "verifytok")
    token = create_email_token(user.id)
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


# --- §8: login errors carry a translation key ----------------------------------
def test_login_errors_carry_translation_codes(client, admin_headers, db_session, org_id):
    from app.seed import LOCALIZATION

    keys = {row[1] for row in LOCALIZATION}
    r = client.post("/api/auth/token", data={"username": "ghost", "password": "x"})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "auth.error.invalid_credentials"
    user = _mk_user(db_session, org_id, "unverified8")
    user.email_verified = False
    db_session.commit()
    r = client.post("/api/auth/token", data={"username": "unverified8", "password": "Passw0rd!"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "auth.error.not_verified"
    for code in (
        "auth.error.invalid_credentials", "auth.error.not_verified", "auth.error.org_pending",
        "auth.error.org_disabled", "auth.error.google_invalid", "auth.error.google_no_user",
        "auth.error.reset_link_invalid", "auth.error.password_weak",
    ):
        assert code in keys, code
