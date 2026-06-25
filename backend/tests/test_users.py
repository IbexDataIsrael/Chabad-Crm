def test_users_require_auth(client):
    assert client.get("/api/users").status_code == 401


def test_list_users(client, auth_headers):
    r = client.get("/api/users", headers=auth_headers)
    assert r.status_code == 200
    usernames = [u["username"] for u in r.json()]
    assert "staff1" in usernames  # created by the auth_headers fixture
    # password hash never exposed
    assert all("password_hash" not in u for u in r.json())
