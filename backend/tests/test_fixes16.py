"""Fixes16 acceptance tests: org backup restore points — create/list/download,
full restore round-trip (atomic replace), the automatic pre-restore safety
snapshot, retention pruning, and user-link repair on restore."""
import json

from app import models
from app.core.backup import BACKUP_RETENTION


# --- Builders (same shapes as test_fixes15) ----------------------------------
def _mk_area(client, headers, name="שכונה"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Backup St, City"):
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


_seq = iter(range(1000, 9999))


def _mk_contact(client, headers, name="פלוני", **overrides):
    payload = {
        "name": name,
        "phone": f"0528{next(_seq):06d}",
        "contact_type": "mekurav",
        **overrides,
    }
    r = client.post("/api/contacts", json=payload, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _backup(client, headers, note=None):
    r = client.post("/api/backups", json={"note": note}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _list_backups(client, headers):
    r = client.get("/api/backups", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# --- Permissions --------------------------------------------------------------
class TestBackupPermissions:
    def test_staff_blocked(self, client, auth_headers):
        assert client.get("/api/backups", headers=auth_headers).status_code == 403
        assert (
            client.post("/api/backups", json={}, headers=auth_headers).status_code
            == 403
        )

    def test_anonymous_blocked(self, client):
        assert client.get("/api/backups").status_code == 401


# --- Create / list / download --------------------------------------------------
class TestBackupCreate:
    def test_create_lists_counts_and_note(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="אחד")
        _mk_contact(client, admin_headers, name="שניים")
        b = _backup(client, admin_headers, note="לפני ייבוא")
        assert b["note"] == "לפני ייבוא"
        assert b["kind"] == "manual"
        assert b["counts"]["contacts"] == 2

        listed = _list_backups(client, admin_headers)
        assert [x["id"] for x in listed] == [b["id"]]
        assert listed[0]["created_by_name"]  # denormalized creator name

    def test_download_is_readable_json(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="להורדה")
        b = _backup(client, admin_headers)
        r = client.get(f"/api/backups/{b['id']}/download", headers=admin_headers)
        assert r.status_code == 200
        assert "attachment" in r.headers["content-disposition"]
        snapshot = json.loads(r.content.decode("utf-8"))
        names = [c["name"] for c in snapshot["tables"]["contacts"]]
        assert "להורדה" in names

    def test_backup_isolated_per_org(self, client, admin_headers, auth_headers):
        # auth_headers registered first → different org than admin_headers.
        b = _backup(client, admin_headers)
        r = client.get(f"/api/backups/{b['id']}/download", headers=auth_headers)
        assert r.status_code in (403, 404)  # staff 403; another org's admin 404


# --- Restore round-trip ---------------------------------------------------------
class TestRestore:
    def test_restore_replaces_current_data(self, client, admin_headers):
        # World at backup time: area→building→apartment, a contact linked to
        # the apartment with a mitzvah-flagged visit + a significant date
        # reminder (fixes25: the flag lives on the visit).
        area = _mk_area(client, admin_headers)
        building = _mk_building(client, admin_headers, area["id"])
        apt = _mk_apartment(client, admin_headers, building["id"], apartment_name="1")
        a = _mk_contact(
            client, admin_headers, name="ישן", mekurav={"apartment_id": apt["id"]}
        )
        client.post(
            f"/api/contacts/{a['id']}/visits",
            json={"visit_date": "2026-06-01T00:00:00", "tzedakah": True},
            headers=admin_headers,
        )
        r = client.post(
            f"/api/contacts/{a['id']}/special-dates",
            json={
                "special_date": "2026-01-01T00:00:00",
                "special_date_type": None,
                "special_date_title": "יום הולדת",
                "is_set_reminder": True,
                "reminders": [
                    {"offset_minutes": 60, "remind_at_time": "09:00", "channel": "email"}
                ],
            },
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text

        b = _backup(client, admin_headers, note="נקודת אמת")

        # Mutations after the backup: old contact deleted, a new one created.
        assert (
            client.delete(f"/api/contacts/{a['id']}", headers=admin_headers).status_code
            == 204
        )
        newer = _mk_contact(client, admin_headers, name="חדש")

        r = client.post(f"/api/backups/{b['id']}/restore", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["restored"]["contacts"] == 1

        # The old world is back…
        restored = client.get(f"/api/contacts/{a['id']}", headers=admin_headers)
        assert restored.status_code == 200
        body = restored.json()
        assert body["name"] == "ישן"
        visits = client.get(
            f"/api/contacts/{a['id']}/visits", headers=admin_headers
        ).json()
        assert len(visits) == 1 and visits[0]["tzedakah"] is True
        assert body["mekurav"]["apartment_id"] == apt["id"]
        assert body["special_dates"][0]["reminders"][0]["offset_minutes"] == 60
        # …and the post-backup contact is gone. (Compared by name, not id —
        # SQLite reuses the deleted contact's id for `newer` in this test.)
        assert newer["name"] == "חדש"
        everyone = client.get("/api/contacts", headers=admin_headers).json()
        assert [c["name"] for c in everyone] == ["ישן"]

    def test_restore_creates_auto_safety_snapshot(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="בטיחות")
        b = _backup(client, admin_headers)
        r = client.post(f"/api/backups/{b['id']}/restore", headers=admin_headers)
        assert r.status_code == 200, r.text
        safety_id = r.json()["safety_backup_id"]
        listed = _list_backups(client, admin_headers)
        by_id = {x["id"]: x for x in listed}
        assert by_id[safety_id]["kind"] == "auto"
        assert "לפני שחזור" in by_id[safety_id]["note"]

    def test_restore_repairs_deleted_user_links(self, client, admin_headers):
        staff = client.post(
            "/api/users",
            json={"full_name": "עוזב", "email": "leaver@x.com", "role": "staff"},
            headers=admin_headers,
        ).json()
        c = _mk_contact(
            client, admin_headers, name="משויך", assigned_user_id=staff["guid"]
        )
        b = _backup(client, admin_headers)
        assert (
            client.delete(f"/api/users/{staff['id']}", headers=admin_headers).status_code
            == 204
        )
        r = client.post(f"/api/backups/{b['id']}/restore", headers=admin_headers)
        assert r.status_code == 200, r.text
        restored = client.get(f"/api/contacts/{c['id']}", headers=admin_headers).json()
        # The snapshot pointed at a user that no longer exists → link nulled.
        assert restored["assigned_user_id"] is None

    def test_restore_roundtrips_visit_engagement_data(self, client, admin_headers):
        """fixes25: the visit's interactions JSON + custom-field values survive
        a backup/restore round-trip (the author rides along as plain text, so
        no user re-owning is needed anymore)."""
        c = _mk_contact(client, admin_headers, name="עם אינטראקציה")
        vid = client.post(
            f"/api/contacts/{c['id']}/visits",
            json={
                "visit_date": "2026-06-01T00:00:00",
                "interactions": [{"category": "call", "note": "שיחה"}],
            },
            headers=admin_headers,
        ).json()["id"]
        did = client.post(
            "/api/custom-fields",
            json={"field_key": "restore_field", "hebrew_label": "שדה"},
            headers=admin_headers,
        ).json()["id"]
        client.put(
            f"/api/visits/{vid}/custom-fields",
            json=[{"definition_id": did, "checked": True, "note": "כן"}],
            headers=admin_headers,
        )

        b = _backup(client, admin_headers)
        assert (
            client.delete(f"/api/contacts/{c['id']}", headers=admin_headers).status_code
            == 204
        )
        r = client.post(f"/api/backups/{b['id']}/restore", headers=admin_headers)
        assert r.status_code == 200, r.text

        visits = client.get(
            f"/api/contacts/{c['id']}/visits", headers=admin_headers
        ).json()
        assert len(visits) == 1
        assert visits[0]["interactions"][0]["note"] == "שיחה"
        fields = client.get(
            f"/api/visits/{visits[0]['id']}/custom-fields", headers=admin_headers
        ).json()
        assert fields[0]["checked"] is True and fields[0]["note"] == "כן"


# --- Retention -------------------------------------------------------------------
class TestRetention:
    def test_only_newest_kept(self, client, admin_headers):
        _mk_contact(client, admin_headers, name="קבוע")
        for i in range(BACKUP_RETENTION + 2):
            _backup(client, admin_headers, note=f"גיבוי {i}")
        listed = _list_backups(client, admin_headers)
        assert len(listed) == BACKUP_RETENTION
        notes = [b["note"] for b in listed]
        assert f"גיבוי {BACKUP_RETENTION + 1}" in notes  # newest kept
        assert "גיבוי 0" not in notes  # oldest pruned
        assert "גיבוי 1" not in notes
