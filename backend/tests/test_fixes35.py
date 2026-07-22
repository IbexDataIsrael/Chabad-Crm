"""Fixes35 acceptance tests: custom fields generalized from visit-only
boolean+note to any of contact_mekurav/contact_shliach/visit/apartment x
text/number/boolean/date/select."""


# --- Builders ----------------------------------------------------------------
def _mk_mekurav(client, headers, name, **extra):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(1000, 4999))


def _mk_shliach(client, headers, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 35",
            "phone": f"0554{next(_seq):06d}",
            "contact_type": "shliach",
            "email": f"shliach35-{next(_seq)}@example.com",
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_area(client, headers, name="שכונה 35"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="10 Fixes35 St, City"):
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


def _mk_field(client, headers, entity_type, field_type, field_key, **kw):
    payload = {
        "field_key": field_key,
        "hebrew_label": "שדה בדיקה",
        "entity_type": entity_type,
        "field_type": field_type,
        **kw,
    }
    r = client.post("/api/custom-fields", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


class TestCustomFieldDefinitions:
    def test_field_key_unique_per_entity_type_not_per_org(self, client, admin_headers):
        _mk_field(client, admin_headers, "apartment", "text", "shared_key35")
        # Same key, different entity_type — must be allowed now.
        _mk_field(client, admin_headers, "contact_mekurav", "text", "shared_key35")
        r = client.post(
            "/api/custom-fields",
            json={
                "field_key": "shared_key35",
                "hebrew_label": "כפול",
                "entity_type": "apartment",
                "field_type": "text",
            },
            headers=admin_headers,
        )
        assert r.status_code == 400, r.text

    def test_unknown_entity_or_field_type_rejected(self, client, admin_headers):
        r = client.post(
            "/api/custom-fields",
            json={
                "field_key": "x35",
                "hebrew_label": "x",
                "entity_type": "not_a_real_entity",
                "field_type": "text",
            },
            headers=admin_headers,
        )
        assert r.status_code == 400
        r = client.post(
            "/api/custom-fields",
            json={
                "field_key": "y35",
                "hebrew_label": "y",
                "entity_type": "apartment",
                "field_type": "not_a_real_type",
            },
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_list_filters_by_entity_type(self, client, admin_headers):
        _mk_field(client, admin_headers, "visit", "number", "vf35")
        r = client.get("/api/custom-fields?entity_type=visit", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert any(d["field_key"] == "vf35" for d in r.json())
        assert all(d["entity_type"] == "visit" for d in r.json())


class TestSelectTypeProvisionsPicklist:
    def test_select_field_creates_picklist_definition_and_options(
        self, client, admin_headers
    ):
        _mk_field(
            client, admin_headers, "apartment", "select", "diet35",
            picklist_options=["kosher", "vegan"],
        )
        r = client.get("/api/picklists/apartment.diet35", headers=admin_headers)
        assert r.status_code == 200, r.text
        values = {v["value"] for v in r.json()}
        assert values == {"kosher", "vegan"}

    def test_shliach_select_field_uses_shliach_prefix_and_entity(
        self, client, admin_headers
    ):
        _mk_field(
            client, admin_headers, "contact_shliach", "select", "role35",
            picklist_options=["driver", "cook"],
        )
        r = client.get("/api/picklists/shliach.role35", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert {v["value"] for v in r.json()} == {"driver", "cook"}

        settings = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(s for s in settings if s["field_key"] == "shliach.role35")
        assert row["entity"] == "contact_shliach"

    def test_select_field_never_writes_custom_field_value(self, client, admin_headers):
        _mk_field(
            client, admin_headers, "apartment", "select", "diet35b",
            picklist_options=["kosher"],
        )
        area = _mk_area(client, admin_headers)
        building = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(client, admin_headers, building["id"])
        r = client.put(
            f"/api/apartments/{apt['id']}",
            json={"picklist_values": {"apartment.diet35b": "kosher"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["picklist_values"]["apartment.diet35b"] == "kosher"
        # Never appears in custom_field_values (select fields don't live there).
        assert "diet35b" not in r.json()["custom_field_values"]


class TestApartmentCustomFieldValues:
    def test_text_number_boolean_date_round_trip(self, client, admin_headers):
        _mk_field(client, admin_headers, "apartment", "text", "notes35")
        _mk_field(client, admin_headers, "apartment", "number", "score35")
        _mk_field(client, admin_headers, "apartment", "boolean", "flag35")
        _mk_field(client, admin_headers, "apartment", "date", "checkin35")
        area = _mk_area(client, admin_headers)
        building = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(
            client, admin_headers, building["id"],
            custom_field_values={
                "notes35": "hello",
                "score35": 4.5,
                "flag35": True,
                "checkin35": "2026-01-15",
            },
        )
        cfv = apt["custom_field_values"]
        assert cfv["notes35"] == "hello"
        assert cfv["score35"] == 4.5
        assert cfv["flag35"] is True
        assert cfv["checkin35"] == "2026-01-15"

        r = client.get(f"/api/apartments/{apt['id']}", headers=admin_headers)
        assert r.json()["custom_field_values"] == cfv

    def test_survives_versioned_update_via_copy(self, client, admin_headers):
        _mk_field(client, admin_headers, "apartment", "text", "persist35")
        area = _mk_area(client, admin_headers)
        building = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(
            client, admin_headers, building["id"],
            custom_field_values={"persist35": "keep me"},
        )
        r = client.put(
            f"/api/apartments/{apt['id']}",
            json={"floor": "2"},  # unrelated change
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        new_apt = r.json()
        assert new_apt["id"] != apt["id"]  # versioned — new active row
        assert new_apt["custom_field_values"]["persist35"] == "keep me"

    def test_number_type_rejects_non_numeric(self, client, admin_headers):
        _mk_field(client, admin_headers, "apartment", "number", "num35")
        area = _mk_area(client, admin_headers)
        building = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(client, admin_headers, building["id"])
        r = client.put(
            f"/api/apartments/{apt['id']}",
            json={"custom_field_values": {"num35": "not-a-number"}},
            headers=admin_headers,
        )
        assert r.status_code == 400


class TestContactCustomFieldValues:
    def test_mekurav_and_shliach_stay_isolated(self, client, admin_headers):
        _mk_field(client, admin_headers, "contact_mekurav", "text", "mek35")
        _mk_field(client, admin_headers, "contact_shliach", "text", "sh35")

        mekurav = _mk_mekurav(
            client, admin_headers, "מקורב 35",
            custom_field_values={"mek35": "mekurav value"},
        )
        assert mekurav["custom_field_values"]["mek35"] == "mekurav value"

        # Setting the shliach-scoped field on a mekurav contact must 400 —
        # the definition doesn't exist for entity_type=contact_mekurav.
        r = client.patch(
            f"/api/contacts/{mekurav['id']}",
            json={"custom_field_values": {"sh35": "leak?"}},
            headers=admin_headers,
        )
        assert r.status_code == 400, r.text

    def test_list_and_detail_round_trip(self, client, admin_headers):
        _mk_field(client, admin_headers, "contact_mekurav", "boolean", "vip35")
        c = _mk_mekurav(
            client, admin_headers, "רשימה 35", custom_field_values={"vip35": True}
        )
        r = client.get("/api/contacts/list?contact_type=mekurav", headers=admin_headers)
        row = next(x for x in r.json()["items"] if x["id"] == c["id"])
        assert row["custom_field_values"]["vip35"] is True


class TestVisitCustomFieldValues:
    def test_non_boolean_visit_field_round_trips(self, client, admin_headers):
        _mk_field(client, admin_headers, "visit", "text", "mood35")
        mekurav = _mk_mekurav(client, admin_headers, "ביקור 35")
        r = client.post(
            f"/api/contacts/{mekurav['id']}/visits",
            json={
                "visit_date": "2026-07-01T10:00:00",
                "custom_field_values": {"mood35": "happy"},
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        assert r.json()["custom_field_values"]["mood35"] == "happy"

    def test_legacy_boolean_endpoint_unaffected_by_new_field_types(
        self, client, admin_headers
    ):
        # A non-boolean visit field must NOT show up in the legacy
        # checkbox+note /custom-fields sub-resource.
        _mk_field(client, admin_headers, "visit", "number", "score_v35")
        mekurav = _mk_mekurav(client, admin_headers, "לגאסי 35")
        visit = client.post(
            f"/api/contacts/{mekurav['id']}/visits",
            json={"visit_date": "2026-07-01T10:00:00"},
            headers=admin_headers,
        ).json()
        r = client.get(
            f"/api/visits/{visit['id']}/custom-fields", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert all(d["field_key"] != "score_v35" for d in r.json())


class TestFieldSettingsIntegration:
    def test_non_select_custom_field_gets_a_settings_row_and_can_be_hidden(
        self, client, admin_headers
    ):
        _mk_field(client, admin_headers, "apartment", "text", "hideme35")
        settings = client.get("/api/field-settings", headers=admin_headers).json()
        key = "customfield.apartment.hideme35"
        row = next(s for s in settings if s["field_key"] == key)
        assert row["entity"] == "apartment"
        assert row["is_visible"] is True

        r = client.put(
            "/api/field-settings",
            json={"field_key": key, "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_visible"] is False
