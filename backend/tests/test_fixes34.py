"""Fixes34 acceptance tests: contacts gain the same generic `picklist_values`
dict apartments already had (fixes32) — a custom, admin-added contact
picklist now round-trips through both GET /api/contacts and
GET /api/contacts/list, and can filter the list via the generic `picklist`
query param (mirrors apartments' `picklist=field_key:value`)."""


# --- Builders ----------------------------------------------------------------
def _mk_mekurav(client, headers, name, **extra):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _add_picklist(
    client, headers, system_name, hebrew="בדיקה34", values=None, entity_type="contact_mekurav"
):
    r = client.post(
        "/api/picklists/definition",
        json={
            "system_name": system_name,
            "hebrew_display_name": hebrew,
            "entity_type": entity_type,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    for v in values or []:
        r = client.post(
            f"/api/picklists/{system_name}",
            json={"value": v, "hebrew_label": v},
            headers=headers,
        )
        assert r.status_code == 201, r.text
    return system_name


class TestCustomContactPicklistValues:
    def test_round_trips_through_detail_get(self, client, admin_headers):
        _add_picklist(client, admin_headers, "diet34", values=["kosher", "vegan"])
        c = _mk_mekurav(client, admin_headers, "בדיקת פיקליסט")
        r = client.patch(
            f"/api/contacts/{c['id']}",
            json={"picklist_values": {"diet34": "kosher"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        r = client.get(f"/api/contacts/{c['id']}", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["picklist_values"]["diet34"] == "kosher"

    def test_round_trips_through_list_and_paginated_list(self, client, admin_headers):
        _add_picklist(client, admin_headers, "diet34b", values=["kosher", "vegan"])
        c = _mk_mekurav(client, admin_headers, "בדיקת פיקליסט רשימה")
        client.patch(
            f"/api/contacts/{c['id']}",
            json={"picklist_values": {"diet34b": "vegan"}},
            headers=admin_headers,
        )

        r = client.get("/api/contacts?contact_type=mekurav", headers=admin_headers)
        assert r.status_code == 200, r.text
        row = next(x for x in r.json() if x["id"] == c["id"])
        assert row["picklist_values"]["diet34b"] == "vegan"

        r = client.get(
            "/api/contacts/list?contact_type=mekurav", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        row = next(x for x in r.json()["items"] if x["id"] == c["id"])
        assert row["picklist_values"]["diet34b"] == "vegan"

    def test_pipeline_status_and_color_tag_stay_on_their_own_fields(
        self, client, admin_headers
    ):
        # The generic dict must not duplicate the two fields that already
        # have dedicated ContactOut columns (mirrors apartments' 4 fixed keys).
        c = _mk_mekurav(client, admin_headers, "בדיקת שדות קבועים")
        client.patch(
            f"/api/contacts/{c['id']}",
            json={"pipeline_status": None},
            headers=admin_headers,
        )
        r = client.get(f"/api/contacts/{c['id']}", headers=admin_headers)
        assert "contact.pipeline_status" not in r.json()["picklist_values"]
        assert "contact.color_tag" not in r.json()["picklist_values"]


class TestCustomContactPicklistFilter:
    def test_filters_the_list_by_field_key_value(self, client, admin_headers):
        _add_picklist(client, admin_headers, "diet34c", values=["kosher", "vegan"])
        kosher = _mk_mekurav(client, admin_headers, "שומר כשרות")
        client.patch(
            f"/api/contacts/{kosher['id']}",
            json={"picklist_values": {"diet34c": "kosher"}},
            headers=admin_headers,
        )
        vegan = _mk_mekurav(client, admin_headers, "טבעוני")
        client.patch(
            f"/api/contacts/{vegan['id']}",
            json={"picklist_values": {"diet34c": "vegan"}},
            headers=admin_headers,
        )

        r = client.get(
            "/api/contacts/list?contact_type=mekurav&picklist=diet34c:kosher",
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        ids = [x["id"] for x in r.json()["items"]]
        assert kosher["id"] in ids
        assert vegan["id"] not in ids


class TestPhoneEmailVisibilityToggle:
    """fixes34 §3.1: phone/email now have a field-settings toggle. The
    toggle only ever governs UI rendering — it never touches the DB column
    or CRUD behavior, so the round-trip below must keep working either way."""

    def test_email_and_phone_are_toggleable_and_dont_break_crud(
        self, client, admin_headers
    ):
        r = client.get("/api/field-settings", headers=admin_headers)
        keys = [f["field_key"] for f in r.json()]
        assert "contacts.phone" in keys
        assert "contacts.email" in keys

        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.phone", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        c = _mk_mekurav(
            client, admin_headers, "בדיקת נראות", phone="0501234567", email="v34@x.com"
        )
        assert c["phone"] == "0501234567"
        assert c["email"] == "v34@x.com"

        client.put(
            "/api/field-settings",
            json={"field_key": "contacts.phone", "is_visible": True},
            headers=admin_headers,
        )
