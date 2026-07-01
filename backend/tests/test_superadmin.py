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


def test_signup_logs_in_immediately_without_email(client):
    """Default flow: no email verification — signup returns a token and works."""
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
    body = resp.json()
    assert body["status"] == "active"
    assert body["access_token"]
    login = client.post(
        "/api/auth/token", data={"username": "selfadmin", "password": "pw12345"}
    )
    assert login.status_code == 200
