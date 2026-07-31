"""Fixes38 acceptance tests: "Summary of Visits" report backend endpoint
(GET /api/visits/summary) and the new Manage Fields toggles for the
quick-action icons + created_at."""


# --- Builders ----------------------------------------------------------------
def _mk_mekurav(client, headers, name, **extra):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_visit(client, headers, contact_id, visit_date, **flags):
    r = client.post(
        f"/api/contacts/{contact_id}/visits",
        json={"visit_date": visit_date, **flags},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_staff_same_org(client, admin_headers, email="staff38@example.com"):
    """An admin provisions a staff user in their OWN org (register() would
    instead create a brand-new org per call — no good for scoping tests)."""
    r = client.post(
        "/api/users",
        json={
            "full_name": "צוות 38",
            "email": email,
            "role": "staff",
            "password": "pw12345",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    user = r.json()
    token = client.post(
        "/api/auth/token",
        data={"username": user["username"], "password": "pw12345"},
    ).json()["access_token"]
    return user, {"Authorization": f"Bearer {token}"}


class TestVisitsSummary:
    def test_date_range_filters(self, client, admin_headers):
        c = _mk_mekurav(client, admin_headers, "טווח תאריכים")
        _mk_visit(client, admin_headers, c["id"], "2026-01-05T10:00:00")
        _mk_visit(client, admin_headers, c["id"], "2026-02-05T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-01-01",
                "date_to": "2026-01-31",
                "contact_id": c["id"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1

    def test_category_breakdown_and_contact_links(self, client, admin_headers, db_session):
        """fixes39: the breakdown is dynamic — driven by active
        entity_type="visit" boolean custom fields, not a fixed tuple. Checks
        both a migrated default field (tefillin) and an admin-added one
        (a Purim-party checklist item) show up side by side."""
        from app import models
        from app.seed import seed_visit_mivtzoim_custom_fields

        c = _mk_mekurav(client, admin_headers, "פירוט קטגוריות")
        org_id = (
            db_session.query(models.Contact.organization_id)
            .filter(models.Contact.id == c["id"])
            .scalar()
        )
        seed_visit_mivtzoim_custom_fields(db_session, org_id)
        defs = {
            d.field_key: d.id
            for d in db_session.query(models.CustomFieldDefinition).filter_by(
                organization_id=org_id, entity_type="visit"
            )
        }
        purim = client.post(
            "/api/custom-fields",
            json={"field_key": "purim_party38", "hebrew_label": "מסיבת פורים"},
            headers=admin_headers,
        ).json()

        v1 = _mk_visit(client, admin_headers, c["id"], "2026-03-01T10:00:00")
        r = client.put(
            f"/api/visits/{v1['id']}/custom-fields",
            json=[
                {"definition_id": defs["tefillin"], "checked": True, "note": None},
                {"definition_id": defs["tzedakah"], "checked": True, "note": None},
                {"definition_id": purim["id"], "checked": True, "note": None},
            ],
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        v2 = _mk_visit(client, admin_headers, c["id"], "2026-03-02T10:00:00")
        r = client.put(
            f"/api/visits/{v2['id']}/custom-fields",
            json=[{"definition_id": defs["tefillin"], "checked": True, "note": None}],
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-03-01",
                "date_to": "2026-03-31",
                "contact_id": c["id"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 2
        by_key = {cat["key"]: cat for cat in body["categories"]}
        assert by_key["tefillin"]["count"] == 2
        assert by_key["tefillin"]["hebrew_label"] == "תפילין"
        assert by_key["tzedakah"]["count"] == 1
        assert by_key["shabbat_candles"]["count"] == 0
        # An admin-added checklist item shows up in the breakdown too — this
        # never happened before fixes39 (the endpoint only knew about the 5
        # fixed columns).
        assert by_key["purim_party38"]["count"] == 1
        assert by_key["purim_party38"]["hebrew_label"] == "מסיבת פורים"
        item = by_key["tefillin"]["items"][0]
        assert item["contact_id"] == c["id"]
        assert item["contact_name"]

    def test_standard_user_scoped_to_assigned_contacts(self, client, admin_headers):
        _, staff_headers = _mk_staff_same_org(client, admin_headers)
        me = client.get("/api/auth/me", headers=staff_headers).json()
        assigned = _mk_mekurav(
            client, admin_headers, "משויך לצוות", assigned_user_id=me["guid"]
        )
        unassigned = _mk_mekurav(client, admin_headers, "לא משויך")
        _mk_visit(client, admin_headers, assigned["id"], "2026-04-01T10:00:00")
        _mk_visit(client, admin_headers, unassigned["id"], "2026-04-01T10:00:00")

        r = client.get(
            "/api/visits/summary",
            params={"date_from": "2026-04-01", "date_to": "2026-04-30"},
            headers=staff_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1

    def test_admin_default_scope_is_also_assignment_based(self, client, admin_headers):
        # Contact creation auto-assigns to its creator unless told otherwise
        # (contacts.py) — assign explicitly to someone else so the admin's
        # default ("mine") scope has nothing of their own to find.
        _, staff_headers = _mk_staff_same_org(client, admin_headers, email="staff38c@example.com")
        me = client.get("/api/auth/me", headers=staff_headers).json()
        c = _mk_mekurav(
            client, admin_headers, "לא משויך למנהל", assigned_user_id=me["guid"]
        )
        _mk_visit(client, admin_headers, c["id"], "2026-05-01T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={"date_from": "2026-05-01", "date_to": "2026-05-31"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 0

    def test_admin_scope_all_sees_org_wide(self, client, admin_headers):
        _, staff_headers = _mk_staff_same_org(client, admin_headers, email="staff38d@example.com")
        me = client.get("/api/auth/me", headers=staff_headers).json()
        c = _mk_mekurav(
            client, admin_headers, "לא משויך למנהל 2", assigned_user_id=me["guid"]
        )
        _mk_visit(client, admin_headers, c["id"], "2026-06-01T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-06-01",
                "date_to": "2026-06-30",
                "scope_all": "true",
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1

    def test_contact_id_scoping_ignores_assignment(self, client, admin_headers):
        _mk_staff_same_org(client, admin_headers, email="staff38b@example.com")
        c = _mk_mekurav(client, admin_headers, "לצפייה ישירה")
        _mk_visit(client, admin_headers, c["id"], "2026-07-01T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-07-01",
                "date_to": "2026-07-31",
                "contact_id": c["id"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1


class TestFieldRegistryAdditions:
    def test_action_icon_and_created_at_toggles_present(self, client, admin_headers):
        r = client.get("/api/field-settings", headers=admin_headers)
        assert r.status_code == 200, r.text
        by_key = {f["field_key"]: f for f in r.json()}
        for key in (
            "contacts.action_call",
            "contacts.action_whatsapp",
            "contacts.action_email",
            "contacts.created_at",
        ):
            assert key in by_key, key
            assert by_key[key]["entity"] == "contact"
            assert by_key[key]["is_visible"] is True

    def test_can_hide_and_show_created_at(self, client, admin_headers):
        r = client.put(
            "/api/field-settings",
            json={"field_key": "contacts.created_at", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_visible"] is False

        r = client.get("/api/field-settings", headers=admin_headers)
        by_key = {f["field_key"]: f for f in r.json()}
        assert by_key["contacts.created_at"]["is_visible"] is False
