"""Fixes17 acceptance tests: per-user DB preferences, mitzvot/tzedaka contact
filters, the apartment alphabetical-sort fix + created sort + title separator,
org-branded outbound email, the tenant_verification template, and the shliach
own-contacts visibility regression."""
import datetime

import pytest

from app import models
from app.core.security import hash_password


# --- Builders ------------------------------------------------------------------
def _mk_area(client, headers, name="שכונה"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="9 Sort St, City"):
    r = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_address": address, "floors": ["1"]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_apartment(client, headers, building_id, **kw):
    r = client.post(
        "/api/apartments", json={"building_id": building_id, **kw}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(1000, 9999))


def _mk_contact(client, headers, name="פלוני", **overrides):
    payload = {
        "name": name,
        "phone": f"0527{next(_seq):06d}",
        "contact_type": "mekurav",
        **overrides,
    }
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _list(client, headers, qs=""):
    r = client.get(f"/api/contacts/list{qs}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --- §1.1 user preferences -------------------------------------------------------
class TestPreferences:
    def test_roundtrip(self, client, admin_headers):
        r = client.put(
            "/api/preferences",
            json={"key": "contacts.columns", "value": ["phone", "area"]},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["contacts.columns"] == ["phone", "area"]
        r = client.get("/api/preferences", headers=admin_headers)
        assert r.json() == {"contacts.columns": ["phone", "area"]}

    def test_overwrite_and_scalar_values(self, client, admin_headers):
        client.put(
            "/api/preferences", json={"key": "locale", "value": "en"},
            headers=admin_headers,
        )
        r = client.put(
            "/api/preferences", json={"key": "locale", "value": "he"},
            headers=admin_headers,
        )
        assert r.json()["locale"] == "he"

    def test_isolated_per_user(self, client, admin_headers, auth_headers):
        client.put(
            "/api/preferences", json={"key": "locale", "value": "en"},
            headers=admin_headers,
        )
        assert client.get("/api/preferences", headers=auth_headers).json() == {}

    def test_requires_auth_and_valid_key(self, client, admin_headers):
        assert client.get("/api/preferences").status_code == 401
        r = client.put(
            "/api/preferences", json={"key": "  ", "value": 1}, headers=admin_headers
        )
        assert r.status_code == 400


# --- §2.2 mitzvot + tzedaka filters ------------------------------------------------
class TestContactFilters17:
    def test_mitzvot_and_semantics(self, client, admin_headers):
        c1 = _mk_contact(client, admin_headers, name="שתיים")
        c2 = _mk_contact(client, admin_headers, name="אחת")
        # fixes25: flags live on visits — c1 even splits them across two visits
        # (AND semantics hold across the contact's whole visit history).
        client.post(
            f"/api/contacts/{c1['id']}/visits",
            json={"visit_date": "2026-07-01T00:00:00", "tefillin": True},
            headers=admin_headers,
        )
        client.post(
            f"/api/contacts/{c1['id']}/visits",
            json={"visit_date": "2026-07-02T00:00:00", "tzedakah": True},
            headers=admin_headers,
        )
        client.post(
            f"/api/contacts/{c2['id']}/visits",
            json={"visit_date": "2026-07-01T00:00:00", "tzedakah": True},
            headers=admin_headers,
        )
        both = _list(client, admin_headers, "?mitzvot=tzedakah")
        assert {c["id"] for c in both["items"]} == {c1["id"], c2["id"]}
        only_both = _list(
            client, admin_headers, "?mitzvot=tzedakah&mitzvot=tefillin"
        )
        assert [c["id"] for c in only_both["items"]] == [c1["id"]]

    def test_invalid_mitzvah_rejected(self, client, admin_headers):
        r = client.get(
            "/api/contacts/list?mitzvot=not_a_field", headers=admin_headers
        )
        assert r.status_code == 422

    def test_tzedaka_potential_filter(self, client, admin_headers):
        c = _mk_contact(
            client, admin_headers, name="נדבן",
            mekurav={"tzedaka_potential": "גבוה מאוד"},
        )
        _mk_contact(client, admin_headers, name="רגיל")
        got = _list(client, admin_headers, "?tzedaka_potential=גבוה מאוד")
        assert [x["id"] for x in got["items"]] == [c["id"]]
        # fixes18 §3.2: the filter is an exact match (dropdown values) — a
        # substring no longer matches.
        assert _list(client, admin_headers, "?tzedaka_potential=גבוה")["total"] == 0
        assert _list(client, admin_headers, "?tzedaka_potential=נמוך")["total"] == 0

    def test_emails_respect_new_filters(self, client, admin_headers):
        c = _mk_contact(client, admin_headers, name="עם", email="with@x.com")
        _mk_contact(client, admin_headers, name="בלי", email="without@x.com")
        client.post(
            f"/api/contacts/{c['id']}/visits",
            json={"visit_date": "2026-07-01T00:00:00", "letter_in_torah": True},
            headers=admin_headers,
        )
        r = client.get(
            "/api/contacts/emails?mitzvot=letter_in_torah", headers=admin_headers
        )
        assert r.json() == ["with@x.com"]


# --- §3 apartment sorting + title ---------------------------------------------------
class TestApartmentSorting17:
    def test_alphabetical_labels_sort_alphabetically(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        for label in ("Bet", "Aleph", "10", "2"):
            _mk_apartment(
                client, admin_headers, b["id"], apartment_name=label, floor="1"
            )
        r = client.get("/api/apartments/list?sort=label", headers=admin_headers)
        labels = [a["apartment_name"] for a in r.json()["items"]]
        # Alphabetic labels alphabetically, numeric labels naturally after.
        assert labels == ["Aleph", "Bet", "2", "10"]
        r = client.get(
            "/api/apartments/list?sort=label&dir=desc", headers=admin_headers
        )
        assert [a["apartment_name"] for a in r.json()["items"]] == [
            "10", "2", "Bet", "Aleph",
        ]

    def test_sort_by_created(self, client, admin_headers, db_session):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        old = _mk_apartment(client, admin_headers, b["id"], apartment_name="ישן")
        new = _mk_apartment(client, admin_headers, b["id"], apartment_name="חדש")
        # Deterministic timestamps (same-second inserts otherwise tie).
        db_session.query(models.Apartment).filter(
            models.Apartment.id == old["id"]
        ).update({"created_at": datetime.datetime(2026, 1, 1)})
        db_session.query(models.Apartment).filter(
            models.Apartment.id == new["id"]
        ).update({"created_at": datetime.datetime(2026, 6, 1)})
        db_session.commit()
        r = client.get("/api/apartments/list?sort=created", headers=admin_headers)
        assert [a["id"] for a in r.json()["items"]] == [old["id"], new["id"]]
        r = client.get(
            "/api/apartments/list?sort=created&dir=desc", headers=admin_headers
        )
        assert [a["id"] for a in r.json()["items"]] == [new["id"], old["id"]]

    def test_title_separator_in_search(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], address="5 Hyphen St, X")
        _mk_apartment(
            client, admin_headers, b["id"],
            apartment_name="A", floor="1", name="משפחת לוי",
        )
        hits = client.get("/api/search?q=לוי", headers=admin_headers).json()["results"]
        apt = [h for h in hits if h["type"] == "apartment"]
        # fixes21 §2: the title concatenates "[number][floor]" (no separator).
        assert apt and apt[0]["title"] == "A1"


# --- §1.3 org-branded email + tenant_verification template ---------------------------
@pytest.fixture
def superadmin_headers(client, db_session):
    org = models.Organization(name="System17", is_active=True)
    db_session.add(org)
    db_session.flush()
    db_session.add(
        models.User(
            organization_id=org.id,
            username="root17",
            full_name="root17",
            email="root17@system.local",
            password_hash=hash_password("pw12345"),
            role="superadmin",
            is_active=True,
            email_verified=True,
        )
    )
    db_session.commit()
    token = client.post(
        "/api/auth/token",
        data={"username": "root17", "password": "pw12345"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestEmailBranding:
    def test_welcome_sent_in_org_name(self, client, admin_headers, monkeypatch):
        sent = {}

        def fake_send(to, subject, body, html=None, from_name=None, reply_to=None):
            sent.update(to=to, from_name=from_name, reply_to=reply_to)

        monkeypatch.setattr("app.core.email.send_email", fake_send)
        _mk_contact(
            client, admin_headers, name="ממותג",
            contact_type="shliach", email="branded@x.com",
        )
        org_name = client.get("/api/organizations/me", headers=admin_headers).json()[
            "name"
        ]
        assert sent["to"] == "branded@x.com"
        assert sent["from_name"] == org_name  # fixes17 §1.3

    def test_tenant_verification_template_seeded(self, client, superadmin_headers):
        r = client.get("/api/admin/email-templates", headers=superadmin_headers)
        by_key = {tpl["key"]: tpl for tpl in r.json()}
        assert "tenant_verification" in by_key
        assert "{{verify_url}}" in by_key["tenant_verification"]["body"]

    def test_verification_email_uses_db_template(
        self, client, admin_headers, db_session, monkeypatch
    ):
        from app.core.email import send_verification_email

        sent = {}

        def fake_send(to, subject, body, html=None, from_name=None, reply_to=None):
            sent.update(to=to, subject=subject, html=html)

        monkeypatch.setattr("app.core.email.send_email", fake_send)
        user = db_session.query(models.User).filter_by(username="boss").one()
        user.email = "boss@x.com"
        db_session.commit()
        link = send_verification_email(db_session, user, "tok123")
        assert "token=tok123" in link
        assert sent["to"] == "boss@x.com"
        # The seeded hello_tenant HTML with every placeholder substituted.
        assert "token=tok123" in sent["html"]
        assert "{{" not in sent["html"]


# --- §5 shliach sees own contacts (regression) ---------------------------------------
class TestShliachOwnContacts:
    def test_created_contact_visible_to_creator(self, client, admin_headers, db_session):
        # fixes18 §6: own-contact visibility now requires the org's opt-in.
        org_id = client.get("/api/auth/me", headers=admin_headers).json()[
            "organization_id"
        ]
        db_session.query(models.Organization).filter(
            models.Organization.id == org_id
        ).update({"shliach_can_view_contacts": True})
        db_session.commit()
        _mk_contact(
            client, admin_headers, name="פעיל", last_name="רואה",
            contact_type="shliach", email="sees@x.com",
            shliach={"password": "pw12345"},
        )
        token_res = client.post(
            "/api/auth/token",
            data={"username": "sees@x.com", "password": "pw12345"},
        )
        assert token_res.status_code == 200, token_res.text
        sh_headers = {
            "Authorization": f"Bearer {token_res.json()['access_token']}"
        }
        created = client.post(
            "/api/contacts",
            json={
                "name": "מקורב שלי",
                "phone": "0521230001",
                "contact_type": "mekurav",
            },
            headers=sh_headers,
        )
        assert created.status_code == 201, created.text
        cid = created.json()["id"]

        page = client.get(
            "/api/contacts/list?contact_type=mekurav", headers=sh_headers
        ).json()
        assert cid in [c["id"] for c in page["items"]]
        plain = client.get("/api/contacts", headers=sh_headers).json()
        assert cid in [c["id"] for c in plain]
