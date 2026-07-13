"""Fixes20 acceptance tests: shliach apartment visibility via report numbers,
apartment-list report_number filter + name enrichment, apartment-title
concatenation, and the default-hidden contact fields registry."""
from app.field_registry import DEFAULT_HIDDEN, TOGGLEABLE_KEYS, default_visible


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה כ"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="20 Report Blvd, City"):
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


def _mk_report_number(client, headers, name="דוח כ"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(2000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    """Create a shliach contact. Creation auto-provisions its login user; a
    password makes that login usable for the visibility assertions."""
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל כ",
            "phone": f"0549{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _shliach_login(client, email):
    """Log in as the shliach's auto-provisioned login user (email + password)."""
    token = client.post(
        "/api/auth/token", data={"username": email, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- §4 shliach apartment visibility via report numbers -------------------------
class TestShliachSeesApartmentsViaReportNumber:
    def test_report_number_grants_visibility(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "דוח פעיל")
        covered = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="COVERED",
            report_number_id=rn["id"],
        )
        _mk_apartment(client, admin_headers, b["id"], apartment_name="OTHER")

        _mk_shliach(
            client, admin_headers, "rn.vis@example.com",
            report_number_ids=[rn["id"]],
        )
        shliach = _shliach_login(client, "rn.vis@example.com")

        names = [
            a["apartment_name"]
            for a in client.get("/api/apartments", headers=shliach).json()
        ]
        assert names == ["COVERED"]
        # The enriched list is scoped the same way.
        page = client.get("/api/apartments/list", headers=shliach).json()
        assert [a["id"] for a in page["items"]] == [covered["id"]]

    def test_no_report_number_no_visibility(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "דוח אחר")
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="X",
            report_number_id=rn["id"],
        )
        # A shliach covering neither the area nor the report number sees nothing.
        _mk_shliach(client, admin_headers, "empty20@example.com")
        shliach = _shliach_login(client, "empty20@example.com")
        assert client.get("/api/apartments", headers=shliach).json() == []


# --- §3 apartment-list report_number filter + name enrichment -------------------
class TestApartmentListReportNumber:
    def test_filter_and_name(self, client, admin_headers):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn1 = _mk_report_number(client, admin_headers, "דוח 1")
        rn2 = _mk_report_number(client, admin_headers, "דוח 2")
        a1 = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="1",
            report_number_id=rn1["id"],
        )
        _mk_apartment(
            client, admin_headers, b["id"], apartment_name="2",
            report_number_id=rn2["id"],
        )

        # The name is enriched onto every row.
        page = client.get("/api/apartments/list", headers=admin_headers).json()
        by_id = {a["id"]: a for a in page["items"]}
        assert by_id[a1["id"]]["report_number_name"] == "דוח 1"

        # Filtering by report number narrows the list.
        filtered = client.get(
            f"/api/apartments/list?report_number_ids={rn1['id']}",
            headers=admin_headers,
        ).json()
        assert [a["id"] for a in filtered["items"]] == [a1["id"]]


# --- §2 default-hidden contact fields registry ----------------------------------
class TestDefaultHiddenFields:
    def test_registry_exposes_and_hides(self, client, admin_headers):
        # coordinates is a new toggleable field.
        assert "contacts.coordinates" in TOGGLEABLE_KEYS
        # all three ship hidden by default.
        for key in (
            "contacts.assigned_user_id",
            "contacts.coordinates",
            "contacts.color_tag",
        ):
            assert key in DEFAULT_HIDDEN
            assert default_visible(key) is False

        # They surface (hidden) in the field-settings API for a fresh org.
        rows = client.get("/api/field-settings", headers=admin_headers).json()
        by_key = {r["field_key"]: r for r in rows}
        for key in (
            "contacts.assigned_user_id",
            "contacts.coordinates",
            "contacts.color_tag",
        ):
            assert key in by_key, key
            assert by_key[key]["is_visible"] is False

    def test_admin_area_stays_visible_by_default(self, client, admin_headers):
        # fixes20 §2: admin_area is NOT default-hidden (shown independently of
        # the mekurav section toggle).
        assert default_visible("contact_mekurav.admin_area_id") is True
        assert "contact_mekurav.admin_area_id" not in DEFAULT_HIDDEN
