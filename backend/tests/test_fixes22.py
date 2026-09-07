"""Fixes22 acceptance tests: shliach apartment editing (scoped + versioned) and
the admin per-field restore from history."""
from app import models


# --- Builders ----------------------------------------------------------------
def _mk_area(client, headers, name="שכונה כב"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="22 Ver St, City"):
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


def _mk_report_number(client, headers, name="דוח כב"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(4000, 9999))


def _mk_shliach(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "פעיל עורך",
            "phone": f"0569{next(_seq):06d}",
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


# --- §2 shliach apartment editing ------------------------------------------------
class TestShliachEditing:
    def test_shliach_edits_assigned_apartment_versions(
        self, client, admin_headers, db_session, grant_task_access
    ):
        area = _mk_area(client, admin_headers)
        b = _mk_building(client, admin_headers, area["id"])
        rn = _mk_report_number(client, admin_headers, "דוח עריכה")
        ap = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="A", floor="1",
            report_number_id=rn["id"],
        )
        _mk_shliach(client, admin_headers, "editor22@example.com",
                    report_number_ids=[rn["id"]])
        # fixes58: visibility/edit access now comes from an ACTIVE Task under
        # an active Campaign, not the direct ReportNumberContactShliach row.
        pre_login_user = (
            db_session.query(models.User)
            .filter(models.User.email == "editor22@example.com")
            .one()
        )
        grant_task_access(pre_login_user.organization_id, pre_login_user.id, rn["id"])
        shliach = _shliach_login(client, "editor22@example.com")

        r = client.put(
            f"/api/apartments/{ap['id']}",
            json={"name": "דייר חדש"},
            headers=shliach,
        )
        assert r.status_code == 200, r.text
        new = r.json()
        assert new["id"] != ap["id"] and new["name"] == "דייר חדש"
        # The edit is versioned + stamped with the shliach's user id (editor_id).
        old = db_session.get(models.Apartment, ap["id"])
        login_user = (
            db_session.query(models.User)
            .filter(models.User.email == "editor22@example.com")
            .one()
        )
        assert old.is_display is False and old.editor_id == login_user.id
        # The shliach still sees the new active version via the report number.
        assert [a["id"] for a in client.get("/api/apartments", headers=shliach).json()] == [
            new["id"]
        ]

    def test_shliach_cannot_edit_unassigned_apartment(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור זר")
        b = _mk_building(client, admin_headers, area["id"], "99 Foreign Rd")
        ap = _mk_apartment(client, admin_headers, b["id"], apartment_name="Z")
        # A shliach covering nothing relevant.
        _mk_shliach(client, admin_headers, "noaccess22@example.com")
        shliach = _shliach_login(client, "noaccess22@example.com")
        r = client.put(
            f"/api/apartments/{ap['id']}", json={"name": "x"}, headers=shliach
        )
        assert r.status_code == 403


# --- §2 admin per-field restore --------------------------------------------------
class TestAdminRestoreField:
    def _apt_with_history(self, client, admin_headers):
        area = _mk_area(client, admin_headers, "אזור שחזור")
        b = _mk_building(client, admin_headers, area["id"], "1 Restore Ave")
        ap = _mk_apartment(
            client, admin_headers, b["id"], apartment_name="A", floor="1",
            name="שם מקורי",
        )
        # Edit twice → v1 (original) becomes history.
        v2 = client.put(
            f"/api/apartments/{ap['id']}",
            json={"name": "שם שני", "floor": "5"},
            headers=admin_headers,
        ).json()
        return ap, v2

    def test_restore_single_field(self, client, admin_headers):
        ap, v2 = self._apt_with_history(client, admin_headers)
        # Restore the original resident name (from the retired v1 = ap["id"]).
        r = client.post(
            f"/api/apartments/{v2['id']}/restore-field",
            json={"version_id": ap["id"], "field": "name"},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        restored = r.json()
        # name rolled back; floor kept its current (v2) value.
        assert restored["name"] == "שם מקורי"
        assert restored["floor"] == "5"
        assert restored["id"] != v2["id"]  # a new active version
        # History now has the pre-restore state too.
        hist = client.get(
            f"/api/apartments/{restored['id']}/history", headers=admin_headers
        ).json()
        assert len(hist) == 2

    def test_restore_rejects_non_restorable_field(self, client, admin_headers):
        ap, v2 = self._apt_with_history(client, admin_headers)
        r = client.post(
            f"/api/apartments/{v2['id']}/restore-field",
            json={"version_id": ap["id"], "field": "building_id"},
            headers=admin_headers,
        )
        assert r.status_code == 400

    def test_restore_rejects_foreign_version(self, client, admin_headers):
        _, v2 = self._apt_with_history(client, admin_headers)
        # A version id from a different apartment lineage.
        area = _mk_area(client, admin_headers, "אזור אחר לגמרי")
        b = _mk_building(client, admin_headers, area["id"], "2 Other Ave")
        other = _mk_apartment(client, admin_headers, b["id"], apartment_name="Q")
        r = client.post(
            f"/api/apartments/{v2['id']}/restore-field",
            json={"version_id": other["id"], "field": "name"},
            headers=admin_headers,
        )
        assert r.status_code == 404

    def test_restore_admin_only(self, client, admin_headers, auth_headers):
        ap, v2 = self._apt_with_history(client, admin_headers)
        r = client.post(
            f"/api/apartments/{v2['id']}/restore-field",
            json={"version_id": ap["id"], "field": "name"},
            headers=auth_headers,
        )
        assert r.status_code == 403
