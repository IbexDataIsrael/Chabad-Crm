"""Fixes10 acceptance tests: org-delete cascade completeness, assigned_user_id
GUID semantics + auto-assignment, and the shliach ownership/permission model."""
import datetime

import pytest

from app import models
from app.core.security import hash_password
from app.database import Base

_phone = [8000]


def _mk_contact(client, headers, **overrides):
    _phone[0] += 1
    payload = {"name": "מקורב עשר", "phone": f"050-88{_phone[0]:05d}"}
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=headers)


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


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


@pytest.fixture
def shliach_headers(client, db_session, admin_headers):
    """An active shliach login inside the admin's org."""
    org_id = _me(client, admin_headers)["organization_id"]
    # fixes18 §6: these tests exercise the fixes10 ownership-scoped contact
    # visibility, which now requires the org's opt-in (the default is off).
    db_session.query(models.Organization).filter(
        models.Organization.id == org_id
    ).update({"shliach_can_view_contacts": True})
    user = models.User(
        organization_id=org_id,
        username="shliach10",
        full_name="שליח עשר",
        email="shliach10@example.com",
        password_hash=hash_password("pw12345"),
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "shliach10", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _shliach_user(db_session):
    return (
        db_session.query(models.User)
        .filter(models.User.username == "shliach10")
        .one()
    )


# --- §1.1 org-delete cascade completeness -------------------------------------
def test_org_delete_purges_every_org_scoped_table(
    client, admin_headers, superadmin_headers, db_session
):
    org_id = _me(client, admin_headers)["organization_id"]

    # Populate every entity family via API where easy...
    area = client.post("/api/areas", json={"area_name": "א"}, headers=admin_headers).json()
    building = client.post(
        "/api/buildings",
        json={"area_id": area["id"], "building_address": "1 Cascade St"},
        headers=admin_headers,
    ).json()
    assert building["floors"], "default floors expected"
    client.post(
        "/api/apartments",
        json={"building_id": building["id"], "apartment_name": "A"},
        headers=admin_headers,
    )
    client.post("/api/admin-areas", json={"name": "אזור מנהל"}, headers=admin_headers)
    mekurav = _mk_contact(client, admin_headers).json()
    _phone[0] += 1
    client.post(
        "/api/contacts",
        json={
            "name": "שליח",
            "phone": f"050-88{_phone[0]:05d}",
            "contact_type": "shliach",
            "email": "cascade.sh@example.com",
            "shliach": {"area_ids": [area["id"]]},
        },
        headers=admin_headers,
    )
    visit = client.post(
        f"/api/contacts/{mekurav['id']}/visits",
        json={
            "visit_date": "2026-07-01T00:00:00",
            "notes": "ביקור",
            # fixes25: engagement data rides on the visit.
            "tefillin": True,
            "interactions": [{"category": "call", "note": "שיחה"}],
        },
        headers=admin_headers,
    ).json()
    # ...and directly for the fiddly rest (donation, custom value, dates).
    db_session.add(
        models.Donation(
            organization_id=org_id,
            contact_id=mekurav["id"],
            donation_date=datetime.datetime(2026, 7, 1),
            amount=180,
        )
    )
    cf_def = models.CustomFieldDefinition(
        organization_id=org_id, field_key="purge_field", hebrew_label="שדה"
    )
    db_session.add(cf_def)
    db_session.flush()
    db_session.add(
        models.CustomFieldValue(
            visit_id=visit["id"], definition_id=cf_def.id, checked=True
        )
    )
    sd = models.SignificantDate(
        organization_id=org_id,
        special_date=datetime.datetime(2026, 8, 1),
        special_date_title="יום הולדת",
    )
    db_session.add(sd)
    db_session.flush()
    mk_row = (
        db_session.query(models.ContactMekurav)
        .filter(models.ContactMekurav.contact_id == mekurav["id"])
        .one()
    )
    db_session.add(
        models.ContactMekuravSpecialDate(
            organization_id=org_id,
            contact_mekurav_id=mk_row.id,
            special_date_id=sd.id,
        )
    )
    db_session.add(
        models.SignificantDateReminder(
            organization_id=org_id, significant_date_id=sd.id, offset_minutes=60
        )
    )
    db_session.commit()

    r = client.delete(f"/api/admin/organizations/{org_id}", headers=superadmin_headers)
    assert r.status_code == 204, r.text

    # Every model carrying organization_id must have zero rows for this org —
    # a future table missed by the cascade fails here automatically.
    leftovers = []
    for mapper in Base.registry.mappers:
        model = mapper.class_
        if not hasattr(model, "organization_id"):
            continue
        count = (
            db_session.query(model)
            .filter(model.organization_id == org_id)
            .count()
        )
        if count:
            leftovers.append((model.__tablename__, count))
    assert leftovers == [], f"orphaned rows after org delete: {leftovers}"
    # The visit-scoped table without organization_id is empty too (only this
    # org created data in this test DB).
    assert db_session.query(models.CustomFieldValue).count() == 0


# --- §2 assigned_user_id GUID + auto-assignment --------------------------------
class TestAssignedUserGuid:
    def test_creator_auto_assigned(self, client, admin_headers):
        me = _me(client, admin_headers)
        r = _mk_contact(client, admin_headers)
        assert r.status_code == 201, r.text
        assert r.json()["assigned_user_id"] == me["guid"]

    def test_explicit_assignee_guid_honored(self, client, admin_headers, db_session):
        org_id = _me(client, admin_headers)["organization_id"]
        other = models.User(
            organization_id=org_id,
            username="staff10",
            full_name="צוות",
            password_hash=hash_password("pw12345"),
            role="staff",
            is_active=True,
            email_verified=True,
        )
        db_session.add(other)
        db_session.commit()
        r = _mk_contact(client, admin_headers, assigned_user_id=other.guid)
        assert r.status_code == 201, r.text
        assert r.json()["assigned_user_id"] == other.guid

    def test_invalid_assignee_guid_rejected(self, client, admin_headers):
        r = _mk_contact(client, admin_headers, assigned_user_id="not-a-real-guid")
        assert r.status_code == 400

    def test_user_delete_unassigns_by_guid(self, client, admin_headers, db_session):
        created = client.post(
            "/api/users",
            json={"full_name": "זמני", "email": "temp10@example.com", "role": "staff"},
            headers=admin_headers,
        ).json()
        contact = _mk_contact(
            client, admin_headers, assigned_user_id=created["guid"]
        ).json()
        assert (
            client.delete(f"/api/users/{created['id']}", headers=admin_headers).status_code
            == 204
        )
        detail = client.get(
            f"/api/contacts/{contact['id']}", headers=admin_headers
        ).json()
        assert detail["assigned_user_id"] is None


# --- §3 shliach ownership model -------------------------------------------------
class TestShliachOwnership:
    def test_forced_ownership_even_when_payload_lies(
        self, client, admin_headers, shliach_headers, db_session
    ):
        admin_guid = _me(client, admin_headers)["guid"]
        r = _mk_contact(client, shliach_headers, assigned_user_id=admin_guid)
        assert r.status_code == 201, r.text
        assert r.json()["assigned_user_id"] == _shliach_user(db_session).guid

    def test_sees_only_own_contacts(
        self, client, admin_headers, shliach_headers, db_session
    ):
        foreign = _mk_contact(client, admin_headers).json()  # admin-owned
        own = _mk_contact(client, shliach_headers).json()

        ids = [c["id"] for c in client.get("/api/contacts", headers=shliach_headers).json()]
        assert own["id"] in ids and foreign["id"] not in ids

        page = client.get("/api/contacts/list", headers=shliach_headers).json()
        page_ids = [c["id"] for c in page["items"]]
        assert own["id"] in page_ids and foreign["id"] not in page_ids
        assert page["total"] == 1

        assert (
            client.get(f"/api/contacts/{foreign['id']}", headers=shliach_headers).status_code
            == 404
        )
        assert (
            client.get(f"/api/contacts/{own['id']}", headers=shliach_headers).status_code
            == 200
        )

    def test_full_crud_on_own_contact_only(
        self, client, admin_headers, shliach_headers
    ):
        foreign = _mk_contact(client, admin_headers).json()
        own = _mk_contact(client, shliach_headers).json()

        # Update own — OK; foreign — 404.
        r = client.put(
            f"/api/contacts/{own['id']}", json={"name": "שם חדש"}, headers=shliach_headers
        )
        assert r.status_code == 200 and r.json()["name"] == "שם חדש"
        assert (
            client.put(
                f"/api/contacts/{foreign['id']}", json={"name": "פריצה"},
                headers=shliach_headers,
            ).status_code
            == 404
        )
        # Delete foreign — 404; own — 204.
        assert (
            client.delete(f"/api/contacts/{foreign['id']}", headers=shliach_headers).status_code
            == 404
        )
        assert (
            client.delete(f"/api/contacts/{own['id']}", headers=shliach_headers).status_code
            == 204
        )

    def test_cannot_reassign_ownership(self, client, admin_headers, shliach_headers, db_session):
        own = _mk_contact(client, shliach_headers).json()
        admin_guid = _me(client, admin_headers)["guid"]
        r = client.put(
            f"/api/contacts/{own['id']}",
            json={"assigned_user_id": admin_guid},
            headers=shliach_headers,
        )
        assert r.status_code == 200
        assert r.json()["assigned_user_id"] == _shliach_user(db_session).guid

    def test_admin_area_section_blocked(self, client, admin_headers, shliach_headers):
        aa = client.post(
            "/api/admin-areas", json={"name": "חסום"}, headers=admin_headers
        ).json()
        assert client.get("/api/admin-areas", headers=shliach_headers).status_code == 403
        assert (
            client.get(f"/api/admin-areas/{aa['id']}", headers=shliach_headers).status_code
            == 403
        )
        assert (
            client.post(
                "/api/admin-areas", json={"name": "x"}, headers=shliach_headers
            ).status_code
            == 403
        )

    def test_users_directory_blocked(self, client, shliach_headers):
        assert client.get("/api/users", headers=shliach_headers).status_code == 403

    def test_search_scoped_to_own_contacts(
        self, client, admin_headers, shliach_headers
    ):
        _mk_contact(client, admin_headers, name="מיוחד אדמין")
        _mk_contact(client, shliach_headers, name="מיוחד שליח")
        hits = client.get("/api/search?q=מיוחד", headers=shliach_headers).json()["results"]
        titles = [h["title"] for h in hits if h["type"] == "contact"]
        assert "מיוחד שליח" in titles and "מיוחד אדמין" not in titles
