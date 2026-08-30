"""Fixes54 acceptance tests: shliach-announcements CRUD + visibility
filtering, apartment sort-key additions, and the _linked_shliach email
fallback bug fix (§6.2)."""


# --- Builders --------------------------------------------------------------
def _mk_area(client, headers, name="שכונה 54"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Fifty-Four St, City"):
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


def _mk_report_number(client, headers, name):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(6000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 54",
            "phone": f"0555{next(_seq):06d}",
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


def _list(client, headers, qs=""):
    return client.get(f"/api/apartments/list{qs}", headers=headers).json()


# --- §5: shliach-announcements CRUD + visibility ---------------------------
class TestShliachAnnouncements:
    def test_admin_full_crud(self, client, admin_headers):
        r = client.post(
            "/api/shliach-messages/announcements",
            json={"message_title": "עדכון 1", "message_content": "<p>שלום</p>"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        row = r.json()
        assert row["is_visible"] is True
        assert row["message_content"] == "<p>שלום</p>"

        r = client.put(
            f"/api/shliach-messages/announcements/{row['id']}",
            json={"message_title": "עדכון 1 מעודכן", "is_visible": False},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["message_title"] == "עדכון 1 מעודכן"
        assert updated["is_visible"] is False
        # content untouched (exclude_unset — wasn't sent).
        assert updated["message_content"] == "<p>שלום</p>"

        r = client.delete(
            f"/api/shliach-messages/announcements/{row['id']}", headers=admin_headers
        )
        assert r.status_code == 204, r.text
        r = client.get("/api/shliach-messages/announcements", headers=admin_headers)
        assert row["id"] not in [a["id"] for a in r.json()]

    def test_non_admin_cannot_write(self, client, admin_headers, auth_headers):
        r = client.post(
            "/api/shliach-messages/announcements",
            json={"message_title": "x", "message_content": "y"},
            headers=auth_headers,
        )
        assert r.status_code == 403, r.text

    def test_shliach_only_sees_visible_ones(self, client, admin_headers):
        client.post(
            "/api/shliach-messages/announcements",
            json={"message_title": "גלוי", "message_content": "a", "is_visible": True},
            headers=admin_headers,
        )
        client.post(
            "/api/shliach-messages/announcements",
            json={"message_title": "מוסתר", "message_content": "b", "is_visible": False},
            headers=admin_headers,
        )
        _mk_shliach(client, admin_headers, "ann54@example.com")
        headers = _shliach_login(client, "ann54@example.com")

        r = client.get("/api/shliach-messages/announcements", headers=headers)
        assert r.status_code == 200, r.text
        titles = [a["message_title"] for a in r.json()]
        assert "גלוי" in titles
        assert "מוסתר" not in titles

        r = client.get("/api/shliach-messages/announcements", headers=admin_headers)
        titles = [a["message_title"] for a in r.json()]
        assert "גלוי" in titles and "מוסתר" in titles


# --- §1.1: apartment sort-key additions -------------------------------------
class TestApartmentSortAdditions:
    def test_sort_by_notes_phone_email(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "שכונה 54-sort")
        b = _mk_building(client, admin_headers, area["id"], "Sort St, City")
        _mk_apartment(
            client, admin_headers, b["id"],
            apartment_notes="zzz", phone="0500000002", email="zzz@example.com",
        )
        _mk_apartment(
            client, admin_headers, b["id"],
            apartment_notes="aaa", phone="0500000001", email="aaa@example.com",
        )

        for field in ("notes", "phone", "email"):
            items = _list(
                client, admin_headers, f"?building_id={b['id']}&sort={field}&dir=asc"
            )["items"]
            assert len(items) == 2
            src_field = "apartment_notes" if field == "notes" else field
            values = [it[src_field] for it in items]
            assert values == sorted(values)

    def test_sort_by_area_and_report_number(self, client, admin_headers):
        area_a = _mk_area(client, admin_headers, "אזור-א 54")
        area_b = _mk_area(client, admin_headers, "אזור-ב 54")
        b_a = _mk_building(client, admin_headers, area_a["id"], "A St 54, City")
        b_b = _mk_building(client, admin_headers, area_b["id"], "B St 54, City")
        rn1 = _mk_report_number(client, admin_headers, "RN54-1")
        rn2 = _mk_report_number(client, admin_headers, "RN54-2")
        _mk_apartment(client, admin_headers, b_a["id"], report_number_id=rn1["id"])
        _mk_apartment(client, admin_headers, b_b["id"], report_number_id=rn2["id"])

        items = _list(
            client, admin_headers,
            f"?building_ids={b_a['id']}&building_ids={b_b['id']}&sort=area&dir=asc",
        )["items"]
        assert [it["area_name"] for it in items] == sorted(
            it["area_name"] for it in items
        )

        items = _list(
            client, admin_headers,
            f"?building_ids={b_a['id']}&building_ids={b_b['id']}&sort=report_number&dir=asc",
        )["items"]
        assert [it["report_number_name"] for it in items] == ["RN54-1", "RN54-2"]


# --- §6.2: _linked_shliach email fallback -----------------------------------
class TestLinkedShliachEmailFallback:
    def test_me_resolves_shliach_via_email_when_user_id_link_is_broken(
        self, client, admin_headers, db_session
    ):
        from app import models

        contact = _mk_shliach(client, admin_headers, "unlinked54@example.com")
        # Simulate the fixes21 scenario: the login user exists and matches by
        # email, but ContactShliach.user_id was never wired (or was cleared).
        row = (
            db_session.query(models.ContactShliach)
            .filter(models.ContactShliach.contact_id == contact["id"])
            .first()
        )
        assert row is not None
        row.user_id = None
        db_session.commit()

        headers = _shliach_login(client, "unlinked54@example.com")
        r = client.get("/api/auth/me", headers=headers)
        assert r.status_code == 200, r.text
        me = r.json()
        # Before the fix this was null — isOwnShliachProfile (and every
        # other self-edit gate derived from it) would then always be False.
        assert me["shliach"] is not None
        assert me["shliach"]["contact_id"] == contact["id"]
