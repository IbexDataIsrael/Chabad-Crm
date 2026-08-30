"""Fixes23 acceptance tests: the conditional (report number → building) filter
map, the multi-select building filter on the apartment list, and bulk editing of
the apartments matching the active filters (report number + notes)."""


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה 23"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="10 Bulk St, City"):
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


_seq = iter(range(3000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 23",
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


def _list(client, headers, qs=""):
    return client.get(f"/api/apartments/list{qs}", headers=headers).json()


# --- §2 conditional building filter map -----------------------------------------
class TestReportNumberBuildingMap:
    def test_distinct_pairs_only_for_apartments_with_report_number(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers)
        b1 = _mk_building(client, admin_headers, area["id"], "1 A St")
        b2 = _mk_building(client, admin_headers, area["id"], "2 B St")
        rn1 = _mk_report_number(client, admin_headers, "RN1")
        rn2 = _mk_report_number(client, admin_headers, "RN2")
        _mk_apartment(
            client, admin_headers, b1["id"], apartment_name="1",
            report_number_id=rn1["id"],
        )
        _mk_apartment(
            client, admin_headers, b2["id"], apartment_name="2",
            report_number_id=rn2["id"],
        )
        # A second apartment in b1 with the same report number → still one pair.
        _mk_apartment(
            client, admin_headers, b1["id"], apartment_name="3",
            report_number_id=rn1["id"],
        )
        # An apartment with no report number contributes nothing.
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="4")

        links = client.get(
            "/api/apartments/report-number-buildings", headers=admin_headers
        ).json()
        pairs = {(l["report_number_id"], l["building_id"]) for l in links}
        assert (rn1["id"], b1["id"]) in pairs
        assert (rn2["id"], b2["id"]) in pairs
        # b1 has no rn2 apartment; b2 has no rn1 apartment.
        assert (rn2["id"], b1["id"]) not in pairs
        assert (rn1["id"], b2["id"]) not in pairs
        # Distinctness: b1↔rn1 appears exactly once despite two apartments.
        assert sum(1 for p in pairs if p == (rn1["id"], b1["id"])) == 1


# --- §2 multi-select building filter on the list --------------------------------
class TestListBuildingIdsFilter:
    def test_multi_building_filter(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b1 = _mk_building(client, admin_headers, area["id"], "1 A St")
        b2 = _mk_building(client, admin_headers, area["id"], "2 B St")
        b3 = _mk_building(client, admin_headers, area["id"], "3 C St")
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="1")
        _mk_apartment(client, admin_headers, b2["id"], apartment_name="2")
        _mk_apartment(client, admin_headers, b3["id"], apartment_name="3")

        page = _list(
            client, admin_headers,
            f"?building_ids={b1['id']}&building_ids={b2['id']}",
        )
        assert page["total"] == 2
        assert sorted(i["apartment_name"] for i in page["items"]) == ["1", "2"]


# --- §3 bulk editing ------------------------------------------------------------
class TestBulkUpdate:
    def test_sets_report_number_and_notes_on_all_matching(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn1 = _mk_report_number(client, admin_headers, "RN1")
        rn2 = _mk_report_number(client, admin_headers, "RN2")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="2",
            report_number_id=rn1["id"],
        )

        res = client.post(
            "/api/apartments/bulk-update",
            json={
                "building_ids": [b["id"]],
                "changes": {
                    "report_number_id": rn2["id"],
                    "apartment_notes": "BULK",
                },
            },
            headers=admin_headers,
        )
        assert res.status_code == 200, res.text
        assert res.json()["updated"] == 2

        page = _list(client, admin_headers)
        assert page["total"] == 2  # still two active apartments (versioned)
        for item in page["items"]:
            assert item["report_number_id"] == rn2["id"]
            assert item["report_number_name"] == "RN2"
            assert item["apartment_notes"] == "BULK"

    def test_only_touches_filtered_rows(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b1 = _mk_building(client, admin_headers, area["id"], "1 A St")
        b2 = _mk_building(client, admin_headers, area["id"], "2 B St")
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="X")
        _mk_apartment(client, admin_headers, b2["id"], apartment_name="Y")

        res = client.post(
            "/api/apartments/bulk-update",
            json={
                "building_ids": [b1["id"]],
                "changes": {"apartment_notes": "ONLY-B1"},
            },
            headers=admin_headers,
        )
        assert res.json()["updated"] == 1

        by_name = {i["apartment_name"]: i for i in _list(client, admin_headers)["items"]}
        assert by_name["X"]["apartment_notes"] == "ONLY-B1"
        assert by_name["Y"]["apartment_notes"] in (None, "")

    def test_clears_report_number_when_set_to_null(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "RN")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="1",
            report_number_id=rn["id"],
        )

        res = client.post(
            "/api/apartments/bulk-update",
            json={"changes": {"report_number_id": None}},
            headers=admin_headers,
        )
        assert res.json()["updated"] == 1
        item = _list(client, admin_headers)["items"][0]
        assert item["report_number_id"] is None

    def test_no_field_selected_is_rejected(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        res = client.post(
            "/api/apartments/bulk-update",
            json={"building_ids": [b["id"]]},
            headers=admin_headers,
        )
        assert res.status_code == 400, res.text

    def test_bad_report_number_is_rejected(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        res = client.post(
            "/api/apartments/bulk-update",
            json={"changes": {"report_number_id": 999999}},
            headers=admin_headers,
        )
        assert res.status_code == 400, res.text

    def test_update_is_versioned(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        client.post(
            "/api/apartments/bulk-update",
            json={
                "building_ids": [b["id"]],
                "changes": {"apartment_notes": "v2"},
            },
            headers=admin_headers,
        )
        active_id = _list(client, admin_headers)["items"][0]["id"]
        hist = client.get(
            f"/api/apartments/{active_id}/history", headers=admin_headers
        ).json()
        assert len(hist) == 1
        assert hist[0]["is_display"] is False

    def test_shliach_bulk_update_scoped_to_their_apartments(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "RN-shliach")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="MINE",
            report_number_id=rn["id"],
        )
        _mk_apartment(client, admin_headers, b["id"], apartment_name="OTHER")

        _mk_shliach(
            client, admin_headers, "bulk23@example.com", report_number_ids=[rn["id"]]
        )
        shliach = _shliach_login(client, "bulk23@example.com")

        # The shliach sees only MINE, and a bulk update touches only it.
        res = client.post(
            "/api/apartments/bulk-update",
            json={"changes": {"apartment_notes": "S"}},
            headers=shliach,
        )
        assert res.json()["updated"] == 1

        by_name = {i["apartment_name"]: i for i in _list(client, admin_headers)["items"]}
        assert by_name["MINE"]["apartment_notes"] == "S"
        assert by_name["OTHER"]["apartment_notes"] in (None, "")
