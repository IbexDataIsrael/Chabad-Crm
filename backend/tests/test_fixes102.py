"""fixes102: per-org activity log (off by default, superadmin-only) and the
org/user on caught+logged errors."""
import datetime
import logging

import pytest

from app import models
from app.core.security import hash_password


@pytest.fixture(autouse=True)
def _fresh_cache():
    from app.core import activity_log

    activity_log.clear_cache()
    yield
    activity_log.clear_cache()


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


def _admin_org_id(client, admin_headers):
    return client.get("/api/auth/me", headers=admin_headers).json()["organization_id"]


def _enable(client, superadmin_headers, org_id, on=True):
    r = client.put(
        f"/api/admin/organizations/{org_id}/prefs",
        json={"activity_log_enabled": on},
        headers=superadmin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["raw"]["activity_log_enabled"] is on


def _rows(db_session):
    db_session.expire_all()
    return db_session.query(models.ActivityLog).order_by(models.ActivityLog.id).all()


def test_off_by_default_nothing_is_logged(client, db_session, admin_headers):
    assert client.post("/api/areas", json={"area_name": "א"}, headers=admin_headers).status_code == 201
    assert client.post(
        "/api/activity/page-view", json={"page": "/dashboard/contacts"}, headers=admin_headers
    ).status_code == 204
    assert _rows(db_session) == []
    me = client.get("/api/auth/me", headers=admin_headers).json()
    assert me["organization"]["feature_flags"]["activity_log_enabled"] is False


def test_actions_are_logged_when_enabled(client, db_session, admin_headers, superadmin_headers):
    org_id = _admin_org_id(client, admin_headers)
    _enable(client, superadmin_headers, org_id)

    area = client.post("/api/areas", json={"area_name": "א"}, headers=admin_headers)
    assert area.status_code == 201
    area_id = area.json()["id"]
    assert area.json()["area_name"] == "א"  # body survives the middleware re-read
    assert client.put(
        f"/api/areas/{area_id}", json={"area_name": "ב"}, headers=admin_headers
    ).status_code == 200
    # Not logged: a failed request, a read, UI-state autosave.
    assert client.put("/api/areas/999999", json={"area_name": "x"}, headers=admin_headers).status_code == 404
    client.get("/api/areas", headers=admin_headers)
    client.put("/api/preferences", json={"key": "x", "value": 1}, headers=admin_headers)

    rows = _rows(db_session)
    assert [(r.kind, r.action, r.method, r.entity_id) for r in rows] == [
        ("action", "areas.create", "POST", area_id),
        ("action", "areas.update", "PUT", area_id),
    ]
    assert rows[1].route == "/api/areas/{area_id}"
    assert all(r.organization_id == org_id and r.user_id is not None for r in rows)


def test_page_views_and_toggle_off_again(client, db_session, admin_headers, superadmin_headers):
    org_id = _admin_org_id(client, admin_headers)
    _enable(client, superadmin_headers, org_id)
    me = client.get("/api/auth/me", headers=admin_headers).json()
    assert me["organization"]["feature_flags"]["activity_log_enabled"] is True

    client.post("/api/activity/page-view", json={"page": "/dashboard/contacts"}, headers=admin_headers)
    [row] = _rows(db_session)
    assert (row.kind, row.action, row.page) == ("page_view", "page_view", "/dashboard/contacts")

    _enable(client, superadmin_headers, org_id, on=False)
    client.post("/api/activity/page-view", json={"page": "/dashboard/apartments"}, headers=admin_headers)
    client.post("/api/areas", json={"area_name": "ג"}, headers=admin_headers)
    assert len(_rows(db_session)) == 1


def test_superadmin_actions_are_not_logged(client, db_session, admin_headers, superadmin_headers):
    org_id = _admin_org_id(client, admin_headers)
    _enable(client, superadmin_headers, org_id)
    # The toggle itself (an /api/admin call) leaves no row.
    assert _rows(db_session) == []


def test_only_superadmin_reads_the_log(client, db_session, admin_headers, superadmin_headers):
    org_id = _admin_org_id(client, admin_headers)
    _enable(client, superadmin_headers, org_id)
    client.post("/api/areas", json={"area_name": "א"}, headers=admin_headers)
    client.post("/api/activity/page-view", json={"page": "/dashboard"}, headers=admin_headers)

    assert client.get("/api/logs/activity", headers=admin_headers).status_code == 403
    assert client.get("/api/logs/activity/options", headers=admin_headers).status_code == 403

    body = client.get(f"/api/logs/activity?organization_id={org_id}", headers=superadmin_headers).json()
    assert body["total"] == 2
    assert [i["action"] for i in body["items"]] == ["page_view", "areas.create"]  # newest first
    assert body["items"][0]["user_name"] and body["items"][0]["organization_name"]

    only_actions = client.get("/api/logs/activity?kind=action", headers=superadmin_headers).json()
    assert [i["action"] for i in only_actions["items"]] == ["areas.create"]
    by_action = client.get("/api/logs/activity?action=page_view", headers=superadmin_headers).json()
    assert by_action["total"] == 1
    tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    assert client.get(f"/api/logs/activity?date_from={tomorrow}", headers=superadmin_headers).json()["total"] == 0

    opts = client.get(f"/api/logs/activity/options?organization_id={org_id}", headers=superadmin_headers).json()
    assert opts["actions"] == ["areas.create", "page_view"]
    assert len(opts["users"]) == 1


def test_purge_old_rows(db_session, admin_headers, client):
    from app.core import activity_log

    org_id = _admin_org_id(client, admin_headers)
    old = datetime.datetime.utcnow() - datetime.timedelta(days=91)
    db_session.add_all(
        [
            models.ActivityLog(organization_id=org_id, kind="action", action="a.create", created_at=old),
            models.ActivityLog(organization_id=org_id, kind="action", action="b.create"),
        ]
    )
    db_session.commit()
    assert activity_log.purge_old() == 1
    assert [r.action for r in _rows(db_session)] == ["b.create"]


def test_describe_route():
    from app.core.activity_log import describe, should_track

    assert describe("/api/apartments/{apartment_id}") == "apartments"
    assert describe("/api/apartments/bulk-update") == "apartments.bulk-update"
    assert describe("/api/users/{user_id}/shliach/restore-field") == "users.shliach.restore-field"
    assert should_track("POST", "/api/contacts")
    assert not should_track("GET", "/api/contacts")
    assert not should_track("POST", "/api/auth/token")
    assert not should_track("PUT", "/api/admin/organizations/1/prefs")


# --- Part A: a caught+logged error knows whose request it was -------------------
def test_logged_error_gets_the_requests_org(client, db_session, admin_headers, monkeypatch):
    from app.config import settings
    from app.core import activity_log, error_log

    monkeypatch.setattr(error_log, "capture_background_errors", True)
    monkeypatch.setattr(error_log, "_last_sent", {})
    monkeypatch.setattr(settings, "platform_admin_email", "")
    monkeypatch.setattr(settings, "superadmin_email", "")
    sent = []
    monkeypatch.setattr(error_log, "_send_all", lambda to, subject, body: sent.append(to))

    class _SyncThread:
        def __init__(self, target, args, daemon=None):
            self._t, self._a = target, args

        def start(self):
            self._t(*self._a)

    monkeypatch.setattr(error_log.threading, "Thread", _SyncThread)
    client.put("/api/logs/settings", json={"errors_admin_emails": ["org-dev@x.com"]}, headers=admin_headers)
    me = client.get("/api/auth/me", headers=admin_headers).json()

    token = activity_log.current_user_id.set(me["id"])
    try:
        try:
            raise ValueError("geocode down")
        except ValueError:
            logging.getLogger("app.core.geocode").exception("geocoding failed")
    finally:
        activity_log.current_user_id.reset(token)

    db_session.expire_all()
    [row] = db_session.query(models.ErrorLog).all()
    assert row.organization_id == me["organization_id"] and row.user_id == me["id"]
    assert sent == [["org-dev@x.com"]]
