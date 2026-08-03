"""Fixes40 round 2 acceptance tests: superadmin username env var (§1) and
the unified sort_order surface on /api/field-settings (§3).

Covered elsewhere: the login double-redirect race (§1), multi-org selection
and deep-link redirect (§2), and applying order to entity detail pages (§4)
are frontend-only — live-drive verified, no backend surface to test.
"""
from app.config import settings
from app.seed import seed_superadmin


# --- §1: configurable superadmin username -----------------------------------
class TestSuperadminUsername:
    def test_created_with_configured_username(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "superadmin_username", "sysadmin40")
        monkeypatch.setattr(settings, "superadmin_email", "super40@example.com")
        monkeypatch.setattr(settings, "superadmin_password", "pw12345")

        seed_superadmin(db_session)

        from app import models

        user = (
            db_session.query(models.User)
            .filter(models.User.email == "super40@example.com")
            .first()
        )
        assert user is not None
        assert user.username == "sysadmin40"
        assert user.role == "superadmin"

    def test_rerun_updates_username_when_env_changes(self, db_session, monkeypatch):
        monkeypatch.setattr(settings, "superadmin_username", "first40")
        monkeypatch.setattr(settings, "superadmin_email", "super41@example.com")
        monkeypatch.setattr(settings, "superadmin_password", "pw12345")
        seed_superadmin(db_session)

        monkeypatch.setattr(settings, "superadmin_username", "renamed40")
        seed_superadmin(db_session)

        from app import models

        user = (
            db_session.query(models.User)
            .filter(models.User.email == "super41@example.com")
            .first()
        )
        assert user.username == "renamed40"

    def test_login_with_configured_username(self, client, db_session, monkeypatch):
        monkeypatch.setattr(settings, "superadmin_username", "loginname40")
        monkeypatch.setattr(settings, "superadmin_email", "super42@example.com")
        monkeypatch.setattr(settings, "superadmin_password", "pw12345")
        seed_superadmin(db_session)

        r = client.post(
            "/api/auth/token",
            data={"username": "loginname40", "password": "pw12345"},
        )
        assert r.status_code == 200, r.text
        me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {r.json()['access_token']}"},
        ).json()
        assert me["role"] == "superadmin"
        assert me["username"] == "loginname40"


# --- §3: unified sort_order on /api/field-settings ---------------------------
class TestFieldSettingSortOrder:
    def test_builtin_field_sort_order_roundtrip(self, client, admin_headers):
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.color_tag", "is_visible": True, "sort_order": 3},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] == 3

        listed = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(f for f in listed if f["field_key"] == "contacts.color_tag")
        assert row["sort_order"] == 3

    def test_unordered_builtin_field_is_none(self, client, admin_headers):
        listed = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(f for f in listed if f["field_key"] == "contacts.pipeline_status")
        assert row["sort_order"] is None

    def test_custom_field_sort_order_writes_through_to_definition(
        self, client, admin_headers
    ):
        created = client.post(
            "/api/custom-fields",
            json={
                "field_key": "sortorder_test",
                "hebrew_label": "בדיקת סדר",
                "entity_type": "visit",
                "field_type": "boolean",
            },
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text

        key = "customfield.visit.sortorder_test"
        r = client.put(
            "/api/field-settings",
            json={"field_key": key, "is_visible": True, "sort_order": 7},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] == 7

        # The definition's own sort_order column is what other queries
        # (e.g. visits_summary) already order by — confirm it, not just the
        # field-settings row, was updated.
        defs = client.get(
            "/api/custom-fields", params={"entity_type": "visit"}, headers=admin_headers
        ).json()
        row = next(d for d in defs if d["field_key"] == "sortorder_test")
        assert row["sort_order"] == 7

    def test_custom_picklist_sort_order_writes_through_to_definition(
        self, client, admin_headers
    ):
        created = client.post(
            "/api/picklists/definition",
            json={
                "system_name": "sortorder_picklist_test",
                "hebrew_display_name": "רשימת בדיקה",
                "entity_type": "apartment",
            },
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text

        r = client.put(
            "/api/field-settings",
            json={
                "field_key": "sortorder_picklist_test",
                "is_visible": True,
                "sort_order": 5,
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] == 5

        listed = client.get("/api/picklists", headers=admin_headers).json()
        row = next(p for p in listed if p["field_key"] == "sortorder_picklist_test")
        assert row["sort_order"] == 5

    def test_staff_cannot_set_sort_order(self, client, admin_headers, auth_headers):
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.color_tag", "is_visible": True, "sort_order": 1},
            headers=auth_headers,
        )
        assert r.status_code == 403

    # --- Prod hotfix (2026-08-03): CustomFieldDefinition/PicklistDefinition
    # .sort_order are NOT-NULL columns that default to 0 — that 0 predates
    # this feature (an internal tie-breaker, never an admin-set "position
    # 1") and must never surface as a real order value, or every untouched
    # custom field/picklist shows a false "0" instead of unordered. ---
    def test_never_ordered_custom_field_is_none_not_zero(self, client, admin_headers):
        created = client.post(
            "/api/custom-fields",
            json={
                "field_key": "never_ordered_test",
                "hebrew_label": "לא ממוין",
                "entity_type": "visit",
                "field_type": "boolean",
            },
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text

        listed = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(
            f for f in listed if f["field_key"] == "customfield.visit.never_ordered_test"
        )
        assert row["sort_order"] is None

    def test_never_ordered_custom_picklist_is_none_not_zero(self, client, admin_headers):
        created = client.post(
            "/api/picklists/definition",
            json={
                "system_name": "never_ordered_picklist_test",
                "hebrew_display_name": "רשימה לא ממוינת",
                "entity_type": "apartment",
            },
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text

        listed = client.get("/api/picklists", headers=admin_headers).json()
        row = next(p for p in listed if p["field_key"] == "never_ordered_picklist_test")
        assert row["sort_order"] is None

        field_settings = client.get("/api/field-settings", headers=admin_headers).json()
        fs_row = next(
            f for f in field_settings if f["field_key"] == "never_ordered_picklist_test"
        )
        assert fs_row["sort_order"] is None

    def test_clearing_a_builtin_order_actually_persists(self, client, admin_headers):
        client.put(
            "/api/field-settings",
            json={"field_key": "contacts.priority_score", "is_visible": True, "sort_order": 4},
            headers=admin_headers,
        )
        # Explicit null (what the frontend sends when the input is emptied)
        # must clear it back to unordered, not silently no-op.
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.priority_score", "is_visible": True, "sort_order": None},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] is None

        listed = client.get("/api/field-settings", headers=admin_headers).json()
        row = next(f for f in listed if f["field_key"] == "contacts.priority_score")
        assert row["sort_order"] is None

    def test_clearing_a_custom_field_order_actually_persists(self, client, admin_headers):
        client.post(
            "/api/custom-fields",
            json={
                "field_key": "clear_test",
                "hebrew_label": "בדיקת ניקוי",
                "entity_type": "visit",
                "field_type": "boolean",
            },
            headers=admin_headers,
        )
        key = "customfield.visit.clear_test"
        client.put(
            "/api/field-settings",
            json={"field_key": key, "is_visible": True, "sort_order": 6},
            headers=admin_headers,
        )
        r = client.put(
            "/api/field-settings",
            json={"field_key": key, "is_visible": True, "sort_order": None},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] is None

    def test_explicit_zero_is_treated_as_clear(self, client, admin_headers):
        client.put(
            "/api/field-settings",
            json={"field_key": "contacts.priority_score", "is_visible": True, "sort_order": 8},
            headers=admin_headers,
        )
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.priority_score", "is_visible": True, "sort_order": 0},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] is None

    def test_toggling_visibility_alone_does_not_disturb_order(self, client, admin_headers):
        """The plain show/hide toggle (no sort_order key in the request body
        at all) must never clear an already-set order — this is the
        model_fields_set distinction between 'omitted' and 'explicit null'."""
        client.put(
            "/api/field-settings",
            json={"field_key": "contacts.priority_score", "is_visible": True, "sort_order": 2},
            headers=admin_headers,
        )
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.priority_score", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["sort_order"] == 2
