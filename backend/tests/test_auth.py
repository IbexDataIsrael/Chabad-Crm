def _register(
    client, username, password="pw12345", role="staff", full_name="דני", email=None
):
    body = {
        "username": username,
        "full_name": full_name,
        "password": password,
        "role": role,
    }
    if email:
        body["email"] = email
    return client.post("/api/auth/register", json=body)


def _login_token(client, username, password="pw12345"):
    resp = client.post(
        "/api/auth/token",
        data={"username": username, "password": password},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def test_register_login_and_me(client):
    r = _register(client, "user1")
    assert r.status_code == 201
    assert r.json()["role"] == "staff"
    assert "password_hash" not in r.json()
    # Registration creates an organization for the user.
    assert r.json()["organization_id"]

    token = _login_token(client, "user1")
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "user1"
    assert me.json()["organization"]["id"] == r.json()["organization_id"]


def test_duplicate_email_rejected(client):
    # Email is globally unique across organizations.
    assert _register(client, "u1", email="a@b.com").status_code == 201
    assert _register(client, "u2", email="a@b.com").status_code == 400


def test_login_wrong_password(client):
    _register(client, "user2", password="correct")
    r = client.post(
        "/api/auth/token",
        data={"username": "user2", "password": "wrong"},
    )
    assert r.status_code == 401


def test_me_without_token(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_invalid_token(client):
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


def test_require_admin_allows_admin(client):
    _register(client, "boss", role="admin")
    token = _login_token(client, "boss")
    r = client.get(
        "/api/_test/admin-only",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200


def test_require_admin_blocks_staff(client):
    _register(client, "worker", role="staff")
    token = _login_token(client, "worker")
    r = client.get(
        "/api/_test/admin-only",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403
