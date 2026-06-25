def _admin_of(client, username, org_name, email=None):
    body = {
        "username": username,
        "full_name": username,
        "password": "pw12345",
        "role": "admin",
        "organization_name": org_name,
    }
    if email:
        body["email"] = email
    client.post("/api/auth/register", json=body)
    token = client.post(
        "/api/auth/token", data={"username": username, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_contacts_isolated_between_orgs(client):
    a = _admin_of(client, "admin_a", "Org A")
    b = _admin_of(client, "admin_b", "Org B")

    cid = client.post(
        "/api/contacts", json={"name": "A-contact", "phone": "050-1230001"}, headers=a
    ).json()["id"]

    # Org A sees it; Org B does not.
    assert client.get(f"/api/contacts/{cid}", headers=a).status_code == 200
    assert client.get(f"/api/contacts/{cid}", headers=b).status_code == 404
    assert all(c["id"] != cid for c in client.get("/api/contacts", headers=b).json())


def test_users_scoped(client):
    a = _admin_of(client, "ra", "Org RA")
    b = _admin_of(client, "rb", "Org RB")

    # Each org only lists its own users.
    assert [u["username"] for u in client.get("/api/users", headers=a).json()] == ["ra"]
    assert [u["username"] for u in client.get("/api/users", headers=b).json()] == ["rb"]


def test_picklist_options_isolated(client):
    a = _admin_of(client, "pa", "Org PA")
    b = _admin_of(client, "pb", "Org PB")

    client.post(
        "/api/picklists/contact.color_tag",
        json={"value": "magenta", "hebrew_label": "מגנטה"},
        headers=a,
    )
    # The registry of field_keys is global, but the OPTIONS are per-org.
    assert client.get("/api/picklists/contact.color_tag", headers=a).json()  # has 1
    assert client.get("/api/picklists/contact.color_tag", headers=b).json() == []


def test_username_unique_per_org_but_reusable_across_orgs(client):
    assert (
        client.post(
            "/api/auth/register",
            json={
                "username": "dup",
                "full_name": "x",
                "password": "pw12345",
                "role": "admin",
                "organization_name": "A",
            },
        ).status_code
        == 201
    )
    # Same username in a different org is fine.
    assert (
        client.post(
            "/api/auth/register",
            json={
                "username": "dup",
                "full_name": "x",
                "password": "pw12345",
                "role": "admin",
                "organization_name": "B",
            },
        ).status_code
        == 201
    )
