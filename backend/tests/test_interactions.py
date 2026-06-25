def _make_contact(client, auth_headers):
    return client.post(
        "/api/contacts",
        json={"name": "איש קשר", "phone": "050-9000001"},
        headers=auth_headers,
    ).json()["id"]


def test_interactions_require_auth(client):
    assert client.get("/api/interactions").status_code == 401


def test_create_list_and_delete_interaction(client, auth_headers):
    cid = _make_contact(client, auth_headers)
    r = client.post(
        "/api/interactions",
        json={"contact_id": cid, "category": "heart_connection", "note": "עשיתי, לבדוק שמה"},
        headers=auth_headers,
    )
    assert r.status_code == 201
    iid = r.json()["id"]
    assert r.json()["created_by"] is not None  # stamped with current user

    listing = client.get(f"/api/interactions?contact_id={cid}", headers=auth_headers).json()
    assert len(listing) == 1

    assert client.delete(f"/api/interactions/{iid}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/interactions?contact_id={cid}", headers=auth_headers).json() == []


def test_interaction_invalid_contact_fk(client, auth_headers):
    r = client.post(
        "/api/interactions",
        json={"contact_id": 99999, "category": "background", "note": "x"},
        headers=auth_headers,
    )
    assert r.status_code == 400


def test_interactions_newest_first(client, auth_headers):
    cid = _make_contact(client, auth_headers)
    first = client.post(
        "/api/interactions",
        json={"contact_id": cid, "category": "background", "note": "ראשון"},
        headers=auth_headers,
    ).json()["id"]
    second = client.post(
        "/api/interactions",
        json={"contact_id": cid, "category": "background", "note": "שני"},
        headers=auth_headers,
    ).json()["id"]
    ids = [x["id"] for x in client.get(f"/api/interactions?contact_id={cid}", headers=auth_headers).json()]
    assert ids == [second, first]
