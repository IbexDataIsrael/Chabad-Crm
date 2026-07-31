"""Fixes26 acceptance tests: PATCH partial updates for inline editing (§2),
shliach login status + one-click recreate (§4), and the user-delete repair
(saved preferences no longer block deletion, §4)."""
from app import models

_seq = iter(range(4000, 9999))


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה כו"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_report_number(client, headers, name="דוח כו"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל",
            "last_name": "כ\"ו",
            "phone": f"0549{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_mekurav(client, headers, name="מקורב כו", **extra):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _login_user_id(client, headers, email):
    users = client.get("/api/users", headers=headers).json()
    return next(u["id"] for u in users if u["email"] == email)


# --- §2 PATCH partial updates -------------------------------------------------
class TestContactPatch:
    def test_patch_single_field_leaves_the_rest(self, client, admin_headers):
        c = _mk_mekurav(
            client, admin_headers, phone=f"0529{next(_seq):06d}", email="p26@example.com"
        )
        r = client.patch(
            f"/api/contacts/{c['id']}", json={"name": "שם חדש"}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        fresh = r.json()
        assert fresh["name"] == "שם חדש"
        assert fresh["phone"] == c["phone"]
        assert fresh["email"] == "p26@example.com"

    def test_contact_without_phone(self, client, admin_headers):
        c = _mk_mekurav(client, admin_headers, name="בלי טלפון")
        assert c["phone"] is None
        # Autosaving a single other field keeps phone empty and valid.
        r = client.patch(
            f"/api/contacts/{c['id']}", json={"last_name": "לוי"}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["phone"] is None

    def test_shliach_partial_patch_keeps_links(self, client, admin_headers):
        """A one-field {shliach:{notes}} patch must not wipe the report-number
        and area links (their schema defaults are empty lists)."""
        area = _mk_area(client, admin_headers)
        rn = _mk_report_number(client, admin_headers)
        c = _mk_shliach(
            client,
            admin_headers,
            "keeper26@example.com",
            report_number_ids=[rn["id"]],
            area_ids=[area["id"]],
        )
        r = client.patch(
            f"/api/contacts/{c['id']}",
            json={"shliach": {"notes": "עודכן"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        sh = r.json()["shliach"]
        assert sh["notes"] == "עודכן"
        assert sh["report_number_ids"] == [rn["id"]]
        assert sh["area_ids"] == [area["id"]]

    def test_shliach_links_still_updatable(self, client, admin_headers):
        rn = _mk_report_number(client, admin_headers, "דוח כו 2")
        c = _mk_shliach(
            client, admin_headers, "linker26@example.com", report_number_ids=[rn["id"]]
        )
        r = client.patch(
            f"/api/contacts/{c['id']}",
            json={"shliach": {"report_number_ids": []}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["report_number_ids"] == []


class TestVisitPatch:
    def test_patch_alias_top_level(self, client, admin_headers):
        c = _mk_mekurav(client, admin_headers)
        r = client.post(
            f"/api/contacts/{c['id']}/visits",
            json={"visit_date": "2026-07-01T10:00:00", "location": "בבית"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        visit = r.json()
        r = client.patch(
            f"/api/visits/{visit['id']}", json={"notes": "הערה"}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        fresh = r.json()
        assert fresh["notes"] == "הערה"
        assert fresh["location"] == "בבית"  # untouched by the partial patch

    def test_patch_alias_per_contact(self, client, admin_headers, db_session):
        """fixes39: a boolean Mivtzoim flag (checked via the separate
        /custom-fields sub-resource) and connection_to_rebbe (a text custom
        field carried in the visit's own custom_field_values) now live in two
        different places — a partial PATCH to the visit's plain fields must
        not disturb the boolean flag set through the other endpoint."""
        from app import models
        from app.seed import seed_visit_mivtzoim_custom_fields

        c = _mk_mekurav(client, admin_headers, name="מקורב ביקור")
        org_id = (
            db_session.query(models.Contact.organization_id)
            .filter(models.Contact.id == c["id"])
            .scalar()
        )
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        tefillin_def_id = (
            db_session.query(models.CustomFieldDefinition.id)
            .filter_by(organization_id=org_id, entity_type="visit", field_key="tefillin")
            .scalar()
        )
        visit = client.post(
            f"/api/contacts/{c['id']}/visits",
            json={"visit_date": "2026-07-02T10:00:00"},
            headers=admin_headers,
        ).json()
        flip = client.put(
            f"/api/visits/{visit['id']}/custom-fields",
            json=[{"definition_id": tefillin_def_id, "checked": True, "note": None}],
            headers=admin_headers,
        )
        assert flip.status_code == 200, flip.text

        r = client.patch(
            f"/api/contacts/{c['id']}/visits/{visit['id']}",
            json={"custom_field_values": {"connection_to_rebbe": "קשר חדש"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        fresh = r.json()
        assert fresh["custom_field_values"]["connection_to_rebbe"] == "קשר חדש"

        flags = client.get(
            f"/api/visits/{visit['id']}/custom-fields", headers=admin_headers
        ).json()
        assert {f["field_key"]: f["checked"] for f in flags}["tefillin"] is True


# --- §4 shliach login status + recreate ----------------------------------------
class TestLoginStatusAndRecreate:
    def test_active_after_provisioning(self, client, admin_headers):
        c = _mk_shliach(client, admin_headers, "active26@example.com")
        got = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        assert got["shliach"]["login_status"] == "active"

    def test_disabled_then_recreate(self, client, admin_headers):
        c = _mk_shliach(client, admin_headers, "disabled26@example.com")
        uid = _login_user_id(client, admin_headers, "disabled26@example.com")
        r = client.put(
            f"/api/users/{uid}", json={"is_active": False}, headers=admin_headers
        )
        assert r.status_code == 200, r.text

        got = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        assert got["shliach"]["login_status"] == "disabled"

        r = client.post(
            "/api/users/recreate",
            json={"email": "disabled26@example.com"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_active"] is True
        got = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        assert got["shliach"]["login_status"] == "active"

    def test_missing_then_recreate_provisions_fresh_user(
        self, client, admin_headers, db_session
    ):
        c = _mk_shliach(client, admin_headers, "gone26@example.com")
        uid = _login_user_id(client, admin_headers, "gone26@example.com")
        r = client.delete(f"/api/users/{uid}", headers=admin_headers)
        assert r.status_code == 204, r.text

        got = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        assert got["shliach"]["login_status"] == "missing"
        assert got["shliach"]["user_id"] is None  # delete unlinked it

        r = client.post(
            "/api/users/recreate",
            json={"email": "GONE26@example.com"},  # case-insensitive lookup
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        user = r.json()
        assert user["role"] == "shliach"
        assert user["is_active"] is True

        got = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        assert got["shliach"]["login_status"] == "active"
        assert got["shliach"]["user_id"] == user["id"]  # re-linked

    def test_recreate_unknown_email_404(self, client, admin_headers):
        r = client.post(
            "/api/users/recreate",
            json={"email": "nobody26@example.com"},
            headers=admin_headers,
        )
        assert r.status_code == 404

    def test_recreate_is_admin_only(self, client, auth_headers):
        r = client.post(
            "/api/users/recreate",
            json={"email": "whoever@example.com"},
            headers=auth_headers,
        )
        assert r.status_code == 403


# --- §4 user deletion with saved preferences ------------------------------------
class TestUserDeleteWithPreferences:
    def test_delete_user_with_preferences(self, client, admin_headers, db_session):
        r = client.post(
            "/api/users",
            json={
                "full_name": "משתמש עם העדפות",
                "email": "prefs26@example.com",
                "role": "staff",
                "password": "pw12345",
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        uid = r.json()["id"]

        # Saved UI preferences (fixes17) — the NOT-NULL FK that used to make
        # the delete 500.
        db_session.add(
            models.UserPreference(user_id=uid, key="locale", value='"he"')
        )
        db_session.commit()

        r = client.delete(f"/api/users/{uid}", headers=admin_headers)
        assert r.status_code == 204, r.text
        assert db_session.query(models.User).filter_by(id=uid).first() is None
        assert (
            db_session.query(models.UserPreference).filter_by(user_id=uid).count()
            == 0
        )
