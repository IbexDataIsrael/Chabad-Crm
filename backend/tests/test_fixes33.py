"""Fixes33 acceptance tests: area deletion (cascade/unassign + the
contact_shliach_area FK-cleanup bug), dynamic custom-picklist field-settings
rows, and the report_notes org setting."""


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה 33"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="10 Fixes33 St, City"):
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


def _mk_shliach(client, headers, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 33",
            "phone": f"0554{next(_seq):06d}",
            "contact_type": "shliach",
            "email": f"shliach33-{next(_seq)}@example.com",
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


# --- §2.2 Area deletion --------------------------------------------------------
class TestAreaDeleteNoBuildings:
    def test_deletes_outright(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        r = client.delete(f"/api/areas/{area['id']}", headers=admin_headers)
        assert r.status_code == 204, r.text
        assert client.get(f"/api/areas/{area['id']}", headers=admin_headers).status_code == 404

    def test_deletes_even_with_a_direct_shliach_assignment(self, client, admin_headers):
        """This was the actual bug: contact_shliach_area rows have no ORM
        relationship on Area, so a direct coverage assignment (no buildings
        involved at all) used to trip the delete regardless of the buildings
        question."""
        area = _mk_area(client, admin_headers)
        shliach = _mk_shliach(client, admin_headers)
        r = client.post(
            f"/api/areas/{area['id']}/shluchim",
            json={"contact_id": shliach["id"]},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text

        r = client.delete(f"/api/areas/{area['id']}", headers=admin_headers)
        assert r.status_code == 204, r.text


class TestAreaDeleteWithBuildings:
    def test_no_mode_returns_409_with_building_count(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        _mk_building(client, admin_headers, area["id"], "1 A St")
        _mk_building(client, admin_headers, area["id"], "2 B St")

        r = client.delete(f"/api/areas/{area['id']}", headers=admin_headers)
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert detail["has_buildings"] is True
        assert detail["building_count"] == 2
        # Untouched: area, buildings all still exist.
        assert client.get(f"/api/areas/{area['id']}", headers=admin_headers).status_code == 200

    def test_mode_cascade_deletes_buildings_and_apartments(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        r = client.delete(
            f"/api/areas/{area['id']}?mode=cascade", headers=admin_headers
        )
        assert r.status_code == 204, r.text
        assert client.get(f"/api/areas/{area['id']}", headers=admin_headers).status_code == 404
        assert client.get(f"/api/buildings/{b['id']}", headers=admin_headers).status_code == 404
        assert client.get(f"/api/apartments/{apt['id']}", headers=admin_headers).status_code == 404

    def test_mode_unassign_keeps_buildings_and_apartments(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        r = client.delete(
            f"/api/areas/{area['id']}?mode=unassign", headers=admin_headers
        )
        assert r.status_code == 204, r.text
        assert client.get(f"/api/areas/{area['id']}", headers=admin_headers).status_code == 404

        kept_building = client.get(f"/api/buildings/{b['id']}", headers=admin_headers)
        assert kept_building.status_code == 200
        assert kept_building.json()["area_id"] is None

        kept_apartment = client.get(f"/api/apartments/{apt['id']}", headers=admin_headers)
        assert kept_apartment.status_code == 200

    def test_mode_ignored_when_no_buildings(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        r = client.delete(
            f"/api/areas/{area['id']}?mode=unassign", headers=admin_headers
        )
        assert r.status_code == 204, r.text


# --- §5.1 Manage Fields: dynamic custom-picklist rows -------------------------
class TestDynamicPicklistFieldSettings:
    def _add_picklist(self, client, headers, system_name, hebrew="בדיקה"):
        r = client.post(
            "/api/picklists/definition",
            json={"system_name": system_name, "hebrew_display_name": hebrew},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        return r.json()

    def test_custom_apartment_picklist_appears_with_apartment_entity(
        self, client, admin_headers
    ):
        self._add_picklist(client, admin_headers, "apartment.diet33")
        settings = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(s for s in settings if s["field_key"] == "apartment.diet33")
        assert row["entity"] == "apartment"
        assert row["label"] == "בדיקה"
        assert row["is_visible"] is True  # default-visible until hidden

    def test_custom_visit_picklist_appears_with_visit_entity(self, client, admin_headers):
        self._add_picklist(client, admin_headers, "visit.mood33")
        settings = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(s for s in settings if s["field_key"] == "visit.mood33")
        assert row["entity"] == "visit"

    def test_custom_bare_picklist_appears_with_contact_mekurav_entity(
        self, client, admin_headers
    ):
        self._add_picklist(client, admin_headers, "diet33")
        settings = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(s for s in settings if s["field_key"] == "diet33")
        assert row["entity"] == "contact_mekurav"

    def test_toggling_a_custom_picklist_visibility_persists(self, client, admin_headers):
        self._add_picklist(client, admin_headers, "apartment.diet34")
        r = client.put(
            "/api/field-settings",
            json={"field_key": "apartment.diet34", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_visible"] is False

        settings = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(s for s in settings if s["field_key"] == "apartment.diet34")
        assert row["is_visible"] is False

    def test_unknown_field_key_still_rejected(self, client, admin_headers):
        r = client.put(
            "/api/field-settings",
            json={"field_key": "not.a.real.field", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 400


# --- §6/§7 report_notes org setting --------------------------------------------
class TestReportNotes:
    def test_saves_and_reads_back(self, client, admin_headers):
        r = client.put(
            "/api/organizations/me",
            json={"report_notes": "טקסט לדוגמה לדוח"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["report_notes"] == "טקסט לדוגמה לדוח"

        me = client.get("/api/organizations/me", headers=admin_headers)
        assert me.json()["report_notes"] == "טקסט לדוגמה לדוח"

    def test_clears_to_null(self, client, admin_headers):
        client.put(
            "/api/organizations/me",
            json={"report_notes": "temp"},
            headers=admin_headers,
        )
        r = client.put(
            "/api/organizations/me",
            json={"report_notes": None},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["report_notes"] is None
