"""Global search endpoint (/api/search): matching, scoping, and auth."""


def _admin_of(client, username, org_name):
    client.post(
        "/api/auth/register",
        json={
            "username": username,
            "full_name": username,
            "password": "pw12345",
            "role": "admin",
            "organization_name": org_name,
        },
    )
    token = client.post(
        "/api/auth/token", data={"username": username, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _seed_world(client, headers):
    """One area → building → apartment + a mekurav and a shliach contact."""
    area_id = client.post(
        "/api/areas",
        json={"area_name": "שכונת הפרחים", "area_notes": "ליד הפארק"},
        headers=headers,
    ).json()["id"]
    building_id = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_name": "מגדל הורדים", "building_address": "הרצל 12"},
        headers=headers,
    ).json()["id"]
    apartment_id = client.post(
        "/api/apartments",
        json={"building_id": building_id, "apartment_name": "דירת גן", "apartment_notes": "קומה 1"},
        headers=headers,
    ).json()["id"]
    mekurav_id = client.post(
        "/api/contacts",
        json={"name": "יוסי", "last_name": "כהן", "phone": "050-7770001"},
        headers=headers,
    ).json()["id"]
    shliach_id = client.post(
        "/api/contacts",
        json={
            "name": "מנחם",
            "phone": "050-7770002",
            "contact_type": "shliach",
            "email": "twin.shliach@example.com",
            "shliach": {"area_ids": [area_id], "apartment_ids": []},
        },
        headers=headers,
    ).json()["id"]
    return {
        "area": area_id,
        "building": building_id,
        "apartment": apartment_id,
        "mekurav": mekurav_id,
        "shliach": shliach_id,
    }


def _search(client, headers, q):
    r = client.get(f"/api/search?q={q}", headers=headers)
    assert r.status_code == 200
    return r.json()["results"]


def test_search_requires_auth(client):
    assert client.get("/api/search?q=abc").status_code == 401


def test_search_finds_each_entity_type(client, admin_headers):
    ids = _seed_world(client, admin_headers)

    hits = _search(client, admin_headers, "הפרחים")
    assert ("area", ids["area"]) in [(h["type"], h["id"]) for h in hits]

    hits = _search(client, admin_headers, "הורדים")
    assert ("building", ids["building"]) in [(h["type"], h["id"]) for h in hits]

    hits = _search(client, admin_headers, "דירת גן")
    assert ("apartment", ids["apartment"]) in [(h["type"], h["id"]) for h in hits]

    # Contact by first name (mekurav) and by phone (shliach, with contact_type).
    hits = _search(client, admin_headers, "יוסי")
    mekurav_hits = [h for h in hits if h["type"] == "contact" and h["id"] == ids["mekurav"]]
    assert mekurav_hits and mekurav_hits[0]["contact_type"] == "mekurav"

    hits = _search(client, admin_headers, "7770002")
    shliach_hits = [h for h in hits if h["type"] == "contact" and h["id"] == ids["shliach"]]
    assert shliach_hits and shliach_hits[0]["contact_type"] == "shliach"


def test_search_matches_notes_and_address(client, admin_headers):
    ids = _seed_world(client, admin_headers)
    # Area notes, building address, apartment notes are all searched.
    assert any(h["id"] == ids["area"] for h in _search(client, admin_headers, "ליד הפארק"))
    assert any(h["id"] == ids["building"] for h in _search(client, admin_headers, "הרצל"))
    assert any(h["id"] == ids["apartment"] for h in _search(client, admin_headers, "קומה 1"))


def test_search_subtitles_give_context(client, admin_headers):
    ids = _seed_world(client, admin_headers)
    (building_hit,) = [h for h in _search(client, admin_headers, "הורדים") if h["type"] == "building"]
    assert building_hit["subtitle"] == "שכונת הפרחים"
    (apartment_hit,) = [h for h in _search(client, admin_headers, "דירת גן") if h["type"] == "apartment"]
    assert apartment_hit["subtitle"] == "מגדל הורדים"


def test_short_or_empty_query_returns_nothing(client, admin_headers):
    _seed_world(client, admin_headers)
    assert _search(client, admin_headers, "") == []
    assert _search(client, admin_headers, "י") == []


def test_search_is_tenant_isolated(client):
    a = _admin_of(client, "search_a", "Search Org A")
    b = _admin_of(client, "search_b", "Search Org B")
    _seed_world(client, a)

    # Org B finds nothing from Org A's data.
    for q in ("הפרחים", "הורדים", "דירת גן", "יוסי"):
        assert _search(client, b, q) == []
