"""Fixes12 acceptance tests: paginated buildings list (§3.3)."""


def _mk_area(client, headers, name="שכונה יב"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address):
    r = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_address": address, "floors": []},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_buildings_list_pagination(client, admin_headers):
    area = _mk_area(client, admin_headers)
    other_area = _mk_area(client, admin_headers, "שכונה אחרת")
    for n in range(25):
        _mk_building(client, admin_headers, area["id"], f"{n + 10:02d} Page St")
    _mk_building(client, admin_headers, other_area["id"], "99 Other St")

    page1 = client.get(
        "/api/buildings/list?page=1&page_size=20", headers=admin_headers
    ).json()
    assert set(page1) == {"items", "total", "page", "page_size"}
    assert page1["total"] == 26 and len(page1["items"]) == 20
    page2 = client.get(
        "/api/buildings/list?page=2&page_size=20", headers=admin_headers
    ).json()
    assert len(page2["items"]) == 6
    # Ordered by address; pages disjoint and complete.
    addrs = [b["building_address"] for b in page1["items"] + page2["items"]]
    assert addrs == sorted(addrs) and len(set(addrs)) == 26

    # Area filter still bounds the page.
    filtered = client.get(
        f"/api/buildings/list?area_id={other_area['id']}", headers=admin_headers
    ).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["building_address"] == "99 Other St"

    # Only supported page sizes.
    assert (
        client.get("/api/buildings/list?page_size=37", headers=admin_headers).status_code
        == 422
    )
    # The static /list segment must not be swallowed by /{building_id}.
    assert client.get("/api/buildings/list", headers=admin_headers).status_code == 200
