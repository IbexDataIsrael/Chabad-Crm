"""Fixes50 acceptance tests: field_registry additions (visits.location /
visits.visit_type), visits_summary's optional date range + non-admin
scope_all widening."""


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


def _mk_staff_same_org(client, admin_headers, email="staff50@example.com"):
    """An admin provisions a staff user in their OWN org (register() would
    instead create a brand-new org per call — no good for scoping tests)."""
    r = client.post(
        "/api/users",
        json={
            "full_name": "צוות 50",
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


class TestFieldRegistryVisitAdditions:
    def test_location_and_visit_type_toggles_present(self, client, admin_headers):
        r = client.get("/api/field-settings", headers=admin_headers)
        assert r.status_code == 200, r.text
        by_key = {f["field_key"]: f for f in r.json()}
        for key in ("visits.location", "visits.visit_type"):
            assert key in by_key, key
            assert by_key[key]["entity"] == "visit"
            assert by_key[key]["is_visible"] is True

    def test_can_hide_visit_location(self, client, admin_headers):
        r = client.put(
            "/api/field-settings",
            json={"field_key": "visits.location", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["is_visible"] is False


class TestVisitsSummaryAllDates:
    def test_omitting_both_dates_covers_all_time(self, client, admin_headers):
        c = _mk_mekurav(client, admin_headers, "כל הזמנים")
        _mk_visit(client, admin_headers, c["id"], "2020-01-05T10:00:00")
        _mk_visit(client, admin_headers, c["id"], "2026-06-05T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={"contact_id": c["id"]},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 2

    def test_open_ended_from_only(self, client, admin_headers):
        c = _mk_mekurav(client, admin_headers, "פתוח מלמעלה")
        _mk_visit(client, admin_headers, c["id"], "2020-01-05T10:00:00")
        _mk_visit(client, admin_headers, c["id"], "2026-06-05T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={"contact_id": c["id"], "date_from": "2025-01-01"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1


class TestVisitsSummaryScopeAllForStaff:
    def test_staff_scope_all_sees_org_wide(self, client, admin_headers):
        # fixes50 §3.2: scope_all used to be admin-only — a staff caller's
        # scope_all=true was silently ignored (still self-scoped). Now it
        # matches the assigned_user_id branch's existing non-shliach guard.
        _, staff_headers = _mk_staff_same_org(client, admin_headers)
        other = _mk_mekurav(client, admin_headers, "לא משויך לצוות")
        _mk_visit(client, admin_headers, other["id"], "2026-07-01T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-07-01",
                "date_to": "2026-07-31",
                "scope_all": "true",
            },
            headers=staff_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1

    def test_staff_default_still_self_scoped(self, client, admin_headers):
        # Unchanged contract (test_fixes38.py locks this in too): without
        # scope_all, staff only ever see their own assigned contacts.
        _, staff_headers = _mk_staff_same_org(client, admin_headers, email="staff50b@example.com")
        other = _mk_mekurav(client, admin_headers, "לא משויך לצוות 2")
        _mk_visit(client, admin_headers, other["id"], "2026-08-01T10:00:00")
        r = client.get(
            "/api/visits/summary",
            params={"date_from": "2026-08-01", "date_to": "2026-08-31"},
            headers=staff_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 0
