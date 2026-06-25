def _make_contact(client, headers, phone="050-8000001"):
    return client.post(
        "/api/contacts",
        json={"name": "איש", "phone": phone},
        headers=headers,
    ).json()["id"]


def test_custom_fields_require_auth(client):
    assert client.get("/api/custom-fields").status_code == 401


def test_admin_crud_definition_staff_forbidden(client, admin_headers, auth_headers):
    # Staff cannot create
    assert (
        client.post(
            "/api/custom-fields",
            json={"field_key": "x", "hebrew_label": "איקס"},
            headers=auth_headers,
        ).status_code
        == 403
    )

    # Admin creates
    r = client.post(
        "/api/custom-fields",
        json={"field_key": "hanuka_party", "hebrew_label": "מסיבת חנוכה"},
        headers=admin_headers,
    )
    assert r.status_code == 201
    did = r.json()["id"]
    assert r.json()["guid"]

    # Duplicate key rejected
    dup = client.post(
        "/api/custom-fields",
        json={"field_key": "hanuka_party", "hebrew_label": "שוב"},
        headers=admin_headers,
    )
    assert dup.status_code == 400

    # Update label
    upd = client.put(
        f"/api/custom-fields/{did}",
        json={"hebrew_label": "מסיבת חנוכה גדולה"},
        headers=admin_headers,
    )
    assert upd.json()["hebrew_label"] == "מסיבת חנוכה גדולה"

    # Soft delete hides it
    client.delete(f"/api/custom-fields/{did}", headers=admin_headers)
    assert client.get("/api/custom-fields", headers=admin_headers).json() == []


def test_contact_custom_field_values(client, admin_headers):
    did = client.post(
        "/api/custom-fields",
        json={"field_key": "hanuka_party", "hebrew_label": "מסיבת חנוכה"},
        headers=admin_headers,
    ).json()["id"]
    cid = _make_contact(client, admin_headers)

    # GET returns the active definition with default (unchecked) value.
    fields = client.get(f"/api/contacts/{cid}/custom-fields", headers=admin_headers).json()
    assert len(fields) == 1
    assert fields[0]["definition_id"] == did
    assert fields[0]["checked"] is False

    # PUT sets the value.
    saved = client.put(
        f"/api/contacts/{cid}/custom-fields",
        json=[{"definition_id": did, "checked": True, "note": "הגיע"}],
        headers=admin_headers,
    ).json()
    assert saved[0]["checked"] is True
    assert saved[0]["note"] == "הגיע"

    # Persisted.
    again = client.get(f"/api/contacts/{cid}/custom-fields", headers=admin_headers).json()
    assert again[0]["checked"] is True


def test_checklist_notes_roundtrip(client, auth_headers):
    cid = _make_contact(client, auth_headers, phone="050-8000099")
    upd = client.put(
        f"/api/contacts/{cid}/checklist",
        json={
            "tefillin": True,
            "tefillin_notes": "הניח",
            "shabbat_candles_notes": "מדליקה",
            "torah_pamphlet_notes": "קיבל",
        },
        headers=auth_headers,
    ).json()
    assert upd["tefillin_notes"] == "הניח"
    assert upd["shabbat_candles_notes"] == "מדליקה"
    assert upd["torah_pamphlet_notes"] == "קיבל"


def test_custom_fields_isolated_between_orgs(client, admin_headers):
    client.post(
        "/api/custom-fields",
        json={"field_key": "only_a", "hebrew_label": "רק א"},
        headers=admin_headers,
    )
    # A second org (fresh admin) sees none.
    client.post(
        "/api/auth/register",
        json={
            "username": "other",
            "full_name": "x",
            "password": "pw12345",
            "role": "admin",
            "organization_name": "Other",
        },
    )
    tok = client.post(
        "/api/auth/token", data={"username": "other", "password": "pw12345"}
    ).json()["access_token"]
    other = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/custom-fields", headers=other).json() == []
