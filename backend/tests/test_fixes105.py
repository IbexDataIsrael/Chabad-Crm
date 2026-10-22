"""fixes105: usernames are unique per org case-insensitively; a username that
exists in several orgs gets the org picker at login."""


def _mk_user(client, headers, email, username=None):
    body = {"full_name": "Test", "email": email, "role": "staff", "password": "Passw0rd1"}
    if username is not None:
        body["username"] = username
    return client.post("/api/users", json=body, headers=headers)


def test_username_duplicate_is_case_insensitive_on_create(client, admin_headers):
    assert _mk_user(client, admin_headers, "a105@example.com", "Moshe").status_code == 201
    r = _mk_user(client, admin_headers, "b105@example.com", "moshe")
    assert r.status_code == 400, r.text


def test_username_duplicate_is_case_insensitive_on_update(client, admin_headers):
    assert _mk_user(client, admin_headers, "c105@example.com", "Yossi").status_code == 201
    other = _mk_user(client, admin_headers, "d105@example.com").json()
    r = client.put(f"/api/users/{other['id']}", json={"username": "YOSSI"}, headers=admin_headers)
    assert r.status_code == 400, r.text
    # Re-casing your own username is not a collision with yourself.
    r = client.put(f"/api/users/{other['id']}", json={"username": "D105@example.com"},
                   headers=admin_headers)
    assert r.status_code == 200, r.text


def _register(client, username, email):
    return client.post(
        "/api/auth/register",
        json={"username": username, "full_name": username, "password": "pw12345",
              "role": "admin", "email": email, "organization_name": f"org-{email}"},
    )


def test_same_username_in_two_orgs_asks_for_org(client):
    assert _register(client, "shared105", "x105@example.com").status_code == 201
    assert _register(client, "shared105", "y105@example.com").status_code == 201
    r = client.post("/api/auth/token", data={"username": "shared105", "password": "pw12345"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["requires_org_selection"] is True
    assert len(body["organizations"]) == 2
    org_id = body["organizations"][0]["id"]
    r2 = client.post(
        "/api/auth/token",
        data={"username": "shared105", "password": "pw12345", "organization_id": str(org_id)},
    )
    assert r2.json()["access_token"]
