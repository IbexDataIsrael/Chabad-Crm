"""Fixes43 acceptance tests: contacts "Assigned To" bulk edit (§1)."""


_seq = iter(range(43000, 49999))


def _mk_contact(client, headers, name="פלוני", **overrides):
    payload = {
        "name": name,
        "phone": f"0529{next(_seq):06d}",
        "contact_type": "mekurav",
        **overrides,
    }
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_staff_user(client, headers, email, full_name="צוות 43"):
    r = client.post(
        "/api/users",
        json={
            "full_name": full_name,
            "email": email,
            "role": "staff",
            "password": "Pass1234",
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 43",
            "phone": f"0559{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
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


def _list_by_id(client, headers):
    items = client.get("/api/contacts/list?page_size=100", headers=headers).json()["items"]
    return {c["id"]: c for c in items}


class TestContactsBulkUpdate:
    def test_reassigns_all_matching_filtered_contacts(self, client, admin_headers):
        me = client.get("/api/auth/me", headers=admin_headers).json()
        u1 = _mk_staff_user(client, admin_headers, "u1_43@example.com")
        u2 = _mk_staff_user(client, admin_headers, "u2_43@example.com")
        c1 = _mk_contact(client, admin_headers, name="א", assigned_user_id=u1["guid"])
        c2 = _mk_contact(client, admin_headers, name="ב", assigned_user_id=u1["guid"])
        c3 = _mk_contact(client, admin_headers, name="ג")  # defaults to the creator (admin)

        res = client.post(
            "/api/contacts/bulk-update",
            json={"assigned_user_id": u1["guid"], "new_assigned_user_id": u2["guid"]},
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        assert res.json()["updated"] == 2

        by_id = _list_by_id(client, admin_headers)
        assert by_id[c1["id"]]["assigned_user_id"] == u2["guid"]
        assert by_id[c2["id"]]["assigned_user_id"] == u2["guid"]
        assert by_id[c3["id"]]["assigned_user_id"] == me["guid"]  # untouched

    def test_only_touches_filtered_rows(self, client, admin_headers):
        u = _mk_staff_user(client, admin_headers, "u3_43@example.com")
        c1 = _mk_contact(client, admin_headers, name="דוד43")
        c2 = _mk_contact(client, admin_headers, name="שרה43")

        res = client.post(
            "/api/contacts/bulk-update",
            json={"q": "דוד43", "new_assigned_user_id": u["guid"]},
            headers=admin_headers,
        )
        assert res.json()["updated"] == 1

        by_id = _list_by_id(client, admin_headers)
        assert by_id[c1["id"]]["assigned_user_id"] == u["guid"]
        assert by_id[c2["id"]]["assigned_user_id"] != u["guid"]

    def test_clears_assignment_when_new_value_is_none(self, client, admin_headers):
        u = _mk_staff_user(client, admin_headers, "u4_43@example.com")
        c1 = _mk_contact(client, admin_headers, name="דוד43ב", assigned_user_id=u["guid"])

        res = client.post(
            "/api/contacts/bulk-update",
            json={"assigned_user_id": u["guid"], "new_assigned_user_id": None},
            headers=admin_headers,
        )
        assert res.json()["updated"] == 1
        by_id = _list_by_id(client, admin_headers)
        assert by_id[c1["id"]]["assigned_user_id"] is None

    def test_rejects_unknown_target_user(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="דוד43ג")
        res = client.post(
            "/api/contacts/bulk-update",
            json={"new_assigned_user_id": "not-a-real-guid"},
            headers=admin_headers,
        )
        assert res.status_code == 400

    def test_shliach_cannot_bulk_reassign(self, client, admin_headers):
        u = _mk_staff_user(client, admin_headers, "u5_43@example.com")
        _mk_shliach(client, admin_headers, "shliach43@example.com")
        shliach = _shliach_login(client, "shliach43@example.com")

        res = client.post(
            "/api/contacts/bulk-update",
            json={"new_assigned_user_id": u["guid"]},
            headers=shliach,
        )
        assert res.status_code == 403


def _mk_area(client, headers, name="אזור 43"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


class TestClearShliachAreas:
    def test_clears_area_links_for_given_contacts(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        sh1 = _mk_shliach(client, admin_headers, "clear1_43@example.com")
        sh2 = _mk_shliach(client, admin_headers, "clear2_43@example.com")
        client.patch(
            f"/api/contacts/{sh1['id']}",
            json={"shliach": {"area_ids": [area["id"]]}},
            headers=admin_headers,
        )
        client.patch(
            f"/api/contacts/{sh2['id']}",
            json={"shliach": {"area_ids": [area["id"]]}},
            headers=admin_headers,
        )

        res = client.post(
            "/api/contacts/shliach/clear-areas",
            json={"contact_ids": [sh1["id"]]},
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        assert res.json()["updated"] == 1

        got1 = client.get(f"/api/contacts/{sh1['id']}", headers=admin_headers).json()
        got2 = client.get(f"/api/contacts/{sh2['id']}", headers=admin_headers).json()
        assert got1["shliach"]["area_ids"] == []
        assert got2["shliach"]["area_ids"] == [area["id"]]  # untouched

    def test_non_admin_forbidden(self, client, auth_headers):
        res = client.post(
            "/api/contacts/shliach/clear-areas",
            json={"contact_ids": [1]},
            headers=auth_headers,
        )
        assert res.status_code == 403


def _mk_report_number(client, headers, name="RN-43"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


class TestShliachAssignmentLookups:
    """fixes43 §4.2/4.3: the shliach-assignments endpoints that power the
    reassignment conflict warning on the shliach edit form."""

    def test_area_assignments_grouped_by_area(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור-conflict")
        sh1 = _mk_shliach(client, admin_headers, "areaconf1_43@example.com")
        sh2 = _mk_shliach(client, admin_headers, "areaconf2_43@example.com")
        client.patch(
            f"/api/contacts/{sh1['id']}",
            json={"shliach": {"area_ids": [area["id"]]}},
            headers=admin_headers,
        )
        client.patch(
            f"/api/contacts/{sh2['id']}",
            json={"shliach": {"area_ids": [area["id"]]}},
            headers=admin_headers,
        )

        res = client.get("/api/areas/shliach-assignments", headers=admin_headers)
        assert res.status_code == 200, res.text
        covering_ids = {s["id"] for s in res.json()[str(area["id"])]}
        assert covering_ids == {sh1["id"], sh2["id"]}

    def test_report_number_assignments_grouped_by_report_number(
        self, client, admin_headers
    ):
        rn = _mk_report_number(client, admin_headers, "RN-conflict")
        sh = _mk_shliach(client, admin_headers, "rnconf_43@example.com")
        client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"report_number_ids": [rn["id"]]}},
            headers=admin_headers,
        )

        res = client.get("/api/report-numbers/shliach-assignments", headers=admin_headers)
        assert res.status_code == 200, res.text
        covering_ids = {s["id"] for s in res.json()[str(rn["id"])]}
        assert covering_ids == {sh["id"]}


class TestRolesTable:
    """fixes43 §5.1/5.2: roles extracted into a dedicated table (users.role is
    now FK-constrained to roles.name), with the admin role's label updated to
    "system admin"."""

    def test_roles_table_seeded(self, client, admin_headers, db_session):
        from app import models

        names = {r.name for r in db_session.query(models.Role).all()}
        assert names == {"admin", "staff", "shliach", "superadmin"}

    def test_admin_role_label_is_system_admin(self, client, admin_headers, db_session):
        from app.seed import seed_localization

        seed_localization(db_session)
        data = client.get("/api/metadata/localization").json()
        assert data["users.role_admin"]["he"] == "מנהל מערכת"
        assert data["users.role_admin"]["en"] == "System admin"

    def test_user_role_ref_resolves_to_role_row(self, client, admin_headers, db_session):
        from app import models

        me = client.get("/api/auth/me", headers=admin_headers).json()
        user = db_session.query(models.User).filter(models.User.id == me["id"]).one()
        assert user.role == "admin"
        assert user.role_ref.name == "admin"


class TestShliachEditHistory:
    """fixes45: full-row shliach version history (same "one edit, one
    version" contract as the Apartments module — replaces fixes43's
    field-level diff log)."""

    def test_versions_notes_and_area_changes(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור-hist")
        sh = _mk_shliach(client, admin_headers, "hist1_43@example.com")

        # First edit: set notes.
        r = client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"notes": "note A"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        # Second edit: change notes + set an area.
        r = client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"notes": "note B", "area_ids": [area["id"]]}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["notes"] == "note B"
        assert r.json()["shliach"]["area_ids"] == [area["id"]]

        hist = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        # Newest first: the version retired by the second edit, then the one
        # retired by the first (the lineage's root, created with the contact).
        assert len(hist) == 2
        assert hist[0]["notes"] == "note A"
        assert hist[0]["area_ids"] == []
        assert hist[0]["editor_name"]  # admin's full_name
        assert hist[1]["notes"] is None
        assert hist[1]["area_ids"] == []

    def test_repeated_identical_edit_still_versions(self, client, admin_headers):
        """Matches Apartments: versioning doesn't diff old vs. new — every
        edit that touches a tracked field produces a new version, even one
        that resubmits the same value."""
        sh = _mk_shliach(client, admin_headers, "hist2_43@example.com")
        client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"notes": "same"}},
            headers=admin_headers,
        )
        client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"notes": "same"}},
            headers=admin_headers,
        )
        hist = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        assert len(hist) == 2

    def test_non_admin_forbidden(self, client, admin_headers, auth_headers):
        sh = _mk_shliach(client, admin_headers, "hist3_43@example.com")
        res = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=auth_headers
        )
        assert res.status_code == 403
