"""Fixes9 acceptance tests: system title configuration, admin_areas entity
CRUD + tenancy, and the new mekurav fields (admin_area_id, tzedaka_potential)."""
import pytest

from app import models
from app.core.security import hash_password

_phone_counter = [7000]


def _make_contact(client, headers, **overrides):
    _phone_counter[0] += 1
    payload = {"name": "מקורב בדיקה", "phone": f"050-000{_phone_counter[0]:04d}"}
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=headers)


def _mk_admin_area(client, headers, name="אזור מנהל א", **kw):
    r = client.post(
        "/api/admin-areas", json={"name": name, **kw}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def superadmin_headers(client, db_session):
    org = models.Organization(name="System")
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
        "/api/auth/token",
        data={"username": "superadmin", "password": "pw12345"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- §1 system title configuration --------------------------------------------
class TestSystemTitleConfig:
    def test_public_endpoint_returns_defaults(self, client):
        r = client.get("/api/metadata/system-config")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title_template"] == "{public.organizations.name}"
        assert body["fallback_name"] == "Jewish Points CRM"

    def test_superadmin_updates_config(self, client, superadmin_headers):
        r = client.put(
            "/api/admin/system-settings",
            json={"title_template": "{public.organizations.name} — פורטל", "fallback_name": "ברירת מחדל"},
            headers=superadmin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["title_template"] == "{public.organizations.name} — פורטל"
        # The public endpoint reflects the change.
        pub = client.get("/api/metadata/system-config").json()
        assert pub["title_template"] == "{public.organizations.name} — פורטל"
        assert pub["fallback_name"] == "ברירת מחדל"
        # Partial update touches only the provided field.
        client.put(
            "/api/admin/system-settings",
            json={"fallback_name": "שם אחר"},
            headers=superadmin_headers,
        )
        pub = client.get("/api/metadata/system-config").json()
        assert pub["title_template"] == "{public.organizations.name} — פורטל"
        assert pub["fallback_name"] == "שם אחר"

    def test_org_admin_cannot_update_config(self, client, admin_headers):
        r = client.put(
            "/api/admin/system-settings",
            json={"fallback_name": "פריצה"},
            headers=admin_headers,
        )
        assert r.status_code == 403
        assert client.get("/api/admin/system-settings", headers=admin_headers).status_code == 403


# --- §2 admin_areas CRUD --------------------------------------------------------
class TestAdminAreasCrud:
    def test_crud_roundtrip(self, client, admin_headers):
        aa = _mk_admin_area(client, admin_headers, comments="הערה")
        assert aa["name"] == "אזור מנהל א" and aa["comments"] == "הערה"

        listed = client.get("/api/admin-areas", headers=admin_headers).json()
        assert [x["id"] for x in listed] == [aa["id"]]

        r = client.put(
            f"/api/admin-areas/{aa['id']}",
            json={"name": "אזור מנהל ב", "comments": None},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "אזור מנהל ב"
        assert r.json()["comments"] is None

        assert (
            client.delete(f"/api/admin-areas/{aa['id']}", headers=admin_headers).status_code
            == 204
        )
        assert client.get("/api/admin-areas", headers=admin_headers).json() == []

    def test_name_required(self, client, admin_headers):
        r = client.post("/api/admin-areas", json={"name": "  "}, headers=admin_headers)
        assert r.status_code == 422
        aa = _mk_admin_area(client, admin_headers)
        r = client.put(
            f"/api/admin-areas/{aa['id']}", json={"name": ""}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_staff_can_read_but_not_mutate(self, client, admin_headers, auth_headers):
        # auth_headers is a staff user (in its own org): reads allowed, writes 403.
        assert client.get("/api/admin-areas", headers=auth_headers).status_code == 200
        r = client.post("/api/admin-areas", json={"name": "x"}, headers=auth_headers)
        assert r.status_code == 403

    def test_cross_org_isolation(self, client, admin_headers):
        aa = _mk_admin_area(client, admin_headers)
        # A second org's admin can't see or touch it.
        client.post(
            "/api/auth/register",
            json={"username": "boss2", "full_name": "מנהל שני", "password": "pw12345", "role": "admin"},
        )
        token = client.post(
            "/api/auth/token", data={"username": "boss2", "password": "pw12345"}
        ).json()["access_token"]
        other = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/admin-areas", headers=other).json() == []
        assert client.get(f"/api/admin-areas/{aa['id']}", headers=other).status_code == 404
        assert (
            client.put(
                f"/api/admin-areas/{aa['id']}", json={"name": "y"}, headers=other
            ).status_code
            == 404
        )
        assert (
            client.delete(f"/api/admin-areas/{aa['id']}", headers=other).status_code == 404
        )


# --- §2C + §3 mekurav integration ------------------------------------------------
class TestMekuravFields:
    def test_create_and_update_with_new_fields(self, client, admin_headers):
        aa = _mk_admin_area(client, admin_headers)
        r = _make_contact(
            client,
            admin_headers,
            mekurav={"admin_area_id": aa["id"], "tzedaka_potential": "גבוה מאוד"},
        )
        assert r.status_code == 201, r.text
        detail = r.json()
        assert detail["mekurav"]["admin_area_id"] == aa["id"]
        assert detail["mekurav"]["tzedaka_potential"] == "גבוה מאוד"

        # Update both fields through the contact PUT path.
        aa2 = _mk_admin_area(client, admin_headers, name="אזור מנהל ב")
        r = client.put(
            f"/api/contacts/{detail['id']}",
            json={"mekurav": {"admin_area_id": aa2["id"], "tzedaka_potential": "בינוני"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["mekurav"]["admin_area_id"] == aa2["id"]
        assert r.json()["mekurav"]["tzedaka_potential"] == "בינוני"

    def test_foreign_admin_area_rejected(self, client, admin_headers):
        # Nonexistent id → 400 on create.
        r = _make_contact(client, admin_headers, mekurav={"admin_area_id": 99999})
        assert r.status_code == 400
        # A valid contact can't be updated to another org's admin area either.
        ok = _make_contact(client, admin_headers, mekurav={})
        assert ok.status_code == 201
        r = client.put(
            f"/api/contacts/{ok.json()['id']}",
            json={"mekurav": {"admin_area_id": 99999}},
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_delete_admin_area_detaches_contacts(self, client, admin_headers):
        aa = _mk_admin_area(client, admin_headers)
        contact = _make_contact(
            client, admin_headers, mekurav={"admin_area_id": aa["id"]}
        ).json()
        assert (
            client.delete(f"/api/admin-areas/{aa['id']}", headers=admin_headers).status_code
            == 204
        )
        detail = client.get(
            f"/api/contacts/{contact['id']}", headers=admin_headers
        ).json()
        assert detail["mekurav"]["admin_area_id"] is None
