"""fixes14 acceptance tests: user↔contact email sync, per-org email uniqueness,
multi-org login selection, contact-driven display name, shliach login
passwords, and the system access log."""
from app import models

_phone = [9000]


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _mk_shliach(client, headers, email, password=None, **overrides):
    _phone[0] += 1
    payload = {
        "name": "מנחם",
        "last_name": "לוי",
        "phone": f"050-77{_phone[0]:05d}",
        "contact_type": "shliach",
        "email": email,
        "shliach": {"area_ids": []},
    }
    if password:
        payload["shliach"]["password"] = password
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=headers)


def _register(client, username, email, password="pw12345"):
    return client.post(
        "/api/auth/register",
        json={
            "username": username,
            "full_name": username,
            "password": password,
            "role": "admin",
            "email": email,
            "organization_name": f"org-{username}",
        },
    )


def _login(client, username, password, organization_id=None):
    data = {"username": username, "password": password}
    if organization_id is not None:
        data["organization_id"] = str(organization_id)
    return client.post("/api/auth/token", data=data)


# --- Bug 1: contact → user email sync ---------------------------------------
def test_shliach_email_edit_syncs_login_user(client, admin_headers, db_session):
    contact = _mk_shliach(client, admin_headers, "old@example.com").json()
    r = client.put(
        f"/api/contacts/{contact['id']}",
        json={"email": "new@example.com"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text

    user = (
        db_session.query(models.User)
        .filter(models.User.email == "new@example.com")
        .one()
    )
    assert user.role == "shliach"
    # The username was the old email, so it follows the email.
    assert user.username == "new@example.com"
    assert (
        db_session.query(models.User)
        .filter(models.User.email == "old@example.com")
        .count()
        == 0
    )


def test_shliach_email_edit_rejects_same_org_duplicate(client, admin_headers):
    _mk_shliach(client, admin_headers, "one@example.com")
    other = _mk_shliach(client, admin_headers, "two@example.com").json()
    r = client.put(
        f"/api/contacts/{other['id']}",
        json={"email": "one@example.com"},
        headers=admin_headers,
    )
    assert r.status_code == 400


# --- Bug 2: email unique per org, free across orgs ---------------------------
def test_second_shliach_same_email_same_org_rejected(client, admin_headers):
    assert _mk_shliach(client, admin_headers, "dup@example.com").status_code == 201
    assert _mk_shliach(client, admin_headers, "dup@example.com").status_code == 400


def test_shliach_provisioning_never_links_across_orgs(
    client, admin_headers, db_session
):
    # The same email already has a login user in a *different* org.
    assert _register(client, "otherorg", "shared@example.com").status_code == 201
    # Creating a shliach with that email in the admin's org must create a
    # NEW org-local user, not link the foreign one (pre-fixes14 leak).
    assert (
        _mk_shliach(client, admin_headers, "shared@example.com").status_code == 201
    )
    users = (
        db_session.query(models.User)
        .filter(models.User.email == "shared@example.com")
        .all()
    )
    assert len(users) == 2
    org_id = _me(client, admin_headers)["organization_id"]
    local = [u for u in users if u.organization_id == org_id]
    assert len(local) == 1 and local[0].role == "shliach"


def test_org_user_create_duplicate_scoped_to_org(client, admin_headers):
    # Exists in another org → allowed here; exists here → rejected.
    assert _register(client, "faraway", "who@example.com").status_code == 201
    payload = {"full_name": "מי", "email": "who@example.com", "role": "staff"}
    assert (
        client.post("/api/users", json=payload, headers=admin_headers).status_code
        == 201
    )
    assert (
        client.post("/api/users", json=payload, headers=admin_headers).status_code
        == 400
    )


# --- Bug 3: user → contact sync ----------------------------------------------
def test_user_update_propagates_to_shliach_contact(
    client, admin_headers, db_session
):
    contact = _mk_shliach(client, admin_headers, "sync@example.com").json()
    user = (
        db_session.query(models.User)
        .filter(models.User.email == "sync@example.com")
        .one()
    )
    r = client.put(
        f"/api/users/{user.id}",
        json={"email": "synced@example.com", "phone": "050-7654321"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text

    refreshed = client.get(
        f"/api/contacts/{contact['id']}", headers=admin_headers
    ).json()
    assert refreshed["email"] == "synced@example.com"
    assert refreshed["phone"] == "050-7654321"


def test_user_update_cannot_demote_shliach_role(client, admin_headers, db_session):
    _mk_shliach(client, admin_headers, "role@example.com")
    user = (
        db_session.query(models.User)
        .filter(models.User.email == "role@example.com")
        .one()
    )
    r = client.put(
        f"/api/users/{user.id}",
        json={"full_name": "שם חדש", "role": "staff"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "shliach"


# --- Feature 1: multi-org login selection ------------------------------------
def test_multi_org_login_requires_selection(client, db_session):
    assert _register(client, "usera", "multi@example.com").status_code == 201
    assert _register(client, "userb", "multi@example.com").status_code == 201

    # Email + valid password spanning two orgs → org list, no token.
    r = _login(client, "multi@example.com", "pw12345")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["requires_org_selection"] is True
    assert body["access_token"] is None
    assert len(body["organizations"]) == 2

    # Explicit selection → a token scoped to that org.
    chosen = body["organizations"][1]
    r2 = _login(client, "multi@example.com", "pw12345", organization_id=chosen["id"])
    token = r2.json()["access_token"]
    assert token
    me = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert me["organization_id"] == chosen["id"]

    # A wrong password never reveals the organization list.
    r3 = _login(client, "multi@example.com", "wrong-pw")
    assert r3.status_code == 401
    assert "organizations" not in r3.json()


def test_single_org_login_unchanged(client):
    assert _register(client, "solo", "solo@example.com").status_code == 201
    r = _login(client, "solo", "pw12345")
    assert r.status_code == 200
    body = r.json()
    assert body["requires_org_selection"] is False
    assert body["access_token"]


# --- Feature 2: navbar name from the contacts table --------------------------
def test_me_display_name_comes_from_contact(client, admin_headers):
    _mk_shliach(
        client,
        admin_headers,
        "display@example.com",
        password="Secret123",
        name="שרה",
        last_name="כהן",
    )
    token = _login(client, "display@example.com", "Secret123").json()["access_token"]
    me = client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    ).json()
    assert me["display_name"] == "שרה כהן"


# --- Feature 3 + user report: shliach passwords & the access log -------------
def test_shliach_password_enables_login(client, admin_headers, db_session):
    # Created with a password → email + password sign-in works.
    _mk_shliach(client, admin_headers, "canlogin@example.com", password="Secret123")
    assert _login(client, "canlogin@example.com", "Secret123").status_code == 200

    # Created without one → clean 401 (not the pre-fixes14 500 on a None hash).
    contact = _mk_shliach(client, admin_headers, "nopass@example.com").json()
    assert _login(client, "nopass@example.com", "whatever1").status_code == 401

    # An admin sets the password from the contact form afterwards.
    r = client.put(
        f"/api/contacts/{contact['id']}",
        json={"shliach": {"area_ids": [], "password": "Later456"}},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    assert _login(client, "nopass@example.com", "Later456").status_code == 200


def test_every_login_attempt_writes_an_access_log_row(client, db_session):
    assert _register(client, "logged", "log@example.com").status_code == 201

    _login(client, "ghost", "nope-nope1")          # unknown identifier
    _login(client, "logged", "wrong-pw")           # bad password
    _login(client, "logged", "pw12345")            # success

    rows = db_session.query(models.SystemAccessLog).all()
    by_status = {(r.username, r.status) for r in rows}
    assert ("ghost", "FAILED_NO_USER") in by_status
    assert ("logged", "FAILED_INVALID_PASSWORD") in by_status
    assert ("logged", "SUCCESS") in by_status
    for r in rows:
        assert r.date is not None and r.time is not None


# --- Prod regression: mixed-case emails made /api/auth/google return 403 -----
def test_emails_are_stored_lowercase(client, admin_headers, db_session):
    # Google ID tokens always carry the address lowercased; a mixed-case stored
    # email made the (case-sensitive) login lookup miss → 403 in production.
    _mk_shliach(client, admin_headers, "MiXeD@Example.COM", password="Secret123")
    user = (
        db_session.query(models.User)
        .filter(models.User.email == "mixed@example.com")
        .one()
    )
    assert user.username == "mixed@example.com"
    assert _login(client, "mixed@example.com", "Secret123").status_code == 200
    # The typed identifier is matched case-insensitively as well.
    assert _login(client, "MIXED@example.com", "Secret123").status_code == 200


def test_legacy_mixed_case_email_row_still_logs_in(
    client, admin_headers, db_session
):
    from app.core.security import hash_password

    # A pre-normalization row, as found in production (uppercase in the email).
    org_id = _me(client, admin_headers)["organization_id"]
    db_session.add(
        models.User(
            organization_id=org_id,
            username="Legacy@Example.com",
            full_name="ותיק",
            email="Legacy@Example.com",
            password_hash=hash_password("pw12345"),
            role="staff",
            is_active=True,
            email_verified=True,
        )
    )
    db_session.commit()
    assert _login(client, "legacy@example.com", "pw12345").status_code == 200


def test_org_selection_is_logged(client, db_session):
    _register(client, "picka", "pick@example.com")
    _register(client, "pickb", "pick@example.com")
    _login(client, "pick@example.com", "pw12345")
    assert (
        db_session.query(models.SystemAccessLog)
        .filter_by(username="pick@example.com", status="ORG_SELECTION_REQUIRED")
        .count()
        == 1
    )
