"""Fixes68: Area column on the Report Numbers page — GET
/api/report-numbers/areas backend endpoint tests. See docs/fixes68.md."""


def _mk_area(client, headers, name="שכונה 68"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Sixty-Eight St, City"):
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


class TestReportNumberAreas:
    def test_requires_admin(self, client, auth_headers):
        r = client.get("/api/report-numbers/areas", headers=auth_headers)
        assert r.status_code == 403, r.text

    def test_report_number_with_no_apartments_is_absent(self, client, admin_headers):
        rn = _mk_report_number(client, admin_headers, "68-empty")
        r = client.get("/api/report-numbers/areas", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert str(rn["id"]) not in r.json()

    def test_single_area_returned(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "שכונה 68-single")
        b = _mk_building(client, admin_headers, area["id"], "Single St, City")
        rn = _mk_report_number(client, admin_headers, "68-single")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="1",
            report_number_id=rn["id"],
        )

        r = client.get("/api/report-numbers/areas", headers=admin_headers)
        assert r.status_code == 200, r.text
        entries = r.json()[str(rn["id"])]
        assert entries == [{"id": area["id"], "area_name": area["area_name"]}]

    def test_multiple_areas_ordered_by_building_count_desc(
        self, client, admin_headers
    ):
        area_big = _mk_area(client, admin_headers, "שכונה 68-big")
        area_small = _mk_area(client, admin_headers, "שכונה 68-small")
        b_big_1 = _mk_building(client, admin_headers, area_big["id"], "Big1 St, City")
        b_big_2 = _mk_building(client, admin_headers, area_big["id"], "Big2 St, City")
        b_small = _mk_building(client, admin_headers, area_small["id"], "Small St, City")
        rn = _mk_report_number(client, admin_headers, "68-multi")
        _mk_apartment(
            client, admin_headers, b_big_1["id"], apartment_name="1",
            report_number_id=rn["id"],
        )
        _mk_apartment(
            client, admin_headers, b_big_2["id"], apartment_name="1",
            report_number_id=rn["id"],
        )
        _mk_apartment(
            client, admin_headers, b_small["id"], apartment_name="1",
            report_number_id=rn["id"],
        )

        r = client.get("/api/report-numbers/areas", headers=admin_headers)
        assert r.status_code == 200, r.text
        entries = r.json()[str(rn["id"])]
        assert [e["id"] for e in entries] == [area_big["id"], area_small["id"]]

    def test_retired_apartment_version_not_counted(self, client, admin_headers):
        area_old = _mk_area(client, admin_headers, "שכונה 68-old")
        area_new = _mk_area(client, admin_headers, "שכונה 68-new")
        b_old = _mk_building(client, admin_headers, area_old["id"], "Old St, City")
        b_new = _mk_building(client, admin_headers, area_new["id"], "New St, City")
        rn = _mk_report_number(client, admin_headers, "68-retired")
        apt = _mk_apartment(
            client, admin_headers, b_old["id"], apartment_name="1",
            report_number_id=rn["id"],
        )
        # fixes19 §3: PUT retires the current row (is_display=False) and
        # inserts a new active version — the old building/area must drop out.
        r = client.put(
            f"/api/apartments/{apt['id']}",
            json={"building_id": b_new["id"]},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text

        r = client.get("/api/report-numbers/areas", headers=admin_headers)
        assert r.status_code == 200, r.text
        entries = r.json()[str(rn["id"])]
        assert [e["id"] for e in entries] == [area_new["id"]]

    def test_route_ordering_does_not_shadow_areas_path(self, client, admin_headers):
        # A GET to /api/report-numbers/{id} with a real numeric id must still
        # work once /areas is registered before it.
        rn = _mk_report_number(client, admin_headers, "68-ordering")
        r = client.get(f"/api/report-numbers/{rn['id']}", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["id"] == rn["id"]
