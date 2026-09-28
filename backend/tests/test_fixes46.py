"""Fixes46 acceptance tests: the Users page's real ContactShliach link
(replacing the frontend's old email-matching) plus notes/area_ids/
report_number_ids becoming editable — and versioned — from that page, not
just the contact's own shliach form."""


_seq = iter(range(46000, 46999))


def _mk_area(client, headers, name="אזור 46"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_report_number(client, headers, name="RN-46"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 46",
            "phone": f"0559{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_staff_user(client, headers, email):
    r = client.post(
        "/api/users",
        json={"full_name": "צוות 46", "email": email, "role": "staff", "password": "Pass1234"},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


class TestUsersShliachLink:
    """GET /api/users resolves the real ContactShliach.user_id link — was an
    email-matching guess made entirely on the frontend before."""

    def test_shliach_row_carries_contact_link_and_coverage(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור-46a")
        sh = _mk_shliach(client, admin_headers, "u46a@example.com")
        client.patch(
            f"/api/contacts/{sh['id']}",
            json={"shliach": {"notes": "n1", "area_ids": [area["id"]]}},
            headers=admin_headers,
        )
        users = client.get("/api/users", headers=admin_headers).json()
        row = next(u for u in users if u["email"] == "u46a@example.com")
        assert row["shliach"] is not None
        assert row["shliach"]["contact_id"] == sh["id"]
        assert row["shliach"]["notes"] == "n1"
        assert row["shliach"]["area_ids"] == [area["id"]]

    def test_staff_row_has_no_shliach_link(self, client, admin_headers):
        _mk_staff_user(client, admin_headers, "u46b@example.com")
        users = client.get("/api/users", headers=admin_headers).json()
        row = next(u for u in users if u["email"] == "u46b@example.com")
        assert row["shliach"] is None


class TestUsersShliachEdit:
    """PUT /api/users/{id} can now edit notes/area_ids/report_number_ids —
    not just full_name/email/phone — and every edit still versions
    ContactShliach exactly like the contact's own shliach form does."""

    def test_notes_edit_versions_and_returns_fresh_value(self, client, admin_headers):
        sh = _mk_shliach(client, admin_headers, "u46c@example.com")
        user_id = sh["shliach"]["user_id"]

        r = client.put(
            f"/api/users/{user_id}",
            json={"shliach": {"notes": "hello"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["notes"] == "hello"

        hist = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        assert len(hist) == 1
        assert hist[0]["notes"] is None  # the pre-edit (root) version

    def test_identity_and_coverage_edit_in_one_request_yields_one_version(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers, "אזור-46d")
        rn = _mk_report_number(client, admin_headers, "RN-46d")
        sh = _mk_shliach(client, admin_headers, "u46d@example.com")
        user_id = sh["shliach"]["user_id"]

        r = client.put(
            f"/api/users/{user_id}",
            json={
                "full_name": "שם חדש",
                "shliach": {"area_ids": [area["id"]], "report_number_ids": [rn["id"]]},
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["full_name"] == "שם חדש"
        assert body["shliach"]["full_name"] == "שם חדש"
        assert body["shliach"]["area_ids"] == [area["id"]]
        assert body["shliach"]["report_number_ids"] == [rn["id"]]

        # One combined edit -> exactly one retired version, not two.
        hist = client.get(
            f"/api/contacts/{sh['id']}/shliach-history", headers=admin_headers
        ).json()
        assert len(hist) == 1

    def test_email_edit_resends_the_welcome_email_to_the_new_address(
        self, client, admin_headers, monkeypatch
    ):
        """fixes69 Admin§1: the old address is dead the moment the login
        identity moves — resend the same access-link email new users get."""
        sent = []
        monkeypatch.setattr(
            "app.routers.users.send_shliach_welcome",
            lambda *a, **kw: sent.append(kw.get("to")),
        )
        sh = _mk_shliach(client, admin_headers, "u46h@example.com")
        user_id = sh["shliach"]["user_id"]

        r = client.put(
            f"/api/users/{user_id}",
            json={"email": "u46h-new@example.com"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert sent == ["u46h-new@example.com"]

    def test_full_name_edit_updates_the_contact_and_login_display_name(
        self, client, admin_headers
    ):
        """fixes69 Bug 1: editing full_name here versioned ContactShliach and
        User.full_name, but never touched the underlying Contact row that
        GET /api/auth/me's display_name (the header/greeting the shliach
        actually sees) is resolved from — so the rename never visibly stuck."""
        sh = _mk_shliach(client, admin_headers, "u46g@example.com")
        user_id = sh["shliach"]["user_id"]

        r = client.put(
            f"/api/users/{user_id}",
            json={"full_name": "טסט כהן"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        contact = client.get(f"/api/contacts/{sh['id']}", headers=admin_headers).json()
        assert contact["name"] == "טסט"
        assert contact["last_name"] == "כהן"

        login = client.post(
            "/api/auth/token",
            data={"username": "u46g@example.com", "password": "pw12345"},
        )
        assert login.status_code == 200, login.text
        me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        ).json()
        assert me["display_name"] == "טסט כהן"

    def test_partial_edit_does_not_wipe_other_shliach_fields(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור-46e")
        rn = _mk_report_number(client, admin_headers, "RN-46e")
        sh = _mk_shliach(client, admin_headers, "u46e@example.com")
        user_id = sh["shliach"]["user_id"]

        client.put(
            f"/api/users/{user_id}",
            json={"shliach": {"area_ids": [area["id"]], "report_number_ids": [rn["id"]]}},
            headers=admin_headers,
        )
        # Only touch notes this time — area/report links must survive.
        r = client.put(
            f"/api/users/{user_id}",
            json={"shliach": {"notes": "later"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"]["notes"] == "later"
        assert r.json()["shliach"]["area_ids"] == [area["id"]]
        assert r.json()["shliach"]["report_number_ids"] == [rn["id"]]

    def test_shliach_payload_on_unlinked_staff_user_is_a_no_op(self, client, admin_headers):
        staff = _mk_staff_user(client, admin_headers, "u46f@example.com")
        r = client.put(
            f"/api/users/{staff['id']}",
            json={"shliach": {"notes": "should be ignored"}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["shliach"] is None
