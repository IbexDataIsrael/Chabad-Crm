"""Fixes7 acceptance tests: org user management, floors, building/apartment
schema changes, apartment filters + batch generator, field-setting defaults,
and canonical search titles."""


def _mk_area(client, headers, name="שכונה א"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="770 Eastern Pkwy, Brooklyn, NY", **kw):
    payload = {"area_id": area_id, "building_address": address, **kw}
    r = client.post("/api/buildings", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# --- §1 org user management --------------------------------------------------
class TestOrgUserManagement:
    def test_admin_creates_admin_google_only(self, client, admin_headers):
        r = client.post(
            "/api/users",
            json={"full_name": "מנהלת שנייה", "email": "second@example.com", "role": "admin"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["role"] == "admin"
        assert body["email"] == "second@example.com"
        assert body["username"] == "second@example.com"
        # Appears in the org's user list.
        names = [u["email"] for u in client.get("/api/users", headers=admin_headers).json()]
        assert "second@example.com" in names

    def test_admin_creates_restricted_user_with_password(self, client, admin_headers):
        r = client.post(
            "/api/users",
            json={
                "full_name": "מוגבל",
                "email": "limited@example.com",
                "role": "staff",
                "password": "Passw0rd1",
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        # The password works for a normal login.
        token = client.post(
            "/api/auth/token",
            data={"username": "limited@example.com", "password": "Passw0rd1"},
        )
        assert token.status_code == 200, token.text

    def test_staff_cannot_create_users(self, client, auth_headers):
        r = client.post(
            "/api/users",
            json={"full_name": "x", "email": "x@example.com", "role": "admin"},
            headers=auth_headers,
        )
        assert r.status_code == 403

    def test_duplicate_email_rejected(self, client, admin_headers):
        payload = {"full_name": "a", "email": "dup@example.com", "role": "staff"}
        assert client.post("/api/users", json=payload, headers=admin_headers).status_code == 201
        assert client.post("/api/users", json=payload, headers=admin_headers).status_code == 400

    def test_role_change_and_self_guard(self, client, admin_headers):
        created = client.post(
            "/api/users",
            json={"full_name": "בדיקה", "email": "promote@example.com", "role": "staff"},
            headers=admin_headers,
        ).json()
        r = client.put(
            f"/api/users/{created['id']}", json={"role": "admin"}, headers=admin_headers
        )
        assert r.status_code == 200 and r.json()["role"] == "admin"
        # An admin cannot demote themselves.
        me = client.get("/api/auth/me", headers=admin_headers).json()
        r = client.put(f"/api/users/{me['id']}", json={"role": "staff"}, headers=admin_headers)
        assert r.status_code == 400

    def test_delete_user(self, client, admin_headers):
        created = client.post(
            "/api/users",
            json={"full_name": "זמני", "email": "temp@example.com", "role": "staff"},
            headers=admin_headers,
        ).json()
        assert (
            client.delete(f"/api/users/{created['id']}", headers=admin_headers).status_code
            == 204
        )
        me = client.get("/api/auth/me", headers=admin_headers).json()
        assert client.delete(f"/api/users/{me['id']}", headers=admin_headers).status_code == 400


# --- §2 building constraints -------------------------------------------------
class TestBuildingConstraints:
    def test_address_required_name_optional(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        # No building_name — fine.
        b = _mk_building(client, admin_headers, area["id"])
        assert b["building_name"] is None
        # No address — rejected.
        r = client.post(
            "/api/buildings", json={"area_id": area["id"]}, headers=admin_headers
        )
        assert r.status_code == 422
        # Explicit empty address on update — rejected.
        r = client.put(
            f"/api/buildings/{b['id']}", json={"building_address": "  "}, headers=admin_headers
        )
        assert r.status_code == 422


# --- §3 floors ----------------------------------------------------------------
class TestFloors:
    def test_creation_hook_and_crud(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1", "2", "3"])
        assert [f["name"] for f in b["floors"]] == ["1", "2", "3"]

        # Add / rename / delete.
        r = client.post(
            f"/api/buildings/{b['id']}/floors", json={"name": "4"}, headers=admin_headers
        )
        assert r.status_code == 201
        floor4 = r.json()
        r = client.put(
            f"/api/buildings/{b['id']}/floors/{floor4['id']}",
            json={"name": "גג"},
            headers=admin_headers,
        )
        assert r.status_code == 200 and r.json()["name"] == "גג"
        assert (
            client.delete(
                f"/api/buildings/{b['id']}/floors/{floor4['id']}", headers=admin_headers
            ).status_code
            == 204
        )
        names = [
            f["name"]
            for f in client.get(f"/api/buildings/{b['id']}/floors", headers=admin_headers).json()
        ]
        assert names == ["1", "2", "3"]

    def test_floors_cascade_on_building_delete(self, client, admin_headers, db_session):
        from app import models

        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1"])
        assert client.delete(f"/api/buildings/{b['id']}", headers=admin_headers).status_code == 204
        assert (
            db_session.query(models.Floor).filter(models.Floor.building_id == b["id"]).count()
            == 0
        )


# --- §4 apartment fields -----------------------------------------------------
class TestApartmentFields:
    def _building(self, client, headers):
        area = _mk_area(client, headers)
        return _mk_building(client, headers, area["id"], floors=["1", "2"])

    def test_new_fields_round_trip(self, client, admin_headers):
        b = self._building(client, admin_headers)
        r = client.post(
            "/api/apartments",
            json={
                "building_id": b["id"],
                "apartment_name": "A",
                "floor": "1",
                "name": "משפחת לוי",
                "phone": "052-1234567",
                "email": "levi@example.com",
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        apt = r.json()
        assert apt["floor"] == "1" and apt["name"] == "משפחת לוי"
        # apartment_name is optional now.
        r = client.post(
            "/api/apartments", json={"building_id": b["id"], "floor": "2"}, headers=admin_headers
        )
        assert r.status_code == 201, r.text

    def test_phone_email_validation(self, client, admin_headers):
        b = self._building(client, admin_headers)
        bad_phone = client.post(
            "/api/apartments",
            json={"building_id": b["id"], "phone": "12"},
            headers=admin_headers,
        )
        assert bad_phone.status_code == 422
        bad_email = client.post(
            "/api/apartments",
            json={"building_id": b["id"], "email": "not-an-email"},
            headers=admin_headers,
        )
        assert bad_email.status_code == 422

    def test_apartment_picklist_validation(self, client, admin_headers):
        # Provision the org's picklists (normally done on org activation).
        from app.seed import provision_org
        from tests.conftest import TestingSessionLocal

        me = client.get("/api/auth/me", headers=admin_headers).json()
        db = TestingSessionLocal()
        try:
            provision_org(db, me["organization_id"])
        finally:
            db.close()

        b = self._building(client, admin_headers)
        ok = client.post(
            "/api/apartments",
            json={
                "building_id": b["id"],
                "jewish_status": "jewish",
                "mezuzah_status": "needs_check",
            },
            headers=admin_headers,
        )
        assert ok.status_code == 201, ok.text
        bad = client.post(
            "/api/apartments",
            json={"building_id": b["id"], "jewish_status": "no_such_value"},
            headers=admin_headers,
        )
        assert bad.status_code == 400

    def test_list_filters_building_and_street(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b1 = _mk_building(client, admin_headers, area["id"], address="770 Eastern Pkwy, Brooklyn")
        b2 = _mk_building(client, admin_headers, area["id"], address="1 Main St, Brooklyn")
        for building, label in ((b1, "A"), (b2, "B")):
            client.post(
                "/api/apartments",
                json={"building_id": building["id"], "apartment_name": label},
                headers=admin_headers,
            )
        by_building = client.get(
            f"/api/apartments/list?building_id={b1['id']}", headers=admin_headers
        ).json()["items"]
        assert [a["apartment_name"] for a in by_building] == ["A"]
        by_street = client.get(
            "/api/apartments/list?q=Eastern", headers=admin_headers
        ).json()["items"]
        assert [a["apartment_name"] for a in by_street] == ["A"]
        assert by_street[0]["building_address"].startswith("770 Eastern")


# --- §5 batch generator --------------------------------------------------------
class TestApartmentBatch:
    def test_cartesian_product_and_skip(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1", "2"])
        floor_ids = [f["id"] for f in b["floors"]]
        r = client.post(
            "/api/apartments/batch",
            json={"building_id": b["id"], "floor_ids": floor_ids, "labels": ["A", "B", "C"]},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        assert r.json() == {"created": 6, "skipped": 0}
        # Re-running skips all existing combinations.
        r = client.post(
            "/api/apartments/batch",
            json={"building_id": b["id"], "floor_ids": floor_ids, "labels": ["A", "B", "C"]},
            headers=admin_headers,
        )
        assert r.json() == {"created": 0, "skipped": 6}
        apts = client.get(
            f"/api/apartments/list?building_id={b['id']}", headers=admin_headers
        ).json()["items"]
        assert len(apts) == 6
        assert {(a["floor"], a["apartment_name"]) for a in apts} == {
            (f, l) for f in ("1", "2") for l in ("A", "B", "C")
        }

    def test_batch_validation(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1"])
        # Foreign floor id rejected.
        r = client.post(
            "/api/apartments/batch",
            json={"building_id": b["id"], "floor_ids": [99999], "labels": ["A"]},
            headers=admin_headers,
        )
        assert r.status_code == 400
        # Empty selections rejected.
        r = client.post(
            "/api/apartments/batch",
            json={"building_id": b["id"], "floor_ids": [], "labels": ["A"]},
            headers=admin_headers,
        )
        assert r.status_code == 400


# --- field-setting defaults -----------------------------------------------------
class TestFieldSettingDefaults:
    def test_building_and_apartment_registry(self, client, admin_headers):
        settings = client.get("/api/field-settings", headers=admin_headers).json()
        by_key = {s["field_key"]: s for s in settings}
        # Registered under their entity groups.
        assert by_key["buildings.building_name"]["entity"] == "building"
        assert by_key["apartments.floor"]["entity"] == "apartment"
        assert by_key["apartment.mezuzah_status"]["entity"] == "apartment"
        # Names are hidden by default (fixes7) …
        assert by_key["buildings.building_name"]["is_visible"] is False
        assert by_key["apartments.apartment_name"]["is_visible"] is False
        # … and can be restored on demand.
        r = client.put(
            "/api/field-settings",
            json={"field_key": "buildings.building_name", "is_visible": True},
            headers=admin_headers,
        )
        assert r.status_code == 200 and r.json()["is_visible"] is True
        settings = client.get("/api/field-settings", headers=admin_headers).json()
        by_key = {s["field_key"]: s for s in settings}
        assert by_key["buildings.building_name"]["is_visible"] is True


# --- search titles ----------------------------------------------------------------
class TestSearchDisplayNames:
    def test_composite_building_and_apartment_titles(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(
            client, admin_headers, area["id"], address="770 Eastern Pkwy, Brooklyn, NY"
        )
        client.post(
            "/api/apartments",
            json={
                "building_id": b["id"],
                "apartment_name": "A",
                "floor": "1",
                "name": "משפחת כהן",
            },
            headers=admin_headers,
        )
        hits = client.get("/api/search?q=Eastern", headers=admin_headers).json()["results"]
        building_hits = [h for h in hits if h["type"] == "building"]
        assert building_hits and building_hits[0]["title"] == "770 Eastern Pkwy"

        # Apartments are searchable by resident name; the hit title is the
        # computed label+floor ("A"+"1" => "A1").
        hits = client.get("/api/search?q=כהן", headers=admin_headers).json()["results"]
        apt_hits = [h for h in hits if h["type"] == "apartment"]
        assert apt_hits and apt_hits[0]["title"] == "A1"
        assert apt_hits[0]["subtitle"] == "770 Eastern Pkwy"
