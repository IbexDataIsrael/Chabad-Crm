def test_org_settings_require_auth(client):
    assert client.get("/api/organizations/me").status_code == 401


def test_get_and_update_org(client, admin_headers):
    org = client.get("/api/organizations/me", headers=admin_headers).json()
    assert "name" in org
    assert org["map_in_english"] is False

    upd = client.put(
        "/api/organizations/me",
        json={"name": "שם חדש", "map_in_english": True},
        headers=admin_headers,
    )
    assert upd.status_code == 200
    assert upd.json()["name"] == "שם חדש"
    assert upd.json()["map_in_english"] is True


def test_staff_cannot_update_org(client, auth_headers):
    r = client.put(
        "/api/organizations/me",
        json={"map_in_english": True},
        headers=auth_headers,
    )
    assert r.status_code == 403


def test_me_includes_map_setting(client, admin_headers):
    me = client.get("/api/auth/me", headers=admin_headers).json()
    assert "map_in_english" in me["organization"]
