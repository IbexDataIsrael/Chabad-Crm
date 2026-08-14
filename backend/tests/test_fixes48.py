"""Fixes48 acceptance tests:

- §1 Custom fields / picklists: usage-count endpoints + hard-delete now
  purges dependent data instead of silently orphaning it (custom fields) or
  blocking with a 409 (picklist values).
- §2 Contacts: ContactOut exposes the raw admin_area_id/apartment_id an
  inline editor needs (previously only the display names).
- §3 Users: "Clear Assignments" clears report_numbers, not areas.
- §4 Users: shliach restore-field endpoint (mirrors apartments' per-field
  restore).
"""
from app import models

_seq = iter(range(48000, 48999))


def _mk_contact(client, headers, name="מקורב 48", **extra):
    body = {"name": name, "phone": f"0559{next(_seq):06d}", "contact_type": "mekurav"}
    body.update(extra)
    r = client.post("/api/contacts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 48",
            "phone": f"0559{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_area(client, headers, name="אזור 48"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_report_number(client, headers, name="RN-48"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_admin_area(client, headers, name="אזור מנהל 48"):
    r = client.post("/api/admin-areas", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_apartment(client, headers, area_name="אזור-48b", building_addr="רחוב 48"):
    area = _mk_area(client, headers, area_name)
    b = client.post(
        "/api/buildings",
        json={"area_id": area["id"], "building_address": building_addr, "floors": []},
        headers=headers,
    )
    assert b.status_code == 201, b.text
    building = b.json()
    a = client.post(
        "/api/apartments",
        json={"building_id": building["id"], "apartment_name": "1"},
        headers=headers,
    )
    assert a.status_code == 201, a.text
    return a.json(), building


class TestCustomFieldUsageAndPurge:
    def test_usage_zero_for_unused_definition(self, client, admin_headers):
        r = client.post(
            "/api/custom-fields",
            json={
                "field_key": "cf48_unused",
                "hebrew_label": "שדה 48",
                "entity_type": "contact_mekurav",
                "field_type": "text",
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        def_id = r.json()["id"]
        usage = client.get(f"/api/custom-fields/{def_id}/usage", headers=admin_headers)
        assert usage.status_code == 200, usage.text
        assert usage.json()["count"] == 0

    def test_hard_delete_purges_text_field_values(self, client, admin_headers, db_session):
        r = client.post(
            "/api/custom-fields",
            json={
                "field_key": "cf48_text",
                "hebrew_label": "שדה טקסט 48",
                "entity_type": "contact_mekurav",
                "field_type": "text",
            },
            headers=admin_headers,
        )
        def_id = r.json()["id"]
        c = _mk_contact(client, admin_headers, "מקורב48a")
        client.patch(
            f"/api/contacts/{c['id']}",
            json={"custom_field_values": {"cf48_text": "hello"}},
            headers=admin_headers,
        )

        usage = client.get(f"/api/custom-fields/{def_id}/usage", headers=admin_headers)
        assert usage.json()["count"] == 1

        assert (
            db_session.query(models.CustomFieldValue)
            .filter(models.CustomFieldValue.definition_id == def_id)
            .count()
            == 1
        )
        del_res = client.delete(
            f"/api/custom-fields/{def_id}?hard=true", headers=admin_headers
        )
        assert del_res.status_code == 200, del_res.text
        assert (
            db_session.query(models.CustomFieldValue)
            .filter(models.CustomFieldValue.definition_id == def_id)
            .count()
            == 0
        )

    def test_hard_delete_purges_select_field_picklist(self, client, admin_headers, db_session):
        r = client.post(
            "/api/custom-fields",
            json={
                "field_key": "cf48_select",
                "hebrew_label": "רשימה 48",
                "entity_type": "contact_mekurav",
                "field_type": "select",
                "picklist_options": ["a", "b"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        def_id = r.json()["id"]
        c = _mk_contact(client, admin_headers, "מקורב48b")
        patch = client.patch(
            f"/api/contacts/{c['id']}",
            json={"picklist_values": {"cf48_select": "a"}},
            headers=admin_headers,
        )
        assert patch.status_code == 200, patch.text

        usage = client.get(f"/api/custom-fields/{def_id}/usage", headers=admin_headers)
        assert usage.json()["count"] == 1

        del_res = client.delete(
            f"/api/custom-fields/{def_id}?hard=true", headers=admin_headers
        )
        assert del_res.status_code == 200, del_res.text
        assert (
            db_session.query(models.PicklistDefinition)
            .filter(models.PicklistDefinition.system_name == "cf48_select")
            .count()
            == 0
        )
        assert (
            db_session.query(models.PicklistValue)
            .filter(models.PicklistValue.field_key == "cf48_select")
            .count()
            == 0
        )
        assert (
            db_session.query(models.PicklistLink)
            .join(
                models.PicklistDefinition,
                models.PicklistDefinition.id == models.PicklistLink.picklist_definition_id,
            )
            .filter(models.PicklistDefinition.system_name == "cf48_select")
            .count()
            == 0
        )


class TestPicklistUsageAndPurge:
    def test_value_hard_delete_purges_links_instead_of_blocking(
        self, client, admin_headers, db_session
    ):
        client.post(
            "/api/picklists/definition",
            json={
                "system_name": "custom.pl48",
                "hebrew_display_name": "רשימה 48",
                "entity_type": "contact_mekurav",
            },
            headers=admin_headers,
        )
        opt = client.post(
            "/api/picklists/custom.pl48",
            json={"value": "opt1", "hebrew_label": "אפשרות 1"},
            headers=admin_headers,
        )
        assert opt.status_code == 201, opt.text
        value_id = opt.json()["id"]

        c = _mk_contact(client, admin_headers, "מקורב48c")
        patch = client.patch(
            f"/api/contacts/{c['id']}",
            json={"picklist_values": {"custom.pl48": "opt1"}},
            headers=admin_headers,
        )
        assert patch.status_code == 200, patch.text

        usage = client.get(f"/api/picklists/{value_id}/usage", headers=admin_headers)
        assert usage.status_code == 200, usage.text
        assert usage.json()["count"] == 1

        # fixes48: previously 409'd here and left the record untouched; now
        # it purges the dependent link and deletes the value for real.
        del_res = client.delete(
            f"/api/picklists/{value_id}?hard=true", headers=admin_headers
        )
        assert del_res.status_code == 200, del_res.text
        assert db_session.get(models.PicklistValue, value_id) is None
        assert (
            db_session.query(models.PicklistLink)
            .filter(models.PicklistLink.picklist_value_id == value_id)
            .count()
            == 0
        )
        got = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        assert got["picklist_values"].get("custom.pl48") is None

    def test_definition_usage_endpoint(self, client, admin_headers):
        d = client.post(
            "/api/picklists/definition",
            json={
                "system_name": "custom.pl48b",
                "hebrew_display_name": "רשימה 48ב",
                "entity_type": "contact_mekurav",
            },
            headers=admin_headers,
        )
        def_id = d.json()["id"]
        client.post(
            "/api/picklists/custom.pl48b",
            json={"value": "x", "hebrew_label": "איקס"},
            headers=admin_headers,
        )
        usage = client.get(
            f"/api/picklists/definition/{def_id}/usage", headers=admin_headers
        )
        assert usage.status_code == 200, usage.text
        assert usage.json()["count"] == 0

        c = _mk_contact(client, admin_headers, "מקורב48d")
        client.patch(
            f"/api/contacts/{c['id']}",
            json={"picklist_values": {"custom.pl48b": "x"}},
            headers=admin_headers,
        )
        usage2 = client.get(
            f"/api/picklists/definition/{def_id}/usage", headers=admin_headers
        )
        assert usage2.json()["count"] == 1


class TestContactOutGeoIds:
    """fixes48 §2: raw admin_area_id/apartment_id needed to drive an inline
    editor's current value, alongside the pre-existing display-name fields."""

    def test_list_row_carries_raw_ids(self, client, admin_headers):
        apt, _building = _mk_apartment(client, admin_headers)
        admin_area = _mk_admin_area(client, admin_headers)
        c = _mk_contact(client, admin_headers, "מקורב48e")
        patch = client.patch(
            f"/api/contacts/{c['id']}",
            json={"mekurav": {"apartment_id": apt["id"], "admin_area_id": admin_area["id"]}},
            headers=admin_headers,
        )
        assert patch.status_code == 200, patch.text
        # The PATCH response itself (merged straight into a grid row by the
        # frontend) must already carry the fresh ids + names.
        assert patch.json()["apartment_id"] == apt["id"]
        assert patch.json()["admin_area_id"] == admin_area["id"]
        assert patch.json()["admin_area_name"] == admin_area["name"]

        rows = client.get("/api/contacts", headers=admin_headers).json()
        row = next(r for r in rows if r["id"] == c["id"])
        assert row["apartment_id"] == apt["id"]
        assert row["admin_area_id"] == admin_area["id"]
        assert row["building_name"]

        paged = client.get("/api/contacts/list", headers=admin_headers).json()
        prow = next(r for r in paged["items"] if r["id"] == c["id"])
        assert prow["apartment_id"] == apt["id"]
        assert prow["admin_area_id"] == admin_area["id"]


class TestClearAssignmentsReportNumbersOnly:
    """fixes48 §3: the action must clear report_numbers and leave area_ids
    completely untouched — it previously did the exact opposite."""

    def test_clears_report_numbers_leaves_areas_untouched(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור-48f")
        rn = _mk_report_number(client, admin_headers, "RN-48f")
        sh = _mk_shliach(client, admin_headers, "clear48@example.com")
        client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"area_ids": [area["id"]], "report_number_ids": [rn["id"]]}},
            headers=admin_headers,
        )

        res = client.post(
            "/api/contacts/shliach/clear-report-numbers",
            json={"contact_ids": [sh["id"]]},
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        assert res.json()["updated"] == 1

        got = client.get(f"/api/contacts/{sh['id']}", headers=admin_headers).json()
        assert got["shliach"]["report_number_ids"] == []
        assert got["shliach"]["area_ids"] == [area["id"]]  # must survive

    def test_old_clear_areas_route_is_gone(self, client, admin_headers):
        res = client.post(
            "/api/contacts/shliach/clear-areas",
            json={"contact_ids": [1]},
            headers=admin_headers,
        )
        assert res.status_code == 404


class TestShliachRestoreField:
    def _linked_user_id(self, sh: dict) -> int:
        return sh["shliach"]["user_id"]

    def test_restore_full_name(self, client, admin_headers):
        sh = _mk_shliach(client, admin_headers, "restore48a@example.com")
        user_id = self._linked_user_id(sh)
        original_name = sh["shliach"]["full_name"]

        client.put(
            f"/api/users/{user_id}",
            json={"full_name": "שם חדש"},
            headers=admin_headers,
        )
        hist = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        assert len(hist) == 1
        old_version_id = hist[0]["id"]
        assert hist[0]["full_name"] == original_name

        r = client.post(
            f"/api/users/{user_id}/shliach/restore-field",
            json={"version_id": old_version_id, "field": "full_name"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["full_name"] == original_name
        assert r.json()["full_name"] == "שם חדש"  # the User row itself is untouched

        # The restore itself is a new version — history now has 2 entries.
        hist2 = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        assert len(hist2) == 2

    def test_restore_areas_and_report_numbers(self, client, admin_headers):
        area1 = _mk_area(client, admin_headers, "אזור-48g1")
        area2 = _mk_area(client, admin_headers, "אזור-48g2")
        rn1 = _mk_report_number(client, admin_headers, "RN-48g1")
        sh = _mk_shliach(client, admin_headers, "restore48b@example.com")
        user_id = self._linked_user_id(sh)

        client.put(
            f"/api/users/{user_id}",
            json={"shliach": {"area_ids": [area1["id"]], "report_number_ids": [rn1["id"]]}},
            headers=admin_headers,
        )
        hist = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        root_version_id = hist[0]["id"]  # the pre-edit (empty) version

        r = client.post(
            f"/api/users/{user_id}/shliach/restore-field",
            json={"version_id": root_version_id, "field": "areas"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["area_ids"] == []
        # report_numbers must survive — only "areas" was restored.
        assert r.json()["shliach"]["report_number_ids"] == [rn1["id"]]

    def test_restore_unknown_field_rejected(self, client, admin_headers):
        sh = _mk_shliach(client, admin_headers, "restore48c@example.com")
        user_id = self._linked_user_id(sh)
        r = client.post(
            f"/api/users/{user_id}/shliach/restore-field",
            json={"version_id": 999999, "field": "role"},
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_restore_cross_lineage_version_404s(self, client, admin_headers):
        sh1 = _mk_shliach(client, admin_headers, "restore48d@example.com")
        sh2 = _mk_shliach(client, admin_headers, "restore48e@example.com")
        user1_id = self._linked_user_id(sh1)
        user2_id = self._linked_user_id(sh2)

        client.put(
            f"/api/users/{user2_id}",
            json={"full_name": "שם אחר"},
            headers=admin_headers,
        )
        hist2 = client.get(
            f"/api/contacts/{sh2['id']}/shliach-history", headers=admin_headers
        ).json()
        other_lineage_version_id = hist2[0]["id"]

        r = client.post(
            f"/api/users/{user1_id}/shliach/restore-field",
            json={"version_id": other_lineage_version_id, "field": "full_name"},
            headers=admin_headers,
        )
        assert r.status_code == 404

    def test_non_admin_forbidden(self, client, admin_headers, auth_headers):
        sh = _mk_shliach(client, admin_headers, "restore48f@example.com")
        user_id = self._linked_user_id(sh)
        r = client.post(
            f"/api/users/{user_id}/shliach/restore-field",
            json={"version_id": 1, "field": "full_name"},
            headers=auth_headers,
        )
        assert r.status_code == 403

    def test_staff_user_with_no_linked_shliach_404s(self, client, admin_headers):
        staff = client.post(
            "/api/users",
            json={
                "full_name": "צוות 48",
                "email": "staff48@example.com",
                "role": "staff",
                "password": "Pass1234",
            },
            headers=admin_headers,
        )
        assert staff.status_code == 201, staff.text
        r = client.post(
            f"/api/users/{staff.json()['id']}/shliach/restore-field",
            json={"version_id": 1, "field": "full_name"},
            headers=admin_headers,
        )
        assert r.status_code == 404
