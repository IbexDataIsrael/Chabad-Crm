"""Fixes53 acceptance tests. See docs/fixes53.md's Progress Log for what
each round covers — grown incrementally alongside the implementation."""
from urllib.parse import urlencode

# Must exactly match apartments.py's EMPTY_FIELD_SENTINEL.
_EMPTY = "\x00__empty__\x00"


# --- Builders ------------------------------------------------------------
def _mk_area(client, headers, name="שכונה 53"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Fifty-Three St, City"):
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


_seq = iter(range(5000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל 53",
            "phone": f"0554{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_field(client, headers, entity_type, field_type, field_key, **kw):
    payload = {
        "field_key": field_key,
        "hebrew_label": "שדה בדיקה 53",
        "entity_type": entity_type,
        "field_type": field_type,
        **kw,
    }
    r = client.post("/api/custom-fields", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _list(client, headers, qs=""):
    return client.get(f"/api/apartments/list{qs}", headers=headers).json()


def _shliach_login(client, email):
    token = client.post(
        "/api/auth/token", data={"username": email, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- §2 Mandatory Grid Hierarchy Sorting ----------------------------------
class TestHierarchySort:
    def test_orders_by_report_number_then_building_then_floor(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers, "שכונה 53-hier")
        b_a = _mk_building(client, admin_headers, area["id"], "A St, City")
        b_z = _mk_building(client, admin_headers, area["id"], "Z St, City")
        rn1 = _mk_report_number(client, admin_headers, "1-hier53")
        rn2 = _mk_report_number(client, admin_headers, "2-hier53")

        # rn2/b_a should still sort before rn1's own rows are exhausted only
        # once rn1 is done — report number is the outermost tier.
        _mk_apartment(
            client, admin_headers, b_z["id"], apartment_name="1",
            report_number_id=rn1["id"],
        )
        _mk_apartment(
            client, admin_headers, b_a["id"], apartment_name="1",
            report_number_id=rn1["id"],
        )
        _mk_apartment(
            client, admin_headers, b_a["id"], apartment_name="1",
            report_number_id=rn2["id"],
        )

        page = _list(
            client, admin_headers,
            f"?area_ids={area['id']}&sort=hierarchy&page=1&page_size=20",
        )
        buildings = [a["building_id"] for a in page["items"]]
        report_numbers = [a["report_number_id"] for a in page["items"]]
        assert report_numbers == [rn1["id"], rn1["id"], rn2["id"]]
        # Within rn1, b_a (A St) sorts before b_z (Z St).
        assert buildings[:2] == [b_a["id"], b_z["id"]]

    def test_dir_desc_is_ignored_hierarchy_always_ascends(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers, "שכונה 53-hier-desc")
        b = _mk_building(client, admin_headers, area["id"], "Desc St, City")
        rn = _mk_report_number(client, admin_headers, "3-hier53")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="1",
            report_number_id=rn["id"],
        )

        asc = _list(
            client, admin_headers,
            f"?area_ids={area['id']}&sort=hierarchy&dir=asc&page_size=20",
        )
        desc = _list(
            client, admin_headers,
            f"?area_ids={area['id']}&sort=hierarchy&dir=desc&page_size=20",
        )
        assert [a["id"] for a in asc["items"]] == [a["id"] for a in desc["items"]]

    def test_apartments_without_a_report_number_sort_last(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers, "שכונה 53-hier-null")
        b = _mk_building(client, admin_headers, area["id"], "Null St, City")
        rn = _mk_report_number(client, admin_headers, "4-hier53")
        no_rn = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        with_rn = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="2",
            report_number_id=rn["id"],
        )

        page = _list(
            client, admin_headers,
            f"?area_ids={area['id']}&sort=hierarchy&page_size=20",
        )
        ids = [a["id"] for a in page["items"]]
        assert ids.index(with_rn["id"]) < ids.index(no_rn["id"])


# --- §2 Data Grid Filtering: "Empty" text-field selection -----------------
class TestEmptyFieldFilter:
    def test_matches_apartments_with_no_value_at_all(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "שכונה 53-empty")
        b = _mk_building(client, admin_headers, area["id"], "Empty St, City")
        _mk_field(client, admin_headers, "apartment", "text", "note53")
        a1 = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        a2 = _mk_apartment(client, admin_headers, b["id"], apartment_name="2")
        client.put(
            f"/api/apartments/{a2['id']}",
            json={"custom_field_values": {"note53": "has a value"}},
            headers=admin_headers,
        )

        qs = urlencode(
            {"area_ids": area["id"], "custom_field_filter": f"note53:{_EMPTY}"}
        )
        page = _list(client, admin_headers, f"?{qs}")
        ids = [a["id"] for a in page["items"]]
        assert a1["id"] in ids
        assert a2["id"] not in ids

    def test_matches_apartments_cleared_back_to_blank_string(
        self, client, admin_headers
    ):
        # custom_field_utils only deletes the row on a null value — a value
        # explicitly cleared to "" leaves a row with value="" behind, and
        # that must still count as "empty".
        area = _mk_area(client, admin_headers, "שכונה 53-empty-blank")
        b = _mk_building(client, admin_headers, area["id"], "Blank St, City")
        _mk_field(client, admin_headers, "apartment", "text", "note53b")
        a = _mk_apartment(client, admin_headers, b["id"], apartment_name="1")
        # fixes19 §3: PUT versions the row — retires `a["id"]` and returns a
        # new active id; assert against the response, not the create id.
        r = client.put(
            f"/api/apartments/{a['id']}",
            json={"custom_field_values": {"note53b": ""}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        current_id = r.json()["id"]

        qs = urlencode(
            {"area_ids": area["id"], "custom_field_filter": f"note53b:{_EMPTY}"}
        )
        page = _list(client, admin_headers, f"?{qs}")
        assert current_id in [row["id"] for row in page["items"]]


# --- §3/§4 "Number of Jews" / "Number of Engaged Jews" calculated columns -
class TestJewishCounts:
    def _mk_scenario(self, client, admin_headers, area_suffix):
        area = _mk_area(client, admin_headers, f"שכונה 53-jc{area_suffix}")
        b = _mk_building(client, admin_headers, area["id"], f"JC{area_suffix} St, City")
        rn = _mk_report_number(client, admin_headers, f"jc{area_suffix}")
        # 5 real statuses (all count toward "jews"); 2 of them ("interested"
        # variants) also count toward "engaged"; "na" and unset count toward
        # neither.
        for i, status in enumerate(
            [
                "jewish", "jewish_gentile", "jewish_shtumtz",
                "jewish_interested", "jewish_interested_gentile", "na",
            ]
        ):
            _mk_apartment(
                client, admin_headers, b["id"], apartment_name=str(i),
                report_number_id=rn["id"], jewish_status=status,
            )
        _mk_apartment(  # no jewish_status set at all
            client, admin_headers, b["id"], apartment_name="unset",
            report_number_id=rn["id"],
        )
        return area, rn

    def test_report_number_counts(self, client, admin_headers):
        _, rn = self._mk_scenario(client, admin_headers, "rn")
        r = client.get("/api/report-numbers/jewish-counts", headers=admin_headers)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts[str(rn["id"])] == {"jews": 5, "engaged": 2}

    def test_area_counts(self, client, admin_headers):
        area, _ = self._mk_scenario(client, admin_headers, "area")
        r = client.get("/api/areas/jewish-counts", headers=admin_headers)
        assert r.status_code == 200, r.text
        counts = r.json()
        assert counts[str(area["id"])] == {"jews": 5, "engaged": 2}

    def test_report_number_with_no_matches_is_absent_not_erroring(
        self, client, admin_headers
    ):
        rn = _mk_report_number(client, admin_headers, "jc-empty")
        r = client.get("/api/report-numbers/jewish-counts", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert str(rn["id"]) not in r.json()


# --- §7/§8 shliach self-edit field locks ----------------------------------
class TestShliachSelfEditLocks:
    def test_self_edit_cannot_change_email_report_numbers_or_areas(
        self, client, admin_headers
    ):
        area = _mk_area(client, admin_headers, "שכונה 53-selfedit")
        rn = _mk_report_number(client, admin_headers, "selfedit53")
        sh = _mk_shliach(
            client, admin_headers, "selfedit53@example.com",
            report_number_ids=[rn["id"]], area_ids=[area["id"]],
        )
        other_area = _mk_area(client, admin_headers, "שכונה 53-selfedit-other")
        other_rn = _mk_report_number(client, admin_headers, "selfedit53-other")
        headers = _shliach_login(client, "selfedit53@example.com")

        r = client.patch(
            f"/api/contacts/{sh['id']}",
            json={
                "email": "hijacked@example.com",
                "phone": "0559998888",
                "shliach": {
                    "report_number_ids": [other_rn["id"]],
                    "area_ids": [other_area["id"]],
                },
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == "selfedit53@example.com"  # unchanged
        assert body["phone"] == "0559998888"  # not locked — went through
        assert body["shliach"]["report_number_ids"] == [rn["id"]]  # unchanged
        assert body["shliach"]["area_ids"] == [area["id"]]  # unchanged

    def test_admin_editing_the_same_shliach_is_unrestricted(
        self, client, admin_headers
    ):
        rn = _mk_report_number(client, admin_headers, "selfedit53-admin")
        sh = _mk_shliach(client, admin_headers, "selfedit53-admin@example.com")

        r = client.patch(
            f"/api/contacts/{sh['id']}",
            json={
                "email": "admin-changed@example.com",
                "shliach": {"report_number_ids": [rn["id"]]},
            },
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == "admin-changed@example.com"
        assert body["shliach"]["report_number_ids"] == [rn["id"]]

    def test_admin_configured_extra_lock_blocks_phone(self, client, admin_headers):
        r = client.put(
            "/api/organizations/me",
            json={"shliach_view_config": {"self_edit_locked_fields": ["phone"]}},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        sh = _mk_shliach(client, admin_headers, "selfedit53-locked@example.com")
        headers = _shliach_login(client, "selfedit53-locked@example.com")

        r = client.patch(
            f"/api/contacts/{sh['id']}",
            json={"phone": "0551112222"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["phone"] != "0551112222"

        # Clean up the org-wide config so it doesn't leak into other tests
        # sharing this org/admin.
        client.put(
            "/api/organizations/me",
            json={"shliach_view_config": {}},
            headers=admin_headers,
        )


# --- §7/§9 shliach report-completion + system-comments logs ----------------
class TestShliachMessages:
    def test_shliach_submits_report_completion_and_admin_sees_it(
        self, client, admin_headers
    ):
        sh = _mk_shliach(client, admin_headers, "msg53@example.com")
        headers = _shliach_login(client, "msg53@example.com")

        r = client.post(
            "/api/shliach-messages/report-completions",
            json={"status": "completed", "comments": "all done"},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["status"] == "completed"
        assert body["comments"] == "all done"
        assert body["activist"]["id"] == sh["id"]

        r = client.get("/api/shliach-messages/report-completions", headers=admin_headers)
        assert r.status_code == 200, r.text
        ids = [row["id"] for row in r.json()]
        assert body["id"] in ids

    def test_shliach_submits_system_comment_and_admin_sees_it(
        self, client, admin_headers
    ):
        sh = _mk_shliach(client, admin_headers, "msg53-comment@example.com")
        headers = _shliach_login(client, "msg53-comment@example.com")

        r = client.post(
            "/api/shliach-messages/system-comments",
            json={"comment": "please add dark mode"},
            headers=headers,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["comment"] == "please add dark mode"
        assert body["activist"]["id"] == sh["id"]

        r = client.get("/api/shliach-messages/system-comments", headers=admin_headers)
        assert r.status_code == 200, r.text
        ids = [row["id"] for row in r.json()]
        assert body["id"] in ids

    def test_non_shliach_cannot_submit(self, client, admin_headers):
        r = client.post(
            "/api/shliach-messages/report-completions",
            json={"status": "completed"},
            headers=admin_headers,
        )
        assert r.status_code == 403, r.text

    def test_shliach_cannot_read_the_org_log(self, client, admin_headers):
        _mk_shliach(client, admin_headers, "msg53-noread@example.com")
        headers = _shliach_login(client, "msg53-noread@example.com")
        r = client.get("/api/shliach-messages/report-completions", headers=headers)
        assert r.status_code == 403, r.text
        r = client.get("/api/shliach-messages/system-comments", headers=headers)
        assert r.status_code == 403, r.text

    def test_blank_comment_is_rejected(self, client, admin_headers):
        _mk_shliach(client, admin_headers, "msg53-blank@example.com")
        headers = _shliach_login(client, "msg53-blank@example.com")
        r = client.post(
            "/api/shliach-messages/system-comments",
            json={"comment": "   "},
            headers=headers,
        )
        assert r.status_code == 400, r.text
