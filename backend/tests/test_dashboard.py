"""Admin dashboard summary (GET /api/dashboard/summary) — chat-originated, no
fixesN spec. Covers the auth gate (staff/admin yes, shliach no), the
new-contacts/new-apartments counts, activist (shliach) edit counting, and the
Jewish-status change detection (only a real value change counts, not every
edit; old/new values and the breakdown reflect the actual picklist change)."""


# --- Builders (repo convention: each test file owns its own small helpers,
# see test_fixes52.py/test_fixes54.py) -----------------------------------
def _mk_area(client, headers, name="שכונה דשבורד"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Dashboard St, City"):
    r = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_address": address, "floors": ["1"]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_apartment(client, headers, building_id, **kw):
    r = client.post(
        "/api/apartments", json={"building_id": building_id, **kw}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_contact(client, headers, name, **kw):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **kw},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email, area_ids):
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל דשבורד",
            "contact_type": "shliach",
            "email": email,
            "shliach": {"area_ids": area_ids, "password": "pw12345"},
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _shliach_login(client, email):
    token = client.post(
        "/api/auth/token", data={"username": email, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _summary(client, headers, days=30):
    r = client.get(f"/api/dashboard/summary?days={days}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --- Auth gate -----------------------------------------------------------
def test_shliach_forbidden(client, admin_headers):
    area = _mk_area(client, admin_headers)
    shliach = _mk_shliach(client, admin_headers, "guard@example.com", [area["id"]])
    headers = _shliach_login(client, shliach["email"])
    r = client.get("/api/dashboard/summary", headers=headers)
    assert r.status_code == 403


def test_staff_allowed(client, auth_headers):
    body = _summary(client, auth_headers)
    assert body["range_days"] == 30


# --- Counts ----------------------------------------------------------------
def test_new_contact_counted(client, admin_headers):
    before = _summary(client, admin_headers)["new_contacts"]["value"]
    _mk_contact(client, admin_headers, "איש קשר דשבורד")
    after = _summary(client, admin_headers)["new_contacts"]["value"]
    assert after == before + 1


def test_new_apartment_counted(client, admin_headers):
    area = _mk_area(client, admin_headers)
    building = _mk_building(client, admin_headers, area["id"])
    before = _summary(client, admin_headers)["new_apartments"]["value"]
    _mk_apartment(client, admin_headers, building["id"])
    after = _summary(client, admin_headers)["new_apartments"]["value"]
    assert after == before + 1


# --- Activist activity + Jewish-status change detection --------------------
def test_activist_edit_and_jewish_status_change(client, admin_headers):
    area = _mk_area(client, admin_headers)
    building = _mk_building(client, admin_headers, area["id"])
    apartment = _mk_apartment(client, admin_headers, building["id"])
    shliach = _mk_shliach(client, admin_headers, "editor@example.com", [area["id"]])
    shliach_headers = _shliach_login(client, shliach["email"])

    before = _summary(client, admin_headers)
    assert before["activist_edits"]["value"] == 0
    assert before["jewish_status_changes"]["value"] == 0

    # Edit an unrelated field only — counts as activist activity, but must
    # NOT register as a Jewish-status change (no value actually changed).
    r = client.put(
        f"/api/apartments/{apartment['id']}",
        json={"apartment_notes": "ביקרתי היום"},
        headers=shliach_headers,
    )
    assert r.status_code == 200, r.text
    mid = _summary(client, admin_headers)
    assert mid["activist_edits"]["value"] == 1
    assert mid["jewish_status_changes"]["value"] == 0

    # Now actually change the Jewish status — must register as exactly one
    # change, with the correct old/new values and editor name.
    apartment_v2 = r.json()
    r2 = client.put(
        f"/api/apartments/{apartment_v2['id']}",
        json={"jewish_status": "jewish"},
        headers=shliach_headers,
    )
    assert r2.status_code == 200, r2.text

    after = _summary(client, admin_headers)
    assert after["activist_edits"]["value"] == 2
    assert after["jewish_status_changes"]["value"] == 1
    assert after["top_activists"][0]["name"] == "פעיל דשבורד"
    assert after["top_activists"][0]["edits"] == 2

    change = after["recent_jewish_changes"][0]
    assert change["old_value"] is None
    assert change["new_value"] == "jewish"
    assert change["editor_name"] == "פעיל דשבורד"

    breakdown = {b["value"]: b["count"] for b in after["jewish_status_breakdown"]}
    assert breakdown == {"jewish": 1}


def test_admin_edit_not_counted_as_activist(client, admin_headers):
    area = _mk_area(client, admin_headers)
    building = _mk_building(client, admin_headers, area["id"])
    apartment = _mk_apartment(client, admin_headers, building["id"])

    client.put(
        f"/api/apartments/{apartment['id']}",
        json={"jewish_status": "jewish"},
        headers=admin_headers,
    )
    after = _summary(client, admin_headers)
    # The change is real (counted), but the editor was an admin, not a
    # shliach — activist_edits must stay at 0.
    assert after["jewish_status_changes"]["value"] == 1
    assert after["activist_edits"]["value"] == 0
    assert after["top_activists"] == []
