"""Fixes52 acceptance tests: natural (alphanumeric) sort on areas/report-numbers/
contacts, floor "L" auto-placement ahead of numbered floors, the expanded bulk-
update payload (every standard + custom field, partial-payload semantics), the
new custom (non-select) apartment field text/boolean filter, and GET
/api/auth/me resolving a shliach session's linked contact (found live-driving
§5's redirect — /me never populated UserOut.shliach, only GET /api/users/{id}
did, so the frontend redirect had nothing to redirect to)."""


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="10 Fixes52 St, City", **kw):
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


def _mk_report_number(client, headers, name):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_contact(client, headers, name, **kw):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **kw},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_field(client, headers, entity_type, field_type, field_key, **kw):
    payload = {
        "field_key": field_key,
        "hebrew_label": "שדה בדיקה",
        "entity_type": entity_type,
        "field_type": field_type,
        **kw,
    }
    r = client.post("/api/custom-fields", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _list(client, headers, qs=""):
    return client.get(f"/api/apartments/list{qs}", headers=headers).json()


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 52", "contact_type": "shliach", "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _shliach_login(client, email):
    token = client.post(
        "/api/auth/token", data={"username": email, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- §6 natural sort ---------------------------------------------------------
class TestNaturalSort:
    def test_areas_natural_order(self, client, admin_headers):
        _mk_area(client, admin_headers, "אזור 10")
        _mk_area(client, admin_headers, "אזור 2")
        names = [a["area_name"] for a in client.get("/api/areas", headers=admin_headers).json()]
        assert names.index("אזור 2") < names.index("אזור 10")

    def test_report_numbers_natural_order(self, client, admin_headers):
        _mk_report_number(client, admin_headers, "10")
        _mk_report_number(client, admin_headers, "2")
        names = [
            r["name"]
            for r in client.get("/api/report-numbers", headers=admin_headers).json()
        ]
        assert names.index("2") < names.index("10")

    def test_contacts_natural_order(self, client, admin_headers):
        # Contacts stay server-paginated (unlike areas/report-numbers, which
        # are always fetched in full), so the natural-sort fix here is the
        # SQL-level whole-value check — it corrects a purely-numeric `name`
        # (the "numeric identifiers" case from the spec) but, unlike the
        # frontend's Intl.Collator fix, can't reorder a number embedded
        # mid-string (a real person's name is never structured that way).
        _mk_contact(client, admin_headers, "10")
        _mk_contact(client, admin_headers, "2")
        page = client.get("/api/contacts/list", headers=admin_headers).json()
        names = [c["name"] for c in page["items"]]
        assert names.index("2") < names.index("10")


# --- §3 floor "L" placement ----------------------------------------------------
class TestFloorLPlacement:
    def test_l_sorts_before_existing_numbered_floors(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-floors")
        b = _mk_building(
            client, admin_headers, area["id"], "1 Floor St, City",
        )
        # numFloors-style auto-generation: "1".."3".
        for n in ("2", "3"):
            r = client.post(
                f"/api/buildings/{b['id']}/floors", json={"name": n},
                headers=admin_headers,
            )
            assert r.status_code == 201, r.text
        r = client.post(
            f"/api/buildings/{b['id']}/floors", json={"name": "L"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        floors = client.get(
            f"/api/buildings/{b['id']}/floors", headers=admin_headers
        ).json()
        by_name = {f["name"]: f["sort_order"] for f in floors}
        assert by_name["L"] < by_name["2"] < by_name["3"] or by_name["L"] < min(
            by_name["2"], by_name["3"]
        )

    def test_l_before_a_manually_reordered_minimum(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-floors-2")
        b = _mk_building(client, admin_headers, area["id"], "2 Floor St, City")
        f1 = client.post(
            f"/api/buildings/{b['id']}/floors", json={"name": "1"},
            headers=admin_headers,
        ).json()
        # Manually push floor "1" to a very low sort_order (simulating a
        # previously-reordered building) before adding "L".
        client.put(
            f"/api/buildings/{b['id']}/floors/{f1['id']}",
            json={"sort_order": -50},
            headers=admin_headers,
        )
        client.post(
            f"/api/buildings/{b['id']}/floors", json={"name": "L"},
            headers=admin_headers,
        )
        floors = client.get(
            f"/api/buildings/{b['id']}/floors", headers=admin_headers
        ).json()
        by_name = {f["name"]: f["sort_order"] for f in floors}
        assert by_name["L"] < by_name["1"]


# --- §2.3 expanded bulk update -------------------------------------------------
class TestBulkUpdateExpanded:
    def test_sets_every_standard_field(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-bulk")
        b = _mk_building(client, admin_headers, area["id"], "3 Bulk St, City")
        rn = _mk_report_number(client, admin_headers, "RN52")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        res = client.post(
            "/api/apartments/bulk-update",
            json={
                "building_ids": [b["id"]],
                "changes": {
                    "floor": "5",
                    "name": "דייר חדש",
                    "phone": "0501234567",
                    "email": "bulk52@example.com",
                    "report_number_id": rn["id"],
                    "jewish_status": "jewish",
                    "mezuzah_status": "checked",
                    "language": ["hebrew", "english"],
                    "apartment_notes": "BULK52",
                },
            },
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        assert res.json()["updated"] == 1
        item = _list(client, admin_headers)["items"][0]
        assert item["floor"] == "5"
        assert item["name"] == "דייר חדש"
        assert item["phone"] == "0501234567"
        assert item["email"] == "bulk52@example.com"
        assert item["report_number_id"] == rn["id"]
        assert item["jewish_status"] == "jewish"
        assert item["mezuzah_status"] == "checked"
        assert sorted(item["language"]) == ["english", "hebrew"]
        assert item["apartment_notes"] == "BULK52"
        # apartment_name/building were never sent — untouched.
        assert item["apartment_name"] == "1"
        assert item["building_id"] == b["id"]

    def test_apartment_name_and_building_are_not_bulk_editable(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers, "אזור 52-guard")
        b1 = _mk_building(client, admin_headers, area["id"], "4 Guard St, City")
        b2 = _mk_building(client, admin_headers, area["id"], "5 Guard St, City")
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="ORIG")

        res = client.post(
            "/api/apartments/bulk-update",
            json={
                "building_ids": [b1["id"]],
                # Not real fields on ApartmentBulkChanges — silently ignored by
                # pydantic rather than moving the apartment or renaming it.
                "changes": {
                    "apartment_name": "HACKED",
                    "building_id": b2["id"],
                    "apartment_notes": "still applies",
                },
            },
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        item = _list(client, admin_headers)["items"][0]
        assert item["apartment_name"] == "ORIG"
        assert item["building_id"] == b1["id"]
        assert item["apartment_notes"] == "still applies"

    def test_untouched_field_is_left_alone(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-partial")
        b = _mk_building(client, admin_headers, area["id"], "6 Partial St, City")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1", name="Keep Me")

        client.post(
            "/api/apartments/bulk-update",
            json={"building_ids": [b["id"]], "changes": {"floor": "9"}},
            headers=admin_headers,
        )
        item = _list(client, admin_headers)["items"][0]
        assert item["floor"] == "9"
        assert item["name"] == "Keep Me"  # untouched field survives

    def test_custom_picklist_and_field_bulk_edit(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-custom")
        b = _mk_building(client, admin_headers, area["id"], "7 Custom St, City")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        _mk_field(client, admin_headers, "apartment", "select", "diet52")
        _mk_field(client, admin_headers, "apartment", "text", "note52")

        res = client.post(
            "/api/apartments/bulk-update",
            json={
                "building_ids": [b["id"]],
                "changes": {
                    "picklist_values": {"apartment.diet52": "kosher"},
                    "custom_field_values": {"note52": "hi"},
                },
            },
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        item = _list(client, admin_headers)["items"][0]
        assert item["picklist_values"]["apartment.diet52"] == "kosher"
        assert item["custom_field_values"]["note52"] == "hi"

    def test_no_field_selected_is_rejected(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-empty")
        b = _mk_building(client, admin_headers, area["id"], "8 Empty St, City")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        res = client.post(
            "/api/apartments/bulk-update",
            json={"building_ids": [b["id"]]},
            headers=admin_headers,
        )
        assert res.status_code == 400, res.text


# --- §2.2 custom field filter ---------------------------------------------------
class TestCustomFieldFilter:
    def test_text_field_contains_filter(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-filter")
        b = _mk_building(client, admin_headers, area["id"], "9 Filter St, City")
        _mk_field(client, admin_headers, "apartment", "text", "comment52")
        a1 = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        a2 = _mk_apartment(client, admin_headers, b["id"], apartment_name="2")
        client.put(
            f"/api/apartments/{a1['id']}",
            json={"custom_field_values": {"comment52": "urgent case"}},
            headers=admin_headers,
        )
        client.put(
            f"/api/apartments/{a2['id']}",
            json={"custom_field_values": {"comment52": "routine"}},
            headers=admin_headers,
        )
        page = _list(client, admin_headers, "?custom_field_filter=comment52:urgent")
        assert page["total"] == 1
        assert page["items"][0]["apartment_name"] == "1"

    def test_boolean_field_filter(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-bool")
        b = _mk_building(client, admin_headers, area["id"], "10 Bool St, City")
        _mk_field(client, admin_headers, "apartment", "boolean", "flag52")
        a1 = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        a2 = _mk_apartment(client, admin_headers, b["id"], apartment_name="2")
        client.put(
            f"/api/apartments/{a1['id']}",
            json={"custom_field_values": {"flag52": True}},
            headers=admin_headers,
        )
        client.put(
            f"/api/apartments/{a2['id']}",
            json={"custom_field_values": {"flag52": False}},
            headers=admin_headers,
        )
        page = _list(client, admin_headers, "?custom_field_filter=flag52:true")
        assert page["total"] == 1
        assert page["items"][0]["apartment_name"] == "1"

    def test_unknown_field_key_is_a_noop(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור 52-noop")
        b = _mk_building(client, admin_headers, area["id"], "11 Noop St, City")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        page = _list(client, admin_headers, "?custom_field_filter=nope52:x")
        assert page["total"] == 1


# --- §5 GET /api/auth/me resolves the shliach link ------------------------------
class TestMeShliachResolution:
    def test_shliach_session_sees_its_own_contact_id(self, client, admin_headers):
        email = "me52shliach@example.com"
        contact = _mk_shliach(client, admin_headers, email)
        headers = _shliach_login(client, email)
        me = client.get("/api/auth/me", headers=headers).json()
        assert me["role"] == "shliach"
        assert me["shliach"] is not None
        assert me["shliach"]["contact_id"] == contact["id"]

    def test_admin_session_has_no_shliach(self, client, admin_headers):
        me = client.get("/api/auth/me", headers=admin_headers).json()
        assert me["role"] == "admin"
        assert me["shliach"] is None
