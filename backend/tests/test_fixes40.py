"""Fixes40 acceptance tests: visits_summary's new `assigned_user_id` owner
filter (§3) and the organization's global label-styling fields (§4).

Covered elsewhere: the custom-fields 3-tab UI and the reports column
chip-panel reorder are frontend-only (§1, §5) — live-drive verified, no
backend surface to test.
"""

_seq = iter(range(6000, 9999))


# --- Builders ----------------------------------------------------------------
def _mk_mekurav(client, headers, name, **extra):
    r = client.post(
        "/api/contacts",
        json={"name": name, "contact_type": "mekurav", **extra},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_visit(client, headers, contact_id, visit_date):
    r = client.post(
        f"/api/contacts/{contact_id}/visits",
        json={"visit_date": visit_date},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_staff_same_org(client, admin_headers, email="staff40@example.com"):
    r = client.post(
        "/api/users",
        json={
            "full_name": "צוות 40",
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


def _mk_shliach(client, headers, email):
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 40",
            "phone": f"0538{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": {"password": "pw12345"},
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


# --- §3: assigned_user_id on /api/visits/summary ----------------------------
class TestVisitsSummaryOwnerFilter:
    def test_scopes_to_the_named_user(self, client, admin_headers):
        _, staff_a = _mk_staff_same_org(client, admin_headers, email="owner-a40@example.com")
        _, staff_b = _mk_staff_same_org(client, admin_headers, email="owner-b40@example.com")
        me_a = client.get("/api/auth/me", headers=staff_a).json()
        me_b = client.get("/api/auth/me", headers=staff_b).json()
        c_a = _mk_mekurav(client, admin_headers, "של א", assigned_user_id=me_a["guid"])
        c_b = _mk_mekurav(client, admin_headers, "של ב", assigned_user_id=me_b["guid"])
        _mk_visit(client, admin_headers, c_a["id"], "2026-04-01T10:00:00")
        _mk_visit(client, admin_headers, c_b["id"], "2026-04-01T10:00:00")

        # The admin (whose own default scope would otherwise find nothing —
        # neither contact is assigned to them) asks for staff_a's contacts.
        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-04-01",
                "date_to": "2026-04-30",
                "assigned_user_id": me_a["guid"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1

    def test_takes_priority_over_scope_all(self, client, admin_headers):
        _, staff_a = _mk_staff_same_org(client, admin_headers, email="owner-c40@example.com")
        me_a = client.get("/api/auth/me", headers=staff_a).json()
        c_a = _mk_mekurav(client, admin_headers, "יחיד", assigned_user_id=me_a["guid"])
        other = _mk_mekurav(client, admin_headers, "אחר")
        _mk_visit(client, admin_headers, c_a["id"], "2026-04-01T10:00:00")
        _mk_visit(client, admin_headers, other["id"], "2026-04-01T10:00:00")

        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-04-01",
                "date_to": "2026-04-30",
                "assigned_user_id": me_a["guid"],
                "scope_all": "true",
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == 1

    def test_shliach_cannot_use_it_to_see_anothers_contacts(self, client, admin_headers):
        """A shliach account passing assigned_user_id must still only ever
        see their own contacts — same guarantee the default branch already
        gave them before this param existed."""
        _, staff_a = _mk_staff_same_org(client, admin_headers, email="owner-d40@example.com")
        me_a = client.get("/api/auth/me", headers=staff_a).json()
        c_a = _mk_mekurav(client, admin_headers, "שייך לצוות", assigned_user_id=me_a["guid"])
        _mk_visit(client, admin_headers, c_a["id"], "2026-04-01T10:00:00")

        sh = _mk_shliach(client, admin_headers, "snoop40@example.com")
        shliach_headers = _shliach_login(client, "snoop40@example.com")

        r = client.get(
            "/api/visits/summary",
            params={
                "date_from": "2026-04-01",
                "date_to": "2026-04-30",
                "assigned_user_id": me_a["guid"],
            },
            headers=shliach_headers,
        )
        assert r.status_code == 200, r.text
        # Not staff_a's contact — the shliach only ever sees their own.
        assert r.json()["total"] == 0


# --- §4: organization label-styling fields -----------------------------------
class TestOrgLabelStyling:
    def test_roundtrip(self, client, admin_headers):
        got = client.get("/api/organizations/me", headers=admin_headers).json()
        assert got["label_font_size"] is None
        assert got["label_color"] is None
        assert got["label_font_family"] is None

        upd = client.put(
            "/api/organizations/me",
            json={
                "label_font_size": 18,
                "label_color": "#d6006e",
                "label_font_family": "Georgia",
            },
            headers=admin_headers,
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["label_font_size"] == 18
        assert upd.json()["label_color"] == "#d6006e"
        assert upd.json()["label_font_family"] == "Georgia"

        got_again = client.get("/api/organizations/me", headers=admin_headers).json()
        assert got_again["label_font_size"] == 18

    def test_can_be_cleared_independently(self, client, admin_headers):
        client.put(
            "/api/organizations/me",
            json={"label_font_size": 20, "label_color": "#111111"},
            headers=admin_headers,
        )
        # Sending just font_size=null clears only that property.
        upd = client.put(
            "/api/organizations/me",
            json={"label_font_size": None},
            headers=admin_headers,
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["label_font_size"] is None
        assert upd.json()["label_color"] == "#111111"

    def test_staff_cannot_update(self, client, admin_headers, auth_headers):
        r = client.put(
            "/api/organizations/me",
            json={"label_font_size": 16},
            headers=auth_headers,
        )
        assert r.status_code == 403
