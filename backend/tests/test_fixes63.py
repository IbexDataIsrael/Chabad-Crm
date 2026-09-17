"""Fixes63 acceptance tests: building_type_id classification, including the
town_house -> divided_town_house transition when a second apartment unit is
added to what started as a single-unit town house."""


def _mk_area(client, headers, name="שכונה סג"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="63 Split Rd, City", **kw):
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


class TestBuildingType:
    def test_regular_building_defaults_to_building_type(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        assert b["building_type_id"] == "building"
        assert b["is_townhouse"] is False

    def test_town_house_starts_undivided(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], is_town_house=True)
        assert b["building_type_id"] == "town_house"
        assert b["is_townhouse"] is True

    def test_second_unit_splits_town_house(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], is_town_house=True)
        # Adding a second unit to what was a single-unit town house means it's
        # been physically divided — the type should track that going forward.
        _mk_apartment(client, admin_headers, b["id"], apartment_name="Unit B")
        r = client.get(f"/api/buildings/{b['id']}", headers=admin_headers)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["building_type_id"] == "divided_town_house"
        assert updated["is_townhouse"] is False
        # The stored is_town_house flag itself is untouched — it still marks
        # this as a (now-divided) single-family house rather than a normal
        # apartment building.
        assert updated["is_town_house"] is True


class TestBuildingTypeRegistryAndFilter:
    def test_list_types_returns_all_three_in_order(self, client, admin_headers):
        r = client.get("/api/buildings/types", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert [t["id"] for t in r.json()] == [
            "building",
            "town_house",
            "divided_town_house",
        ]
        by_id = {t["id"]: t for t in r.json()}
        assert by_id["town_house"]["name_he"] == "בית פרטי"
        assert by_id["town_house"]["name_en"] == "Town house"

    def test_filter_by_building_type_ids(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        plain = _mk_building(client, admin_headers, area["id"], address="1 Plain Ave, City")
        town_house = _mk_building(
            client, admin_headers, area["id"], address="2 Lone Ave, City", is_town_house=True
        )

        r = client.get(
            "/api/buildings/list?building_type_ids=town_house", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        page = r.json()
        assert [b["id"] for b in page["items"]] == [town_house["id"]]

        r = client.get(
            "/api/buildings/list?building_type_ids=building&building_type_ids=town_house",
            headers=admin_headers,
        )
        ids = {b["id"] for b in r.json()["items"]}
        assert {plain["id"], town_house["id"]}.issubset(ids)
