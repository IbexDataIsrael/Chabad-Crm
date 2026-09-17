"""Fixes64 acceptance tests: floor "L" always sorts first (even when the
create_building payload doesn't already put it first), and deleting a shliach
contact (with or without a login email) no longer 500s."""

_phone = [9500]


def _mk_area(client, headers, name="שכונה סד"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_shliach(client, headers, email=None, **overrides):
    _phone[0] += 1
    payload = {
        "name": "פעיל",
        "last_name": "בדיקה",
        "phone": f"050-77{_phone[0]:05d}",
        "contact_type": "shliach",
        "email": email,
        "shliach": {"area_ids": []},
    }
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=headers)


# --- §1 floor "L" always sorts first ------------------------------------------
class TestLobbyFloorSort:
    def test_l_not_first_in_payload_still_sorts_first(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        # "L" is deliberately last in the input list — create_building() must
        # not just take the raw list index as sort_order (that was the bug).
        r = client.post(
            "/api/buildings",
            json={
                "area_id": area["id"],
                "building_address": "64 Lobby Ave, City",
                "floors": ["1", "2", "L"],
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        building_id = r.json()["id"]
        floors = client.get(
            f"/api/buildings/{building_id}/floors", headers=admin_headers
        ).json()
        by_name = {f["name"]: f["sort_order"] for f in floors}
        assert by_name["L"] < by_name["1"] < by_name["2"]

    def test_l_added_via_add_floor_after_others_still_sorts_first(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers)
        r = client.post(
            "/api/buildings",
            json={
                "area_id": area["id"],
                "building_address": "65 Lobby Ave, City",
                "floors": ["1", "2"],
            },
            headers=admin_headers,
        )
        building_id = r.json()["id"]
        r = client.post(
            f"/api/buildings/{building_id}/floors",
            json={"name": "L"},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        floors = client.get(
            f"/api/buildings/{building_id}/floors", headers=admin_headers
        ).json()
        by_name = {f["name"]: f["sort_order"] for f in floors}
        assert by_name["L"] < by_name["1"] < by_name["2"]


# --- §2/§4 deleting a shliach contact ------------------------------------------
class TestDeleteShliachContact:
    def test_delete_shliach_without_email(self, client, admin_headers):
        # fixes64 §2: an activist created with no login (no email) at all.
        r = _mk_shliach(client, admin_headers, email=None)
        assert r.status_code == 201, r.text
        contact_id = r.json()["id"]
        assert (
            client.delete(f"/api/contacts/{contact_id}", headers=admin_headers).status_code
            == 204
        )

    def test_delete_shliach_with_email_and_login(self, client, admin_headers):
        # Regression test: SQLAlchemy's default one-to-one delete handling
        # used to try to NULL contact_shliach.contact_id on flush (a NOT NULL
        # column) instead of letting the DB's own ON DELETE CASCADE run,
        # raising an IntegrityError for every shliach-contact delete.
        # (The actual row cleanup this enables is real-Postgres-only —
        # SQLite here doesn't enforce FKs, per the project's established
        # "SQLite tests miss FK bugs" rule — so this only re-asserts the
        # delete call itself no longer 500s.)
        r = _mk_shliach(client, admin_headers, email="fixes64.shliach@example.com")
        assert r.status_code == 201, r.text
        contact_id = r.json()["id"]
        assert (
            client.delete(f"/api/contacts/{contact_id}", headers=admin_headers).status_code
            == 204
        )
