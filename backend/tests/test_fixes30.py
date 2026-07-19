"""Fixes30 (round 2) acceptance tests: explicit apartment selection on the
list endpoint (the arbitrary-apartments report flow) and the per-building
aggregate counts behind the group-by-building view."""


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה 30"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="10 Agg St, City"):
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


_seq = iter(range(1000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 30",
            "phone": f"0553{next(_seq):06d}",
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


def _aggregates(client, headers, qs=""):
    r = client.get(f"/api/apartments/building-aggregates{qs}", headers=headers)
    assert r.status_code == 200, r.text
    return {a["building_id"]: a["count"] for a in r.json()}


# --- §3 apartment_ids filter on /list ----------------------------------------
class TestApartmentIdsFilter:
    def test_returns_exactly_the_selected_apartments(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        a1 = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        a2 = _mk_apartment(client, admin_headers, b["id"], apartment_name="2")
        _mk_apartment(client, admin_headers, b["id"], apartment_name="3")

        page = _list(
            client, admin_headers,
            f"?apartment_ids={a1['id']}&apartment_ids={a2['id']}",
        )
        assert page["total"] == 2
        assert sorted(i["apartment_name"] for i in page["items"]) == ["1", "2"]

    def test_unknown_ids_yield_nothing(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        page = _list(client, admin_headers, "?apartment_ids=987654")
        assert page["total"] == 0
        assert page["items"] == []

    def test_selection_includes_apartments_without_report_number(
        self, client, admin_headers
    ):
        # The direct-selection report flow must not require report numbers.
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        a = _mk_apartment(client, admin_headers, b["id"], apartment_name="NO-RN")

        page = _list(client, admin_headers, f"?apartment_ids={a['id']}")
        assert page["total"] == 1
        assert page["items"][0]["report_number_id"] is None


# --- §1 building aggregates ---------------------------------------------------
class TestBuildingAggregates:
    def test_counts_per_building(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b1 = _mk_building(client, admin_headers, area["id"], "1 A St")
        b2 = _mk_building(client, admin_headers, area["id"], "2 B St")
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="1")
        _mk_apartment(client, admin_headers, b1["id"], apartment_name="2")
        _mk_apartment(client, admin_headers, b2["id"], apartment_name="3")

        counts = _aggregates(client, admin_headers)
        assert counts[b1["id"]] == 2
        assert counts[b2["id"]] == 1

    def test_counts_follow_the_list_filters(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "RN30")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="1",
            report_number_id=rn["id"],
        )
        _mk_apartment(client, admin_headers, b["id"], apartment_name="2")

        counts = _aggregates(
            client, admin_headers, f"?report_number_ids={rn['id']}"
        )
        assert counts == {b["id"]: 1}

    def test_counts_only_active_versions(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        a = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")

        # A versioned edit retires the row and creates a successor — the
        # building still holds exactly one active apartment.
        r = client.put(
            f"/api/apartments/{a['id']}",
            json={"apartment_notes": "edited"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        counts = _aggregates(client, admin_headers)
        assert counts == {b["id"]: 1}

    def test_shliach_sees_only_covered_apartments(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b1 = _mk_building(client, admin_headers, area["id"], "1 A St")
        b2 = _mk_building(client, admin_headers, area["id"], "2 B St")
        rn = _mk_report_number(client, admin_headers, "RN30-s")
        _mk_apartment(
            client, admin_headers, b1["id"], apartment_name="MINE",
            report_number_id=rn["id"],
        )
        _mk_apartment(client, admin_headers, b2["id"], apartment_name="OTHER")

        _mk_shliach(
            client, admin_headers, "agg30@example.com", report_number_ids=[rn["id"]]
        )
        shliach = _shliach_login(client, "agg30@example.com")

        counts = _aggregates(client, shliach)
        assert counts == {b1["id"]: 1}
