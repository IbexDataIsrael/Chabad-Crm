"""Tests for the fixes4 work: RBAC, dynamic picklists, visits, donations,
shliach multi-area, picklist definitions, and bilingual localization."""
from app import models
from app.core.security import hash_password
from app.seed import seed_picklist_definitions, seed_picklists


def _org_id(client, headers):
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


_phone = [5000]


def _make_mekurav(client, headers, **overrides):
    _phone[0] += 1
    payload = {"name": "מקורב", "phone": f"050-77{_phone[0]:05d}", "contact_type": "mekurav"}
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=headers)


def _shliach_headers(client, db_session, admin_headers):
    """Create an active shliach login in the admin's org and return its header."""
    org_id = _org_id(client, admin_headers)
    user = models.User(
        organization_id=org_id,
        username="shliachlogin",
        full_name="שליח",
        email="shliachlogin@example.com",
        password_hash=hash_password("pw12345"),
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "shliachlogin", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- RBAC: shliach contact creation (fixes10 §3.3/§3.4) ---------------------
def test_shliach_creates_mekurav_with_forced_ownership(
    client, admin_headers, db_session
):
    headers = _shliach_headers(client, db_session, admin_headers)
    r = client.post(
        "/api/contacts",
        json={"name": "x", "phone": "050-7700001", "contact_type": "mekurav"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    login_user = (
        db_session.query(models.User)
        .filter(models.User.username == "shliachlogin")
        .one()
    )
    assert r.json()["assigned_user_id"] == login_user.guid
    # But a shliach may not create shliach contacts (user provisioning).
    r = client.post(
        "/api/contacts",
        json={"name": "y", "phone": "050-7700002", "contact_type": "shliach"},
        headers=headers,
    )
    assert r.status_code == 403


def test_staff_and_admin_can_create_contact(client, auth_headers, admin_headers):
    assert _make_mekurav(client, auth_headers).status_code == 201
    assert _make_mekurav(client, admin_headers).status_code == 201


# --- Dynamic picklist values -----------------------------------------------
def test_dynamic_picklist_values(client, admin_headers, db_session):
    org_id = _org_id(client, admin_headers)
    seed_picklist_definitions(db_session, org_id)
    seed_picklists(db_session, org_id)

    cid = _make_mekurav(
        client,
        admin_headers,
        picklist_values={"Jewish_status": "jewish", "language": "hebrew"},
    ).json()["id"]

    body = client.get(f"/api/contacts/{cid}", headers=admin_headers).json()
    assert body["picklist_values"]["Jewish_status"] == "jewish"
    assert body["picklist_values"]["language"] == "hebrew"

    # Update one (to a valid Jewish_status value), clear the other (null removes it).
    upd = client.put(
        f"/api/contacts/{cid}",
        json={"picklist_values": {"Jewish_status": "jewish_interested", "language": None}},
        headers=admin_headers,
    )
    assert upd.status_code == 200
    body = client.get(f"/api/contacts/{cid}", headers=admin_headers).json()
    assert body["picklist_values"] == {"Jewish_status": "jewish_interested"}

    # Invalid value is rejected.
    bad = client.put(
        f"/api/contacts/{cid}",
        json={"picklist_values": {"Jewish_status": "bogus"}},
        headers=admin_headers,
    )
    assert bad.status_code == 400


# --- Visit history ----------------------------------------------------------
def test_visit_history_crud(client, admin_headers):
    cid = _make_mekurav(client, admin_headers).json()["id"]
    add = client.post(
        f"/api/contacts/{cid}/visits",
        json={"visit_date": "2026-07-01T10:00:00", "notes": "first"},
        headers=admin_headers,
    )
    assert add.status_code == 201
    vid = add.json()["id"]

    rows = client.get(f"/api/contacts/{cid}/visits", headers=admin_headers).json()
    assert len(rows) == 1 and rows[0]["notes"] == "first"

    client.put(
        f"/api/contacts/{cid}/visits/{vid}",
        json={"notes": "updated"},
        headers=admin_headers,
    )
    rows = client.get(f"/api/contacts/{cid}/visits", headers=admin_headers).json()
    assert rows[0]["notes"] == "updated"

    assert (
        client.delete(f"/api/contacts/{cid}/visits/{vid}", headers=admin_headers).status_code
        == 204
    )
    assert client.get(f"/api/contacts/{cid}/visits", headers=admin_headers).json() == []


# --- Donations --------------------------------------------------------------
def test_donations_admin_only(client, auth_headers):
    # Staff cannot access donations.
    assert client.get("/api/donations", headers=auth_headers).status_code == 403
    assert (
        client.post(
            "/api/donations",
            json={"donation_date": "2026-07-01T00:00:00", "amount": 10},
            headers=auth_headers,
        ).status_code
        == 403
    )


def test_donations_linked_and_contactless(client, admin_headers):
    cid = _make_mekurav(client, admin_headers).json()["id"]
    linked = client.post(
        "/api/donations",
        json={
            "contact_id": cid,
            "donation_date": "2026-07-02T00:00:00",
            "amount": 500,
            "is_ongoing": True,
            "number_of_payments": 12,
        },
        headers=admin_headers,
    )
    assert linked.status_code == 201
    assert linked.json()["contact_name"]  # resolved from the contact

    # Contact-less donation is allowed.
    assert (
        client.post(
            "/api/donations",
            json={"donation_date": "2026-07-03T00:00:00", "amount": 100},
            headers=admin_headers,
        ).status_code
        == 201
    )

    assert len(client.get("/api/donations", headers=admin_headers).json()) == 2
    assert len(client.get(f"/api/donations?contact_id={cid}", headers=admin_headers).json()) == 1


# --- Shliach multi-area -----------------------------------------------------
def test_shliach_area_multi(client, admin_headers):
    a1 = client.post("/api/areas", json={"area_name": "צפון"}, headers=admin_headers).json()["id"]
    a2 = client.post("/api/areas", json={"area_name": "דרום"}, headers=admin_headers).json()["id"]
    _phone[0] += 1
    sh = client.post(
        "/api/contacts",
        json={
            "name": "שליח",
            "phone": f"050-66{_phone[0]:05d}",
            "contact_type": "shliach",
            "email": "sh.area@example.com",
            "shliach": {"area_ids": [a1, a2], "apartment_ids": []},
        },
        headers=admin_headers,
    )
    assert sh.status_code == 201
    assert set(sh.json()["shliach"]["area_ids"]) == {a1, a2}

    # The area's shluchim list includes the directly-assigned shliach.
    covering = client.get(f"/api/areas/{a1}/shluchim", headers=admin_headers).json()
    assert any(c["name"] == "שליח" for c in covering)


def test_shliach_sees_only_covered_areas(client, admin_headers, db_session):
    """A shliach user's GET /api/areas is limited to areas they cover; admins see all."""
    a1 = client.post("/api/areas", json={"area_name": "אזור-שלי"}, headers=admin_headers).json()["id"]
    a2 = client.post("/api/areas", json={"area_name": "אזור-אחר"}, headers=admin_headers).json()["id"]

    headers = _shliach_headers(client, db_session, admin_headers)
    login_user = (
        db_session.query(models.User).filter(models.User.username == "shliachlogin").one()
    )

    _phone[0] += 1
    sh = client.post(
        "/api/contacts",
        json={
            "name": "שליח",
            "phone": f"050-55{_phone[0]:05d}",
            "contact_type": "shliach",
            "email": "sh.covered@example.com",
            "shliach": {"area_ids": [a1], "apartment_ids": []},
        },
        headers=admin_headers,
    ).json()

    # Link the shliach login to the shliach contact record.
    cs = (
        db_session.query(models.ContactShliach)
        .filter(models.ContactShliach.contact_id == sh["id"])
        .one()
    )
    cs.user_id = login_user.id
    db_session.commit()

    # Admin sees both areas; the shliach sees only the one they cover.
    admin_ids = {a["id"] for a in client.get("/api/areas", headers=admin_headers).json()}
    assert {a1, a2} <= admin_ids

    shliach_areas = client.get("/api/areas", headers=headers).json()
    assert [a["id"] for a in shliach_areas] == [a1]

    # And they can't read an area they don't cover.
    assert client.get(f"/api/areas/{a2}", headers=headers).status_code == 404
    assert client.get(f"/api/areas/{a1}", headers=headers).status_code == 200


# --- Picklist definitions ---------------------------------------------------
def test_picklist_definition_management(client, admin_headers, db_session):
    seed_picklist_definitions(db_session, _org_id(client, admin_headers))

    created = client.post(
        "/api/picklists/definition",
        json={"system_name": "diet", "hebrew_display_name": "תזונה", "english_display_name": "Diet"},
        headers=admin_headers,
    )
    assert created.status_code == 201
    assert created.json()["is_system"] is False
    did = created.json()["id"]

    keys = [d["field_key"] for d in client.get("/api/picklists", headers=admin_headers).json()]
    assert "diet" in keys and "contact.pipeline_status" in keys

    # System list cannot be deleted; custom one can.
    sys_id = next(
        d["id"]
        for d in client.get("/api/picklists", headers=admin_headers).json()
        if d["field_key"] == "contact.pipeline_status"
    )
    assert client.delete(f"/api/picklists/definition/{sys_id}", headers=admin_headers).status_code == 400
    assert client.delete(f"/api/picklists/definition/{did}", headers=admin_headers).status_code == 204


# --- Bilingual localization + admin edit ------------------------------------
def test_localization_bilingual_and_edit(client, admin_headers, db_session):
    from app.seed import seed_localization

    seed_localization(db_session)
    data = client.get("/api/metadata/localization").json()
    assert "he" in data["action.save"] and "en" in data["action.save"]

    # Admin can edit a string.
    rows = client.get("/api/localization", headers=admin_headers).json()
    row = next(r for r in rows if r["technical_name"] == "action.save")
    upd = client.put(
        f"/api/localization/{row['id']}",
        json={"english_label": "Store"},
        headers=admin_headers,
    )
    assert upd.status_code == 200
    assert upd.json()["english_label"] == "Store"
