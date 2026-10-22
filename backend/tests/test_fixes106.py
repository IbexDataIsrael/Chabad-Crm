"""fixes106: GET /api/apartments is paginated in SQL (it used to return the
whole org), and large responses are gzip-compressed."""


from tests.test_fixes7 import _mk_area, _mk_building


def _building(client, headers):
    """A one-floor building; returns (building_id, floor_id)."""
    area = _mk_area(client, headers)
    b = _mk_building(client, headers, area["id"], floors=["1"])
    return b["id"], b["floors"][0]["id"]


def _batch(client, headers, building, n):
    building_id, floor_id = building
    r = client.post(
        "/api/apartments/batch",
        json={"building_id": building_id, "floor_ids": [floor_id],
              "labels": [f"{i:03d}" for i in range(n)]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return building_id


def test_unfiltered_list_is_capped_by_limit(client, admin_headers):
    _batch(client, admin_headers, _building(client, admin_headers), 12)
    r = client.get("/api/apartments?limit=5", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 5


def test_offset_pages_do_not_overlap(client, admin_headers):
    b = _batch(client, admin_headers, _building(client, admin_headers), 12)
    first = client.get(f"/api/apartments?building_id={b}&limit=5", headers=admin_headers).json()
    second = client.get(f"/api/apartments?building_id={b}&limit=5&offset=5", headers=admin_headers).json()
    assert len(first) == 5 and len(second) == 5
    assert not {a["id"] for a in first} & {a["id"] for a in second}
    assert [a["apartment_name"] for a in first + second] == [f"{i:03d}" for i in range(10)]


def test_building_filtered_list_returns_the_whole_building(client, admin_headers):
    b = _batch(client, admin_headers, _building(client, admin_headers), 12)
    r = client.get(f"/api/apartments?building_id={b}", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()) == 12


def test_limit_bounds_are_enforced(client, admin_headers):
    assert client.get("/api/apartments?limit=1001", headers=admin_headers).status_code == 422
    assert client.get("/api/apartments?limit=0", headers=admin_headers).status_code == 422
    assert client.get("/api/apartments?offset=-1", headers=admin_headers).status_code == 422


def test_large_responses_are_gzipped(client, admin_headers):
    b = _batch(client, admin_headers, _building(client, admin_headers), 12)
    r = client.get("/api/apartments", headers={**admin_headers, "Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert len(r.json()) == 12  # the client transparently decompresses
