"""Platform superadmin (/api/admin/*) — gating, org cascade delete, user actions."""
import pytest

from app import models
from app.core.security import hash_password


def _make_org(db, name, *, active=True):
    org = models.Organization(name=name, is_active=active)
    db.add(org)
    db.flush()
    return org


def _make_user(db, org_id, username, role, email=None):
    user = models.User(
        organization_id=org_id,
        username=username,
        full_name=username,
        email=email,
        password_hash=hash_password("pw12345"),
        role=role,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


@pytest.fixture
def superadmin_headers(client, db_session):
    org = _make_org(db_session, "System")
    _make_user(db_session, org.id, "superadmin", "superadmin", "root@system.local")
    db_session.commit()
    token = client.post(
        "/api/auth/token",
        data={"username": "superadmin", "password": "pw12345"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_admin_routes_require_superadmin(client, admin_headers):
    # A normal org admin is NOT a platform superadmin.
    assert client.get("/api/admin/organizations", headers=admin_headers).status_code == 403


def test_admin_routes_reject_anonymous(client):
    assert client.get("/api/admin/organizations").status_code == 401


def test_superadmin_lists_organizations(client, superadmin_headers, db_session):
    _make_org(db_session, "Tenant A")
    db_session.commit()
    resp = client.get("/api/admin/organizations", headers=superadmin_headers)
    assert resp.status_code == 200
    names = {o["name"] for o in resp.json()}
    assert {"System", "Tenant A"} <= names
    # fixes82: the UI explains a refused delete from these fields.
    by_name = {o["name"]: o for o in resp.json()}
    assert by_name["System"]["is_system"] is True
    assert by_name["System"]["superadmin_usernames"] == ["superadmin"]
    assert by_name["Tenant A"]["is_system"] is False
    assert by_name["Tenant A"]["superadmin_usernames"] == []


def test_delete_org_cascades_users_and_contacts(client, superadmin_headers, db_session):
    org = _make_org(db_session, "ToDelete")
    admin = _make_user(db_session, org.id, "orgadmin", "admin", "a@todelete.local")
    contact = models.Contact(
        organization_id=org.id,
        name="פלוני",
        last_name="אלמוני",
        phone="0521234567",
        contact_type="mekurav",
        assigned_user_id=admin.id,
    )
    db_session.add(contact)
    db_session.commit()
    org_id, contact_id, user_id = org.id, contact.id, admin.id

    resp = client.delete(f"/api/admin/organizations/{org_id}", headers=superadmin_headers)
    assert resp.status_code == 204

    # The API deleted in a separate session sharing the same in-memory DB;
    # expire our session's identity map so these reads hit the database.
    db_session.expire_all()
    assert db_session.get(models.Organization, org_id) is None
    assert db_session.get(models.Contact, contact_id) is None
    assert db_session.get(models.User, user_id) is None


def test_cannot_delete_system_org(client, superadmin_headers, db_session):
    system = db_session.query(models.Organization).filter_by(name="System").first()
    resp = client.delete(f"/api/admin/organizations/{system.id}", headers=superadmin_headers)
    assert resp.status_code == 400
    assert db_session.get(models.Organization, system.id) is not None


def test_deactivate_org_blocks_login(client, superadmin_headers, db_session):
    org = _make_org(db_session, "Disabled Co")
    _make_user(db_session, org.id, "tenantadmin", "admin", "t@disabled.local")
    db_session.commit()

    assert client.post(
        f"/api/admin/organizations/{org.id}/deactivate", headers=superadmin_headers
    ).status_code == 200

    # The org's admin can no longer log in.
    login = client.post(
        "/api/auth/token", data={"username": "tenantadmin", "password": "pw12345"}
    )
    assert login.status_code == 403


def test_verify_user(client, superadmin_headers, db_session):
    org = _make_org(db_session, "Pending Co")
    user = models.User(
        organization_id=org.id,
        username="pending",
        full_name="pending",
        email="p@pending.local",
        password_hash=hash_password("pw12345"),
        role="admin",
        is_active=False,
        email_verified=False,
    )
    db_session.add(user)
    db_session.commit()

    resp = client.post(f"/api/admin/users/{user.id}/verify", headers=superadmin_headers)
    assert resp.status_code == 200
    db_session.refresh(user)
    assert user.email_verified is True and user.is_active is True


def test_cannot_delete_superadmin_user(client, superadmin_headers, db_session):
    sa = db_session.query(models.User).filter_by(role="superadmin").first()
    resp = client.delete(f"/api/admin/users/{sa.id}", headers=superadmin_headers)
    assert resp.status_code == 400


def test_superadmin_creates_org_with_working_admin(client, superadmin_headers):
    resp = client.post(
        "/api/admin/organizations",
        headers=superadmin_headers,
        json={
            "organization_name": "Brand New",
            "admin_email": "newadmin@brand.new",
            "admin_full_name": "New Admin",
            "admin_username": "newadmin",
            "admin_password": "pw12345",
        },
    )
    assert resp.status_code == 201
    # The provisioned admin is active + verified → can log in immediately.
    login = client.post(
        "/api/auth/token", data={"username": "newadmin", "password": "pw12345"}
    )
    assert login.status_code == 200


def test_signup_then_approve_enables_login(client, superadmin_headers, db_session):
    """Full flow: signup → pending (login blocked) → superadmin approve → login works."""
    resp = client.post(
        "/api/auth/signup",
        json={
            "organization_name": "Self Serve",
            "first_name": "Self",
            "last_name": "Serve",
            "email": "self@serve.co",
            "phone": "0521234567",
            "username": "selfadmin",
            "password": "pw12345",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "pending_approval"

    # Blocked while pending.
    assert client.post(
        "/api/auth/token", data={"username": "selfadmin", "password": "pw12345"}
    ).status_code == 403

    org = db_session.query(models.Organization).filter_by(name="Self Serve").first()
    ap = client.post(
        f"/api/admin/organizations/{org.id}/approve", headers=superadmin_headers
    )
    assert ap.status_code == 200
    assert ap.json()["approval_status"] == "approved"

    # Login works after approval.
    assert client.post(
        "/api/auth/token", data={"username": "selfadmin", "password": "pw12345"}
    ).status_code == 200


def test_email_templates_list_and_update(client, superadmin_headers):
    lst = client.get("/api/admin/email-templates", headers=superadmin_headers)
    assert lst.status_code == 200
    keys = {t["key"] for t in lst.json()}
    assert {"aignummail1", "aignummail2"} <= keys

    upd = client.put(
        "/api/admin/email-templates/aignummail1",
        headers=superadmin_headers,
        json={"body_hebrew": "טקסט חדש", "body": "new text"},
    )
    assert upd.status_code == 200
    assert upd.json()["body_hebrew"] == "טקסט חדש"

    # Unknown template key → 404.
    assert client.put(
        "/api/admin/email-templates/nope", headers=superadmin_headers, json={"body": "x"}
    ).status_code == 404


def test_email_templates_require_superadmin(client, admin_headers):
    assert client.get("/api/admin/email-templates", headers=admin_headers).status_code == 403


def test_pending_signup_notify_emails(client, superadmin_headers, admin_headers, monkeypatch):
    """fixes81 §3 / fixes100: superadmin-configured recipients of the new-org
    pending-approval email. Once set, the list replaces the env addresses."""
    from app.config import settings

    url = "/api/admin/pending-signup-emails"
    assert client.get(url, headers=admin_headers).status_code == 403
    assert client.get(url, headers=superadmin_headers).json() == {"emails": []}
    r = client.put(url, json={"emails": ["not-an-email"]}, headers=superadmin_headers)
    assert r.status_code == 422
    r = client.put(
        url,
        json={"emails": ["A@x.com", "b@x.com", "a@x.com", " "]},
        headers=superadmin_headers,
    )
    assert r.status_code == 200 and r.json() == {"emails": ["a@x.com", "b@x.com"]}
    assert client.get(url, headers=superadmin_headers).json() == {"emails": ["a@x.com", "b@x.com"]}
    # Not leaked through the public title config.
    assert "emails" not in client.get("/api/metadata/system-config").json()

    monkeypatch.setattr(settings, "platform_admin_email", "ops@x.com")
    monkeypatch.setattr(settings, "superadmin_email", "b@x.com")
    sent = []
    monkeypatch.setattr(
        "app.core.email.send_email",
        lambda to, subject, body, **kw: sent.append(to),
    )
    r = client.post(
        "/api/auth/signup",
        json={
            "organization_name": "Notify Org",
            "first_name": "א",
            "last_name": "ב",
            "email": "owner@x.com",
            "phone": "050-1234567",
            "username": "owner1",
            "password": "pw12345",
        },
    )
    assert r.status_code == 201, r.text
    assert sorted(to for to in sent if to != "owner@x.com") == ["a@x.com", "b@x.com"]


# --- fixes100: superadmin-managed error-alert recipients ----------------------
def test_error_notify_emails_setting(client, superadmin_headers, admin_headers):
    url = "/api/admin/error-notify-emails"
    assert client.get(url, headers=admin_headers).status_code == 403
    assert client.get(url, headers=superadmin_headers).json() == {"emails": []}
    assert client.put(url, json={"emails": ["bad"]}, headers=superadmin_headers).status_code == 422
    r = client.put(url, json={"emails": ["Dev@x.com", "dev@x.com", "qa@x.com"]}, headers=superadmin_headers)
    assert r.status_code == 200 and r.json() == {"emails": ["dev@x.com", "qa@x.com"]}
    # Independent of the new-organization list.
    assert client.get("/api/admin/pending-signup-emails", headers=superadmin_headers).json() == {"emails": []}


def test_error_recipients_combine_org_and_platform_lists(db_session, monkeypatch):
    from app.config import settings
    from app.core.email import ERROR_NOTIFY_EMAILS_KEY, set_notify_emails
    from app.core.error_log import recipients_for

    monkeypatch.setattr(settings, "platform_admin_email", "ops@x.com")
    monkeypatch.setattr(settings, "superadmin_email", "Super@x.com")
    org = _make_org(db_session, "Err Org")
    org.errors_admin_emails = ["orgdev@x.com", "ops@x.com"]
    db_session.commit()

    # Empty platform list -> env addresses stand in.
    assert recipients_for(db_session, None) == ["ops@x.com", "super@x.com"]
    assert recipients_for(db_session, org) == ["orgdev@x.com", "ops@x.com", "super@x.com"]

    # Configured list replaces the env addresses, for every error.
    set_notify_emails(db_session, ERROR_NOTIFY_EMAILS_KEY, ["dev@x.com", "orgdev@x.com"])
    db_session.commit()
    assert recipients_for(db_session, None) == ["dev@x.com", "orgdev@x.com"]
    assert recipients_for(db_session, org) == ["orgdev@x.com", "ops@x.com", "dev@x.com"]


# --- fixes91: Cloudinary images go with a deleted org ------------------------
def _cloud(monkeypatch, enabled=True):
    from app.config import settings

    monkeypatch.setattr(settings, "cloudinary_cloud_name", "testcloud")
    monkeypatch.setattr(settings, "cloudinary_api_key", "k")
    monkeypatch.setattr(settings, "cloudinary_api_secret", "s")
    monkeypatch.setattr(settings, "cloudinary_delete_on_org_delete", enabled)
    calls = []

    class _Resp:
        ok = True
        status_code = 200
        text = ""

        def __init__(self, ids):
            self._ids = ids

        def json(self):
            return {"deleted": {i: "deleted" for i in self._ids}}

    def fake_delete(url, params=None, auth=None, timeout=None):
        ids = [v for k, v in params if k == "public_ids[]"]
        calls.append(ids)
        return _Resp(ids)

    monkeypatch.setattr("app.core.cloudinary_assets.requests.delete", fake_delete)
    return calls


def _org_with_images(db_session, name, logo):
    base = "https://res.cloudinary.com/testcloud/image/upload"
    org = _make_org(db_session, name)
    org.logo_url = logo
    org.public_gallery = [f"{base}/v1/orgs/{org.id}/gallery/g1.jpg"]
    db_session.add(models.ShliachAnnouncement(
        organization_id=org.id, message_title="t",
        message_content=f'<p>hi</p><img src="{base}/v2/orgs/{org.id}/announcements/a1.png">',
    ))
    db_session.commit()
    return org


def test_delete_org_removes_its_cloudinary_images_but_not_shared_ones(
    client, superadmin_headers, db_session, monkeypatch
):
    calls = _cloud(monkeypatch)
    shared_logo = "https://res.cloudinary.com/testcloud/image/upload/v9/org_logos/shared"
    victim = _org_with_images(db_session, "Victim", shared_logo)
    keeper = _make_org(db_session, "Keeper (a clone)")
    keeper.logo_url = shared_logo  # clones reuse the source's logo
    db_session.commit()

    r = client.delete(f"/api/admin/organizations/{victim.id}", headers=superadmin_headers)
    assert r.status_code == 204, r.text
    deleted = sorted(i for batch in calls for i in batch)
    assert deleted == [
        f"orgs/{victim.id}/announcements/a1",
        f"orgs/{victim.id}/gallery/g1",
    ]  # the shared logo is kept


def test_delete_org_leaves_cloudinary_alone_when_disabled(
    client, superadmin_headers, db_session, monkeypatch
):
    calls = _cloud(monkeypatch, enabled=False)
    org = _org_with_images(
        db_session, "Local Org", "https://res.cloudinary.com/testcloud/image/upload/v1/org_logos/x"
    )
    r = client.delete(f"/api/admin/organizations/{org.id}", headers=superadmin_headers)
    assert r.status_code == 204
    assert calls == []


def test_localization_page_off_by_default_superadmin_can_enable(
    client, superadmin_headers, admin_headers
):
    """fixes93: the translations page is hidden unless the superadmin turns
    it on for the org (the one feature toggle that defaults OFF)."""
    me = client.get("/api/auth/me", headers=admin_headers).json()
    assert me["organization"]["feature_flags"]["localization_page_enabled"] is False
    org_id = me["organization_id"]
    r = client.put(
        f"/api/admin/organizations/{org_id}/prefs",
        json={"localization_page_enabled": True},
        headers=superadmin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["effective"]["localization_page_enabled"] is True
    me = client.get("/api/auth/me", headers=admin_headers).json()
    assert me["organization"]["feature_flags"]["localization_page_enabled"] is True
    # Other toggles keep their default (on).
    assert me["organization"]["feature_flags"]["ai_query_enabled"] is True
