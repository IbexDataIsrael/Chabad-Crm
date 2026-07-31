"""Fixes15 acceptance tests: contacts advanced filters (q / geo / mitzvot),
bulk-email address list, buildings sorting + multi-area filter, apartments
multi-area + per-shliach filters, superadmin user-dependency report, and the
DB-templated shliach welcome email."""
import pytest

from app import models
from app.core.security import hash_password


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה א"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="770 Eastern Pkwy, Brooklyn"):
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
        "phone": f"0529{next(_seq):06d}",
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


# --- §5.1 contacts text search ------------------------------------------------
class TestContactSearch:
    def test_q_matches_name_phone_email(self, client, admin_headers):
        a = _mk_contact(client, admin_headers, name="אברהם", email="avi@x.com")
        b = _mk_contact(client, admin_headers, name="יצחק", phone="0521111222")
        _mk_contact(client, admin_headers, name="יעקב")

        by_name = _list(client, admin_headers, "?q=אברה")
        assert [c["id"] for c in by_name["items"]] == [a["id"]]

        by_phone = _list(client, admin_headers, "?q=1111")
        assert [c["id"] for c in by_phone["items"]] == [b["id"]]

        by_email = _list(client, admin_headers, "?q=avi@")
        assert [c["id"] for c in by_email["items"]] == [a["id"]]

    def test_q_matches_last_name(self, client, admin_headers):
        c = _mk_contact(client, admin_headers, name="משה", last_name="כהנוביץ")
        got = _list(client, admin_headers, "?q=כהנוב")
        assert [x["id"] for x in got["items"]] == [c["id"]]


# --- §5.1 geographic filters + list enrichment ---------------------------------
class TestContactGeoFilters:
    def _setup_geo(self, client, headers):
        area1 = _mk_area(client, headers, "אזור 1")
        area2 = _mk_area(client, headers, "אזור 2")
        b1 = _mk_building(client, headers, area1["id"], "10 First St, City")
        b2 = _mk_building(client, headers, area2["id"], "20 Second St, City")
        ap1 = _mk_apartment(client, headers, b1["id"], apartment_name="1")
        ap2 = _mk_apartment(client, headers, b2["id"], apartment_name="2")
        c1 = _mk_contact(
            client, headers, name="ראשון", mekurav={"apartment_id": ap1["id"]}
        )
        c2 = _mk_contact(
            client, headers, name="שני", mekurav={"apartment_id": ap2["id"]}
        )
        c3 = _mk_contact(client, headers, name="שלישי")  # no apartment
        return area1, area2, b1, b2, c1, c2, c3

    def test_filter_by_area_ids(self, client, admin_headers):
        area1, area2, _, _, c1, c2, _ = self._setup_geo(client, admin_headers)
        got = _list(client, admin_headers, f"?area_ids={area1['id']}")
        assert [c["id"] for c in got["items"]] == [c1["id"]]
        both = _list(
            client, admin_headers, f"?area_ids={area1['id']}&area_ids={area2['id']}"
        )
        assert {c["id"] for c in both["items"]} == {c1["id"], c2["id"]}

    def test_filter_by_building_ids(self, client, admin_headers):
        _, _, b1, _, c1, _, _ = self._setup_geo(client, admin_headers)
        got = _list(client, admin_headers, f"?building_ids={b1['id']}")
        assert [c["id"] for c in got["items"]] == [c1["id"]]

    def test_list_items_carry_area_and_building_names(self, client, admin_headers):
        area1, _, _, _, c1, _, c3 = self._setup_geo(client, admin_headers)
        got = _list(client, admin_headers, "?sort=name")
        by_id = {c["id"]: c for c in got["items"]}
        assert by_id[c1["id"]]["area_name"] == area1["area_name"]
        assert by_id[c1["id"]]["building_name"] == "10 First St"
        assert by_id[c3["id"]]["area_name"] is None

    def test_shliach_contacts_filter_by_coverage(self, client, admin_headers):
        area1 = _mk_area(client, admin_headers, "אזור פעילים")
        area2 = _mk_area(client, admin_headers, "אזור אחר")
        b1 = _mk_building(client, admin_headers, area1["id"], "30 Third St, City")
        ap = _mk_apartment(client, admin_headers, b1["id"], apartment_name="3")
        sh1 = _mk_contact(
            client,
            admin_headers,
            name="פעיל א",
            contact_type="shliach",
            email="sh1@x.com",
            shliach={"area_ids": [area1["id"]]},
        )
        _mk_contact(
            client,
            admin_headers,
            name="פעיל ב",
            contact_type="shliach",
            email="sh2@x.com",
            shliach={"area_ids": [area2["id"]]},
        )
        by_area = _list(
            client, admin_headers, f"?contact_type=shliach&area_ids={area1['id']}"
        )
        assert [c["id"] for c in by_area["items"]] == [sh1["id"]]
        # fixes19: a building filter matches shluchim covering the building's
        # area (the apartment-coverage bridge is gone).
        by_building = _list(
            client, admin_headers, f"?contact_type=shliach&building_ids={b1['id']}"
        )
        assert [c["id"] for c in by_building["items"]] == [sh1["id"]]


# --- §5.1 mitzvot filter --------------------------------------------------------
class TestMitzvotFilter:
    def test_has_mitzvot_keeps_only_checked_contacts(self, client, admin_headers, db_session):
        from app.seed import seed_visit_mivtzoim_custom_fields

        c1 = _mk_contact(client, admin_headers, name="עם מצווה")
        _mk_contact(client, admin_headers, name="בלי מצווה")
        # fixes39: the Mivtzoim flags are boolean custom fields now.
        org_id = (
            db_session.query(models.Contact.organization_id)
            .filter(models.Contact.id == c1["id"])
            .scalar()
        )
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        tzedakah_def = (
            db_session.query(models.CustomFieldDefinition)
            .filter_by(organization_id=org_id, entity_type="visit", field_key="tzedakah")
            .one()
        )
        r = client.post(
            f"/api/contacts/{c1['id']}/visits",
            json={"visit_date": "2026-07-01T00:00:00"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        visit_id = r.json()["id"]
        flip = client.put(
            f"/api/visits/{visit_id}/custom-fields",
            json=[{"definition_id": tzedakah_def.id, "checked": True, "note": None}],
            headers=admin_headers,
        )
        assert flip.status_code == 200, flip.text
        got = _list(client, admin_headers, "?has_mitzvot=true")
        assert [c["id"] for c in got["items"]] == [c1["id"]]
        # Without the flag both come back.
        assert _list(client, admin_headers)["total"] == 2


# --- §5.2 bulk email address list ----------------------------------------------
class TestContactEmails:
    def test_emails_deduped_and_filtered(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="א", email="dup@x.com")
        _mk_contact(client, admin_headers, name="ב", email="DUP@x.com")
        _mk_contact(client, admin_headers, name="ג", email="only@y.com")
        _mk_contact(client, admin_headers, name="ד")  # no email
        r = client.get("/api/contacts/emails", headers=admin_headers)
        assert r.status_code == 200, r.text
        emails = r.json()
        assert len(emails) == 2
        assert {e.lower() for e in emails} == {"dup@x.com", "only@y.com"}

    def test_emails_respect_q_filter(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="דוד", email="david@x.com")
        _mk_contact(client, admin_headers, name="שרה", email="sara@x.com")
        r = client.get("/api/contacts/emails?q=דוד", headers=admin_headers)
        assert r.json() == ["david@x.com"]


# --- §7.1 buildings sorting + multi-area -----------------------------------------
class TestBuildingsListSorting:
    def test_sort_and_multi_area(self, client, admin_headers):
        a1 = _mk_area(client, admin_headers, "בבל")
        a2 = _mk_area(client, admin_headers, "אשור")
        b1 = _mk_building(client, admin_headers, a1["id"], "20 B St, City")
        b2 = _mk_building(client, admin_headers, a2["id"], "10 A St, City")

        r = client.get("/api/buildings/list?sort=address", headers=admin_headers)
        assert [b["id"] for b in r.json()["items"]] == [b2["id"], b1["id"]]

        r = client.get(
            "/api/buildings/list?sort=address&dir=desc", headers=admin_headers
        )
        assert [b["id"] for b in r.json()["items"]] == [b1["id"], b2["id"]]

        # Sort by parent area name: אשור before בבל.
        r = client.get("/api/buildings/list?sort=area", headers=admin_headers)
        assert [b["id"] for b in r.json()["items"]] == [b2["id"], b1["id"]]

        r = client.get("/api/buildings/list?sort=created", headers=admin_headers)
        assert r.status_code == 200

        r = client.get(
            f"/api/buildings/list?area_ids={a1['id']}&area_ids={a2['id']}",
            headers=admin_headers,
        )
        assert r.json()["total"] == 2
        r = client.get(
            f"/api/buildings/list?area_ids={a1['id']}", headers=admin_headers
        )
        assert [b["id"] for b in r.json()["items"]] == [b1["id"]]

    def test_invalid_sort_rejected(self, client, admin_headers):
        r = client.get("/api/buildings/list?sort=bogus", headers=admin_headers)
        assert r.status_code == 422


# --- §7.1/§4.2 apartments multi-area + shliach filter ----------------------------
class TestApartmentFilters:
    def test_area_ids_multi(self, client, admin_headers):
        a1 = _mk_area(client, admin_headers, "צפון")
        a2 = _mk_area(client, admin_headers, "דרום")
        b1 = _mk_building(client, admin_headers, a1["id"], "1 North St, City")
        b2 = _mk_building(client, admin_headers, a2["id"], "2 South St, City")
        ap1 = _mk_apartment(client, admin_headers, b1["id"], apartment_name="1")
        ap2 = _mk_apartment(client, admin_headers, b2["id"], apartment_name="2")
        r = client.get(
            f"/api/apartments/list?area_ids={a1['id']}", headers=admin_headers
        )
        assert [a["id"] for a in r.json()["items"]] == [ap1["id"]]
        r = client.get(
            f"/api/apartments/list?area_ids={a1['id']}&area_ids={a2['id']}",
            headers=admin_headers,
        )
        assert {a["id"] for a in r.json()["items"]} == {ap1["id"], ap2["id"]}

    # fixes19: the shliach_contact_id filter (and the covered-apartments grid
    # it fed) was removed together with the shliach↔apartment bridge.


# --- §2.2 superadmin user dependencies -------------------------------------------
@pytest.fixture
def superadmin_headers(client, db_session):
    org = models.Organization(name="System15", is_active=True)
    db_session.add(org)
    db_session.flush()
    db_session.add(
        models.User(
            organization_id=org.id,
            username="root15",
            full_name="root15",
            email="root15@system.local",
            password_hash=hash_password("pw12345"),
            role="superadmin",
            is_active=True,
            email_verified=True,
        )
    )
    db_session.commit()
    token = client.post(
        "/api/auth/token",
        data={"username": "root15", "password": "pw12345"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


class TestUserDependencies:
    def test_shliach_user_reports_ties(
        self, client, admin_headers, superadmin_headers, db_session
    ):
        area = _mk_area(client, admin_headers, "תלוי")
        # fixes19: coverage ties are report numbers, not apartments.
        rn = client.post(
            "/api/report-numbers", json={"name": "דוח 15"}, headers=admin_headers
        ).json()
        sh = _mk_contact(
            client,
            admin_headers,
            name="נח",
            last_name="פעילי",
            contact_type="shliach",
            email="dep@x.com",
            shliach={"report_number_ids": [rn["id"]], "area_ids": [area["id"]]},
        )
        user_id = (
            db_session.query(models.ContactShliach)
            .filter(models.ContactShliach.contact_id == sh["id"])
            .one()
            .user_id
        )
        r = client.get(
            f"/api/admin/users/{user_id}/dependencies", headers=superadmin_headers
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_dependencies"] is True
        assert body["shliach_contact_id"] == sh["id"]
        assert "נח" in body["shliach_contact_name"]
        assert body["covered_report_numbers"] == 1
        assert body["covered_areas"] == 1

    def test_clean_user_reports_none(self, client, superadmin_headers, db_session):
        org = models.Organization(name="Clean15", is_active=True)
        db_session.add(org)
        db_session.flush()
        user = models.User(
            organization_id=org.id,
            username="lonely",
            full_name="lonely",
            password_hash=hash_password("pw12345"),
            role="staff",
            is_active=True,
        )
        db_session.add(user)
        db_session.commit()
        r = client.get(
            f"/api/admin/users/{user.id}/dependencies", headers=superadmin_headers
        )
        body = r.json()
        assert body["has_dependencies"] is False
        assert body["assigned_contacts"] == 0

    def test_requires_superadmin(self, client, admin_headers):
        r = client.get("/api/admin/users/1/dependencies", headers=admin_headers)
        assert r.status_code == 403


# --- §2.1 shliach welcome via the editable DB template ---------------------------
class TestShliachWelcomeTemplate:
    def test_template_seeded_with_html(self, client, superadmin_headers):
        r = client.get("/api/admin/email-templates", headers=superadmin_headers)
        assert r.status_code == 200
        by_key = {tpl["key"]: tpl for tpl in r.json()}
        assert "shliach_welcome" in by_key
        assert "{{url_to_system}}" in by_key["shliach_welcome"]["body"]
        assert "<table" in by_key["shliach_welcome"]["body"]

    def test_welcome_sends_db_template(self, client, admin_headers, monkeypatch):
        sent = {}

        def fake_send(to, subject, body, html=None, **kwargs):
            sent.update(to=to, subject=subject, body=body, html=html)

        monkeypatch.setattr("app.core.email.send_email", fake_send)
        _mk_contact(
            client,
            admin_headers,
            name="חדש",
            contact_type="shliach",
            email="new-shliach@x.com",
        )
        assert sent["to"] == "new-shliach@x.com"
        assert sent["subject"] == "Welcome to the system"
        # Placeholders substituted into the HTML body (sent verbatim, not
        # wrapped in the notification shell).
        assert "new-shliach@x.com" in sent["html"]
        assert "{{" not in sent["html"]

    def test_edited_template_wins(
        self, client, admin_headers, superadmin_headers, monkeypatch
    ):
        r = client.put(
            "/api/admin/email-templates/shliach_welcome",
            json={"subject": "שלום {{first_name}}", "body": "<p>קליק: {{url_to_system}}</p>"},
            headers=superadmin_headers,
        )
        assert r.status_code == 200, r.text
        sent = {}

        def fake_send(to, subject, body, html=None, **kwargs):
            sent.update(to=to, subject=subject, body=body, html=html)

        monkeypatch.setattr("app.core.email.send_email", fake_send)
        _mk_contact(
            client,
            admin_headers,
            name="שמעון",
            contact_type="shliach",
            email="edited@x.com",
        )
        assert sent["subject"] == "שלום שמעון"
        assert "<p>קליק:" in sent["html"]
