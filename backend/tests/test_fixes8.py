"""Fixes8 acceptance tests: default 8 floors on building creation, apartment
list sorting (floor → apartment number, natural order), area filtering, and
server-side pagination of the enriched apartment list."""


def _mk_area(client, headers, name="שכונה א"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="770 Eastern Pkwy, Brooklyn, NY", **kw):
    payload = {"area_id": area_id, "building_address": address, **kw}
    r = client.post("/api/buildings", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_apartment(client, headers, building_id, **kw):
    r = client.post(
        "/api/apartments", json={"building_id": building_id, **kw}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


def _list(client, headers, qs=""):
    r = client.get(f"/api/apartments/list{qs}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --- §1A default floors --------------------------------------------------------
class TestDefaultFloors:
    def test_new_building_gets_floors_1_to_8(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        assert [f["name"] for f in b["floors"]] == [str(n) for n in range(1, 9)]

    def test_explicit_empty_list_overrides_default(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=[])
        assert b["floors"] == []

    def test_explicit_floor_list_wins(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["קרקע", "1", "2"])
        assert [f["name"] for f in b["floors"]] == ["קרקע", "1", "2"]


# --- §1C+§1D sorting -----------------------------------------------------------
class TestApartmentSorting:
    def test_default_sort_floor_then_number_natural(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["2", "10"])
        # Insert out of order on purpose; labels 2/10 check the natural sort.
        _mk_apartment(client, admin_headers, b["id"], floor="10", apartment_name="1")
        _mk_apartment(client, admin_headers, b["id"], floor="2", apartment_name="10")
        _mk_apartment(client, admin_headers, b["id"], floor="2", apartment_name="2")
        body = _list(client, admin_headers)
        got = [(a["floor"], a["apartment_name"]) for a in body["items"]]
        assert got == [("2", "2"), ("2", "10"), ("10", "1")]

    def test_unknown_and_missing_floors_sort_last(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1"])
        _mk_apartment(client, admin_headers, b["id"], floor=None, apartment_name="X")
        _mk_apartment(client, admin_headers, b["id"], floor="99", apartment_name="Y")
        _mk_apartment(client, admin_headers, b["id"], floor="1", apartment_name="A")
        body = _list(client, admin_headers)
        labels = [a["apartment_name"] for a in body["items"]]
        # Known floor first, then the orphan floor name, then no floor at all.
        assert labels == ["A", "Y", "X"]

    def test_desc_flips_floor_order_only(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1", "2"])
        _mk_apartment(client, admin_headers, b["id"], floor="1", apartment_name="B")
        _mk_apartment(client, admin_headers, b["id"], floor="2", apartment_name="A")
        _mk_apartment(client, admin_headers, b["id"], floor="2", apartment_name="C")
        body = _list(client, admin_headers, "?dir=desc")
        got = [(a["floor"], a["apartment_name"]) for a in body["items"]]
        # Floors descend; within a floor the numbers still ascend.
        assert got == [("2", "A"), ("2", "C"), ("1", "B")]

    def test_sort_by_label(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1"])
        for label in ("10", "2", "1"):
            _mk_apartment(client, admin_headers, b["id"], floor="1", apartment_name=label)
        body = _list(client, admin_headers, "?sort=label")
        assert [a["apartment_name"] for a in body["items"]] == ["1", "2", "10"]
        body = _list(client, admin_headers, "?sort=label&dir=desc")
        assert [a["apartment_name"] for a in body["items"]] == ["10", "2", "1"]

    def test_invalid_sort_params_rejected(self, client, admin_headers):
        assert (
            client.get("/api/apartments/list?sort=bogus", headers=admin_headers).status_code
            == 422
        )
        assert (
            client.get("/api/apartments/list?dir=sideways", headers=admin_headers).status_code
            == 422
        )


# --- §2A area filter -------------------------------------------------------------
class TestAreaFilter:
    def test_area_id_bounds_the_list(self, client, admin_headers):
        area1 = _mk_area(client, admin_headers, "אזור 1")
        area2 = _mk_area(client, admin_headers, "אזור 2")
        b1 = _mk_building(client, admin_headers, area1["id"], address="1 First St")
        b2 = _mk_building(client, admin_headers, area2["id"], address="2 Second St")
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="A")
        _mk_apartment(client, admin_headers, b2["id"], apartment_name="B")
        body = _list(client, admin_headers, f"?area_id={area1['id']}")
        assert [a["apartment_name"] for a in body["items"]] == ["A"]
        assert body["total"] == 1
        # Combined with the street search inside the active filter.
        body = _list(client, admin_headers, f"?area_id={area1['id']}&q=Second")
        assert body["items"] == [] and body["total"] == 0

    def test_apartment_id_returns_single_enriched_row(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(client, admin_headers, b["id"], apartment_name="A")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="B")
        body = _list(client, admin_headers, f"?apartment_id={apt['id']}")
        assert body["total"] == 1 and len(body["items"]) == 1
        row = body["items"][0]
        assert row["id"] == apt["id"]
        assert row["area_name"] == area["area_name"]


# --- §2C pagination --------------------------------------------------------------
class TestPagination:
    def test_envelope_and_pages(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"], floors=["1"])
        for n in range(25):
            _mk_apartment(
                client, admin_headers, b["id"], floor="1", apartment_name=str(n + 1)
            )
        page1 = _list(client, admin_headers, "?page=1&page_size=20")
        # fixes53 §2: total_buildings joined the envelope (grouped-by-building
        # pagination) — null here since sort defaults to "floor", not "building".
        assert set(page1) == {"items", "total", "page", "page_size", "total_buildings"}
        assert page1["total_buildings"] is None
        assert page1["total"] == 25 and page1["page"] == 1 and page1["page_size"] == 20
        assert len(page1["items"]) == 20
        page2 = _list(client, admin_headers, "?page=2&page_size=20")
        assert len(page2["items"]) == 5
        # Pages don't overlap and cover everything, in order.
        labels = [a["apartment_name"] for a in page1["items"] + page2["items"]]
        assert labels == [str(n + 1) for n in range(25)]

    def test_only_supported_page_sizes(self, client, admin_headers):
        for size in (20, 50, 100):
            r = client.get(
                f"/api/apartments/list?page_size={size}", headers=admin_headers
            )
            assert r.status_code == 200, r.text
        assert (
            client.get("/api/apartments/list?page_size=37", headers=admin_headers).status_code
            == 422
        )
        assert (
            client.get("/api/apartments/list?page=0", headers=admin_headers).status_code
            == 422
        )
