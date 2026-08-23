"""Fixes51 acceptance tests: apartment_number locked for Shliach, apartment
multi-language, manager_jewish_status (admin-only), and the Shliach Role
Configuration Panel. (§1's colored section borders are frontend-only, not
covered here.)"""
from app.seed import seed_picklist_definitions, seed_picklists


def _provision(client, db_session, headers):
    """Give the test org its seeded picklists (registration doesn't provision)."""
    org_id = client.get("/api/auth/me", headers=headers).json()["organization_id"]
    seed_picklists(db_session, org_id)
    seed_picklist_definitions(db_session, org_id)
    return org_id


def _mk_area(client, headers, name="שכונה נא"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="51 Fix St"):
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


def _mk_report_number(client, headers, name="דוח נא"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(5000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל נא",
            "phone": f"0551{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, username, password="pw12345"):
    token = client.post(
        "/api/auth/token", data={"username": username, "password": password}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _mk_staff(client, headers, email):
    r = client.post(
        "/api/users",
        json={"full_name": "צוות נא", "email": email, "role": "staff", "password": "pw12345"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return _login(client, email)


# --- §2.1 apartment_number locked for Shliach --------------------------------
class TestApartmentNumberLock:
    def test_shliach_cannot_edit_apartment_name(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers)
        ap = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="1", floor="1",
            report_number_id=rn["id"],
        )
        _mk_shliach(client, admin_headers, "lock51@example.com", report_number_ids=[rn["id"]])
        shliach = _login(client, "lock51@example.com")

        # Blocked: changing the apartment number.
        r = client.put(
            f"/api/apartments/{ap['id']}", json={"apartment_name": "2"}, headers=shliach
        )
        assert r.status_code == 403

        # Allowed: any other field on the same (assigned) apartment.
        r = client.put(f"/api/apartments/{ap['id']}", json={"name": "דייר"}, headers=shliach)
        assert r.status_code == 200, r.text

        # Sending back the unchanged value isn't a "change" — allowed no-op.
        current_id = r.json()["id"]
        r = client.put(
            f"/api/apartments/{current_id}", json={"apartment_name": "1"}, headers=shliach
        )
        assert r.status_code == 200, r.text

    def test_admin_can_still_edit_apartment_name(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        area = _mk_area(client, admin_headers, "שכונה נא-א")
        b = _mk_building(client, admin_headers, area["id"], "51 Fix St A")
        ap = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        r = client.put(
            f"/api/apartments/{ap['id']}", json={"apartment_name": "1A"}, headers=admin_headers
        )
        assert r.status_code == 200 and r.json()["apartment_name"] == "1A"


# --- §2.2 apartment multi-language --------------------------------------------
class TestApartmentMultiLanguage:
    def test_multiple_languages_roundtrip(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        area = _mk_area(client, admin_headers, "שכונה נא-ב")
        b = _mk_building(client, admin_headers, area["id"], "51 Fix St B")
        ap = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="3",
            language=["hebrew", "russian"],
        )
        assert sorted(ap["language"]) == ["hebrew", "russian"]

        got = client.get(f"/api/apartments/{ap['id']}", headers=admin_headers).json()
        assert sorted(got["language"]) == ["hebrew", "russian"]

        # Update replaces the whole set.
        r = client.put(
            f"/api/apartments/{ap['id']}", json={"language": ["yiddish"]}, headers=admin_headers
        )
        assert r.status_code == 200 and r.json()["language"] == ["yiddish"]

        # Clearing to [] removes every language.
        current_id = r.json()["id"]
        r = client.put(
            f"/api/apartments/{current_id}", json={"language": []}, headers=admin_headers
        )
        assert r.status_code == 200 and r.json()["language"] == []

        # Not mentioning "language" at all leaves it untouched.
        current_id2 = r.json()["id"]
        r = client.put(
            f"/api/apartments/{current_id2}", json={"name": "דייר"}, headers=admin_headers
        )
        assert r.status_code == 200 and r.json()["language"] == []

    def test_unknown_language_value_rejected(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        area = _mk_area(client, admin_headers, "שכונה נא-ג")
        b = _mk_building(client, admin_headers, area["id"], "51 Fix St C")
        r = client.post(
            "/api/apartments",
            json={"building_id": b["id"], "apartment_name": "4", "language": ["klingon"]},
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_filter_matches_any_selected_language(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        area = _mk_area(client, admin_headers, "שכונה נא-ד")
        b = _mk_building(client, admin_headers, area["id"], "51 Fix St D")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="5",
            language=["hebrew", "russian"],
        )
        _mk_apartment(client, admin_headers, b["id"], apartment_name="6", language=["yiddish"])

        r = client.get("/api/apartments/list?language=russian", headers=admin_headers)
        assert r.status_code == 200
        names = {it["apartment_name"] for it in r.json()["items"]}
        assert names == {"5"}


# --- §3 manager_jewish_status (admin-only) ------------------------------------
class TestManagerJewishStatus:
    def test_admin_can_set_staff_and_shliach_cannot(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        sh = _mk_shliach(client, admin_headers, "manager51@example.com")
        staff = _mk_staff(client, admin_headers, "staff51@example.com")
        shliach = _login(client, "manager51@example.com")

        r = client.put(
            f"/api/contacts/{sh['id']}",
            json={"picklist_values": {"contact_shliach.manager_jewish_status": "jewish"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["picklist_values"]["contact_shliach.manager_jewish_status"] == "jewish"

        r = client.put(
            f"/api/contacts/{sh['id']}",
            json={"picklist_values": {"contact_shliach.manager_jewish_status": "jewish_gentile"}},
            headers=staff,
        )
        assert r.status_code == 403

        r = client.put(
            f"/api/contacts/{sh['id']}",
            json={"picklist_values": {"contact_shliach.manager_jewish_status": "jewish_gentile"}},
            headers=shliach,
        )
        assert r.status_code == 403

    def test_picklist_definition_provisioned_under_contact_shliach(
        self, client, admin_headers, db_session
    ):
        _provision(client, db_session, admin_headers)
        defs = client.get("/api/picklists", headers=admin_headers).json()
        by_key = {d["field_key"]: d for d in defs}
        assert "contact_shliach.manager_jewish_status" in by_key
        assert by_key["contact_shliach.manager_jewish_status"]["entity_type"] == "contact_shliach"

        options = client.get(
            "/api/picklists/contact_shliach.manager_jewish_status", headers=admin_headers
        ).json()
        assert {o["value"] for o in options} >= {"jewish", "jewish_gentile"}


# --- §4 Shliach Role Configuration Panel ---------------------------------------
class TestShliachViewConfig:
    def test_admin_only_write_any_authenticated_read(self, client, admin_headers, db_session):
        _provision(client, db_session, admin_headers)
        staff = _mk_staff(client, admin_headers, "cfgstaff51@example.com")

        cfg = {
            "disable_edit": True,
            "hide_filters": True,
            "default_filters": {"jewish_status": ["jewish"]},
            "default_columns": ["resident", "building"],
        }
        r = client.put(
            "/api/organizations/me", json={"shliach_view_config": cfg}, headers=admin_headers
        )
        assert r.status_code == 200
        assert r.json()["shliach_view_config"]["disable_edit"] is True

        # Any authenticated org member can read it back.
        r = client.get("/api/organizations/me", headers=staff)
        assert r.status_code == 200
        assert r.json()["shliach_view_config"]["default_columns"] == ["resident", "building"]

        # Staff cannot write it.
        r = client.put(
            "/api/organizations/me",
            json={"shliach_view_config": {"disable_edit": False}},
            headers=staff,
        )
        assert r.status_code == 403
