"""Fixes19 acceptance tests: report-number CRUD + shliach association,
apartment versioning (edit history, scoped reads), town-house buildings, and
the mekurav-section visibility toggle."""
from app import models


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה יט"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="19 Report St, City", **kw):
    r = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_address": address, "floors": ["1"], **kw},
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


def _mk_report_number(client, headers, name="דוח א"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(1000, 9999))


def _mk_contact(client, headers, name="פלוני", **overrides):
    payload = {
        "name": name,
        "phone": f"0539{next(_seq):06d}",
        "contact_type": "mekurav",
        **overrides,
    }
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# --- §2 report-number CRUD -----------------------------------------------------
class TestReportNumberCrud:
    def test_admin_full_crud(self, client, admin_headers):
        rn = _mk_report_number(client, admin_headers, "דוח 100")
        assert rn["name"] == "דוח 100"

        r = client.get("/api/report-numbers", headers=admin_headers)
        assert [x["id"] for x in r.json()] == [rn["id"]]

        r = client.put(
            f"/api/report-numbers/{rn['id']}",
            json={"name": "דוח 200"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "דוח 200"

        r = client.delete(f"/api/report-numbers/{rn['id']}", headers=admin_headers)
        assert r.status_code == 204
        assert client.get("/api/report-numbers", headers=admin_headers).json() == []

    def test_mutations_require_admin(self, client, auth_headers, admin_headers):
        rn = _mk_report_number(client, admin_headers)
        # Staff may read (the dropdowns need the list)…
        assert client.get("/api/report-numbers", headers=auth_headers).status_code == 200
        # …but never mutate.
        assert (
            client.post(
                "/api/report-numbers", json={"name": "x"}, headers=auth_headers
            ).status_code
            == 403
        )
        assert (
            client.put(
                f"/api/report-numbers/{rn['id']}",
                json={"name": "y"},
                headers=auth_headers,
            ).status_code
            == 403
        )
        assert (
            client.delete(
                f"/api/report-numbers/{rn['id']}", headers=auth_headers
            ).status_code
            == 403
        )

    def test_blank_name_rejected(self, client, admin_headers):
        r = client.post(
            "/api/report-numbers", json={"name": "  "}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_org_isolation(self, client, admin_headers):
        rn = _mk_report_number(client, admin_headers, "פרטי")
        client.post(
            "/api/auth/register",
            json={
                "username": "otherorg19",
                "full_name": "אחר",
                "password": "pw12345",
                "role": "admin",
            },
        )
        token = client.post(
            "/api/auth/token",
            data={"username": "otherorg19", "password": "pw12345"},
        ).json()["access_token"]
        other = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/report-numbers", headers=other).json() == []
        assert (
            client.get(f"/api/report-numbers/{rn['id']}", headers=other).status_code
            == 404
        )


# --- §2 shliach ↔ report-number association -------------------------------------
class TestShliachReportNumbers:
    def test_round_trip_and_replace(self, client, admin_headers):
        rn1 = _mk_report_number(client, admin_headers, "דוח 1")
        rn2 = _mk_report_number(client, admin_headers, "דוח 2")
        sh = _mk_contact(
            client,
            admin_headers,
            name="פעיל",
            contact_type="shliach",
            email="rn.sh@example.com",
            shliach={"report_number_ids": [rn1["id"]]},
        )
        assert sh["shliach"]["report_number_ids"] == [rn1["id"]]

        r = client.put(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"report_number_ids": [rn2["id"]]}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["report_number_ids"] == [rn2["id"]]

    def test_unknown_report_number_rejected(self, client, admin_headers):
        r = client.post(
            "/api/contacts",
            json={
                "name": "פעיל",
                "phone": f"0539{next(_seq):06d}",
                "contact_type": "shliach",
                "email": "bad.rn@example.com",
                "shliach": {"report_number_ids": [999999]},
            },
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_delete_report_number_detaches_links(
        self, client, admin_headers, db_session
    ):
        rn = _mk_report_number(client, admin_headers, "נמחק")
        sh = _mk_contact(
            client,
            admin_headers,
            name="פעיל",
            contact_type="shliach",
            email="detach.rn@example.com",
            shliach={"report_number_ids": [rn["id"]]},
        )
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        ap = _mk_apartment(
            client, admin_headers, b["id"], report_number_id=rn["id"]
        )
        r = client.delete(f"/api/report-numbers/{rn['id']}", headers=admin_headers)
        assert r.status_code == 204
        fresh = client.get(f"/api/contacts/{sh['id']}", headers=admin_headers).json()
        assert fresh["shliach"]["report_number_ids"] == []
        fresh_ap = client.get(
            f"/api/apartments/{ap['id']}", headers=admin_headers
        ).json()
        assert fresh_ap["report_number_id"] is None


# --- §3 apartment versioning -----------------------------------------------------
class TestApartmentVersioning:
    def _setup(self, client, headers):
        area = _mk_area(client, headers)
        b = _mk_building(client, headers, area["id"])
        ap = _mk_apartment(client, headers, b["id"], apartment_name="1", floor="1")
        return area, b, ap

    def test_update_retires_and_inserts(self, client, admin_headers, db_session):
        _, _, ap = self._setup(client, admin_headers)
        r = client.put(
            f"/api/apartments/{ap['id']}",
            json={"name": "דייר חדש"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        new = r.json()
        assert new["id"] != ap["id"]
        assert new["name"] == "דייר חדש"
        assert new["apartment_name"] == "1"  # untouched fields carried over
        assert new["is_display"] is True
        assert new["root_id"] == ap["id"]

        old = db_session.get(models.Apartment, ap["id"])
        assert old.is_display is False
        assert old.last_edit is not None
        assert old.editor_id is not None

    def test_lists_show_only_active_version(self, client, admin_headers):
        _, b, ap = self._setup(client, admin_headers)
        new = client.put(
            f"/api/apartments/{ap['id']}",
            json={"name": "עדכני"},
            headers=admin_headers,
        ).json()
        plain = client.get("/api/apartments", headers=admin_headers).json()
        assert [a["id"] for a in plain] == [new["id"]]
        page = client.get(
            f"/api/apartments/list?building_id={b['id']}", headers=admin_headers
        ).json()
        assert [a["id"] for a in page["items"]] == [new["id"]]

    def test_historical_row_admin_only(self, client, admin_headers, auth_headers):
        _, _, ap = self._setup(client, admin_headers)
        client.put(
            f"/api/apartments/{ap['id']}", json={"name": "x"}, headers=admin_headers
        )
        # Admin can load the snapshot; staff (the mekurav-facing view) cannot.
        assert (
            client.get(f"/api/apartments/{ap['id']}", headers=admin_headers).status_code
            == 200
        )
        assert (
            client.get(f"/api/apartments/{ap['id']}", headers=auth_headers).status_code
            == 404
        )
        # A historical row is immutable — updating it 404s for everyone.
        assert (
            client.put(
                f"/api/apartments/{ap['id']}", json={"name": "y"}, headers=admin_headers
            ).status_code
            == 404
        )

    def test_history_lists_versions_newest_first(self, client, admin_headers):
        _, _, ap = self._setup(client, admin_headers)
        v2 = client.put(
            f"/api/apartments/{ap['id']}", json={"name": "שני"}, headers=admin_headers
        ).json()
        v3 = client.put(
            f"/api/apartments/{v2['id']}", json={"name": "שלישי"}, headers=admin_headers
        ).json()
        assert v3["root_id"] == ap["id"]  # the lineage root never changes

        r = client.get(
            f"/api/apartments/{v3['id']}/history", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        history = r.json()
        assert [h["id"] for h in history] == [v2["id"], ap["id"]]
        assert all(h["last_edit"] is not None for h in history)
        assert all(h["editor_name"] for h in history)
        # The snapshot carries the values as they were at that point in time.
        assert history[1]["name"] is None

    def test_history_requires_admin(self, client, admin_headers, auth_headers):
        _, _, ap = self._setup(client, admin_headers)
        r = client.get(f"/api/apartments/{ap['id']}/history", headers=auth_headers)
        assert r.status_code == 403

    def test_mekurav_link_follows_active_version(
        self, client, admin_headers, db_session
    ):
        _, _, ap = self._setup(client, admin_headers)
        contact = _mk_contact(
            client, admin_headers, name="מקורב", mekurav={"apartment_id": ap["id"]}
        )
        new = client.put(
            f"/api/apartments/{ap['id']}", json={"name": "מעודכן"}, headers=admin_headers
        ).json()
        fresh = client.get(
            f"/api/contacts/{contact['id']}", headers=admin_headers
        ).json()
        assert fresh["mekurav"]["apartment_id"] == new["id"]

    def test_linking_historical_version_rejected(self, client, admin_headers):
        _, _, ap = self._setup(client, admin_headers)
        client.put(
            f"/api/apartments/{ap['id']}", json={"name": "x"}, headers=admin_headers
        )
        r = client.post(
            "/api/contacts",
            json={
                "name": "מקורב",
                "phone": f"0539{next(_seq):06d}",
                "mekurav": {"apartment_id": ap["id"]},
            },
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_delete_removes_whole_lineage(self, client, admin_headers, db_session):
        _, _, ap = self._setup(client, admin_headers)
        new = client.put(
            f"/api/apartments/{ap['id']}", json={"name": "x"}, headers=admin_headers
        ).json()
        r = client.delete(f"/api/apartments/{new['id']}", headers=admin_headers)
        assert r.status_code == 204
        assert db_session.query(models.Apartment).count() == 0

    def test_building_delete_with_versioned_apartments(self, client, admin_headers):
        """Regression: the apartments self-FK (root_id) must not block deleting
        a building whose apartments carry history (SET NULL at the DB level)."""
        _, b, ap = self._setup(client, admin_headers)
        client.put(
            f"/api/apartments/{ap['id']}", json={"name": "x"}, headers=admin_headers
        )
        r = client.delete(f"/api/buildings/{b['id']}", headers=admin_headers)
        assert r.status_code == 204

    def test_update_with_report_number(self, client, admin_headers):
        rn = _mk_report_number(client, admin_headers, "דוח דירה")
        _, _, ap = self._setup(client, admin_headers)
        new = client.put(
            f"/api/apartments/{ap['id']}",
            json={"report_number_id": rn["id"]},
            headers=admin_headers,
        ).json()
        assert new["report_number_id"] == rn["id"]
        # An unknown report number is rejected.
        r = client.put(
            f"/api/apartments/{new['id']}",
            json={"report_number_id": 999999},
            headers=admin_headers,
        )
        assert r.status_code == 400


# --- §4 town-house buildings -----------------------------------------------------
class TestTownHouse:
    def test_town_house_gets_single_unit_and_no_floors(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(
            client,
            admin_headers,
            area["id"],
            address="12 Private Rd, City",
            is_town_house=True,
            floors=["1", "2", "3"],  # explicitly ignored for a town house
        )
        assert b["is_town_house"] is True
        assert b["building_type_id"] == "town_house"
        assert b["is_townhouse"] is True
        floors = client.get(
            f"/api/buildings/{b['id']}/floors", headers=admin_headers
        ).json()
        assert floors == []
        apartments = client.get(
            f"/api/apartments?building_id={b['id']}", headers=admin_headers
        ).json()
        assert len(apartments) == 1
        assert apartments[0]["apartment_name"] == "12 Private Rd"

    def test_regular_building_unaffected(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], address="5 Multi St, City")
        assert b["is_town_house"] is False
        assert b["building_type_id"] == "building"
        assert b["is_townhouse"] is False
        floors = client.get(
            f"/api/buildings/{b['id']}/floors", headers=admin_headers
        ).json()
        assert len(floors) == 1  # the explicit ["1"] from the builder
        apartments = client.get(
            f"/api/apartments?building_id={b['id']}", headers=admin_headers
        ).json()
        assert apartments == []


# --- §5 mekurav-section visibility toggle ------------------------------------------
class TestMekuravSectionToggle:
    def test_registry_default_hidden_and_toggleable(self, client, admin_headers):
        r = client.get("/api/field-settings", headers=admin_headers)
        assert r.status_code == 200, r.text
        by_key = {f["field_key"]: f for f in r.json()}
        assert "contact_mekurav.section" in by_key
        assert by_key["contact_mekurav.section"]["is_visible"] is False

        # An admin can opt the org in.
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contact_mekurav.section", "is_visible": True},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        by_key = {
            f["field_key"]: f
            for f in client.get("/api/field-settings", headers=admin_headers).json()
        }
        assert by_key["contact_mekurav.section"]["is_visible"] is True
