"""fixes114: edit an apartment from the chat (/api/assistant/apartments).
In-memory SQLite (conftest); the real-concurrency case runs on Postgres in
test_fixes114_postgres.py."""
import pytest

from app import custom_field_utils, models, picklist_utils
from app.core.security import create_access_token
from app.routers import assistant_apartments

URL = "/api/assistant/apartments"


def _user(db, org_id, role, username):
    user = models.User(
        organization_id=org_id, username=username, full_name=username, role=role, is_active=True
    )
    db.add(user)
    db.commit()
    token = create_access_token(subject=str(user.id), role=role)
    return user, {"Authorization": f"Bearer {token}"}


def _picklist(db, org_id, field_key, he, en, options):
    db.add(models.PicklistDefinition(
        organization_id=org_id, system_name=field_key, hebrew_display_name=he,
        english_display_name=en, entity_type="apartment",
    ))
    for i, (value, label_he) in enumerate(options):
        db.add(models.PicklistValue(
            organization_id=org_id, field_key=field_key, value=value, hebrew_label=label_he,
            english_value=value.replace("_", " ").title(), sort_order=i,
        ))


@pytest.fixture
def env(db_session, grant_task_access):
    db = db_session
    org = models.Organization(name="Org A")
    org_b = models.Organization(name="Org B")
    db.add_all([org, org_b])
    db.commit()
    _picklist(db, org.id, "apartment.Jewish_status", "סטטוס יהודי", "Jewish status",
              [("jewish", "יהודי"), ("not_jewish", "לא יהודי"), ("unknown", "לא ידוע")])
    _picklist(db, org.id, "apartment.language", "שפה", "Language",
              [("hebrew", "עברית"), ("russian", "רוסית"), ("english", "אנגלית")])
    db.add(models.CustomFieldDefinition(
        organization_id=org.id, entity_type="apartment", field_key="to_knock",
        hebrew_label="לדפוק", field_type="boolean",
    ))
    herzl = models.Building(organization_id=org.id, building_address="Herzl 10, Tel Aviv")
    other = models.Building(organization_id=org.id, building_address="Jabotinsky 5")
    foreign = models.Building(organization_id=org_b.id, building_address="Herzl 10, Haifa")
    db.add_all([herzl, other, foreign])
    db.flush()
    rn = models.ReportNumber(organization_id=org.id, name="R1")
    db.add(rn)
    db.flush()
    mine = models.Apartment(organization_id=org.id, building_id=herzl.id, apartment_name="3",
                            floor="1", name="Cohen", report_number_id=rn.id)
    not_mine = models.Apartment(organization_id=org.id, building_id=herzl.id, apartment_name="4",
                                floor="1", name="Levi")
    draft = models.Apartment(organization_id=org.id, building_id=herzl.id, apartment_name="5",
                             source="instinct", status="draft")
    elsewhere = models.Apartment(organization_id=org.id, building_id=other.id, apartment_name="1")
    org_b_apt = models.Apartment(organization_id=org_b.id, building_id=foreign.id, apartment_name="3")
    db.add_all([mine, not_mine, draft, elsewhere, org_b_apt])
    db.commit()
    picklist_utils.set_value(db, org.id, "apartments", mine.id, "apartment.Jewish_status", "unknown")
    db.commit()

    admin, admin_h = _user(db, org.id, "admin", "admin_a")
    shliach, shliach_h = _user(db, org.id, "shliach", "activist_a")
    _, admin_b_h = _user(db, org_b.id, "admin", "admin_b")
    grant_task_access(org.id, shliach.id, rn.id)
    return {
        "db": db, "org": org, "admin": admin, "admin_h": admin_h, "shliach_h": shliach_h,
        "admin_b_h": admin_b_h, "mine": mine.id, "not_mine": not_mine.id, "draft": draft.id,
        "org_b_apt": org_b_apt.id,
    }


def _search(client, headers, q):
    r = client.get(f"{URL}/search", params={"q": q}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _update(client, headers, apartment_id, field, value):
    return client.post(f"{URL}/{apartment_id}/update", json={"field": field, "value": value},
                       headers=headers)


def _set_config(env, **cfg):
    env["org"].shliach_view_config = cfg
    env["db"].commit()


# --- reads ------------------------------------------------------------------

def test_search_matches_address_number_or_resident_with_lineage_and_values(client, env):
    by_address = _search(client, env["admin_h"], "herzl")
    ids = [r["apartment_id"] for r in by_address["results"]]
    # Active versions of this org only: no draft, no org B row.
    assert set(ids) == {env["mine"], env["not_mine"]} and by_address["truncated"] is False
    row = next(r for r in by_address["results"] if r["apartment_id"] == env["mine"])
    assert row == {
        "apartment_id": env["mine"], "lineage_id": env["mine"],
        "building_address": "Herzl 10, Tel Aviv", "apartment_name": "3", "floor": "1",
        "resident_name": "Cohen", "jewish_status": "unknown", "language": [],
    }
    assert [r["apartment_id"] for r in _search(client, env["admin_h"], "levi")["results"]] == [env["not_mine"]]
    assert _search(client, env["admin_b_h"], "herzl")["results"][0]["apartment_id"] == env["org_b_apt"]


def test_shliach_search_and_lineage_read_see_only_assigned_apartments(client, env):
    assert [r["apartment_id"] for r in _search(client, env["shliach_h"], "herzl")["results"]] == [env["mine"]]
    assert client.get(f"{URL}/by-lineage/{env['mine']}", headers=env["shliach_h"]).status_code == 200
    # Not assigned / a draft / another org: the same 404, existence never disclosed.
    for lineage in (env["not_mine"], env["draft"], env["org_b_apt"], 999999):
        r = client.get(f"{URL}/by-lineage/{lineage}", headers=env["shliach_h"])
        assert r.status_code == 404, lineage


def test_search_is_capped_at_20_and_says_so(client, env):
    db = env["db"]
    building = db.query(models.Building).filter_by(building_address="Jabotinsky 5").one()
    db.add_all([models.Apartment(organization_id=env["org"].id, building_id=building.id,
                                 apartment_name=f"x{i}") for i in range(25)])
    db.commit()
    data = _search(client, env["admin_h"], "jabotinsky")
    assert len(data["results"]) == 20 and data["truncated"] is True


def test_fields_come_from_the_org_with_options_and_respect_activist_locks(client, env):
    fields = client.get(f"{URL}/fields", headers=env["admin_h"]).json()["fields"]
    assert [f["field"] for f in fields] == ["jewish_status", "language"]
    js = fields[0]
    assert (js["type"], js["label_he"], js["label_en"]) == ("single", "סטטוס יהודי", "Jewish status")
    assert js["options"][0] == {"value": "jewish", "label_he": "יהודי", "label_en": "Jewish"}
    assert fields[1]["type"] == "multi"

    _set_config(env, apartment_edit_locked_fields=["jewish_status"])
    shliach_fields = client.get(f"{URL}/fields", headers=env["shliach_h"]).json()["fields"]
    assert [f["field"] for f in shliach_fields] == ["language"]
    # Locks apply to activists only.
    assert len(client.get(f"{URL}/fields", headers=env["admin_h"]).json()["fields"]) == 2
    _set_config(env, disable_edit=True)
    assert client.get(f"{URL}/fields", headers=env["shliach_h"]).json()["fields"] == []


def test_a_field_without_options_is_not_offered(client, env):
    db = env["db"]
    db.query(models.PicklistValue).filter_by(field_key="apartment.language").update({"is_active": False})
    db.commit()
    fields = client.get(f"{URL}/fields", headers=env["admin_h"]).json()["fields"]
    assert [f["field"] for f in fields] == ["jewish_status"]
    r = _update(client, env["admin_h"], env["mine"], "language", ["hebrew"])
    assert r.status_code == 422 and r.json()["detail"]["invalid_fields"][0]["code"] == "no_options"


# --- writes -----------------------------------------------------------------

def test_update_versions_the_row_stamps_the_editor_and_reads_back(client, env):
    db = env["db"]
    r = _update(client, env["admin_h"], env["mine"], "jewish_status", "not_jewish")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "updated"
    assert body["previous_apartment_id"] == env["mine"] and body["lineage_id"] == env["mine"]
    new_id = body["apartment_id"]
    assert new_id != env["mine"]
    assert body["apartment"]["apartment_id"] == new_id
    assert body["apartment"]["jewish_status"] == "not_jewish"
    assert body["apartment"]["resident_name"] == "Cohen"  # unrelated fields carried over

    db.expire_all()
    old, new = db.get(models.Apartment, env["mine"]), db.get(models.Apartment, new_id)
    assert old.is_display is False and old.editor_id == env["admin"].id
    assert new.is_display is True and new.root_id == env["mine"]
    # fixes71 to_knock stays in sync through the shared versioned update.
    assert custom_field_utils.get_values(db, env["org"].id, "apartment", new_id)["to_knock"] is False
    # The lineage read now resolves to the new version.
    lineage = client.get(f"{URL}/by-lineage/{env['mine']}", headers=env["admin_h"]).json()
    assert lineage["apartment_id"] == new_id and lineage["jewish_status"] == "not_jewish"


def test_language_is_multi_value(client, env):
    r = _update(client, env["admin_h"], env["mine"], "language", ["russian", "hebrew", "russian"])
    assert r.status_code == 200, r.text
    assert sorted(r.json()["apartment"]["language"]) == ["hebrew", "russian"]
    # Same set in another order = no change, no new version.
    again = _update(client, env["admin_h"], r.json()["apartment_id"], "language", ["hebrew", "russian"])
    assert again.json()["status"] == "unchanged"
    assert again.json()["apartment_id"] == r.json()["apartment_id"]


def test_sending_the_current_value_again_creates_no_new_version(client, env):
    db = env["db"]
    before = db.query(models.Apartment).count()
    r = _update(client, env["admin_h"], env["mine"], "jewish_status", "unknown")
    assert r.status_code == 200
    assert r.json()["status"] == "unchanged" and r.json()["apartment_id"] == env["mine"]
    assert r.json()["previous_apartment_id"] is None
    assert db.query(models.Apartment).count() == before


def test_a_retired_version_is_409_and_the_lineage_read_recovers(client, env):
    first = _update(client, env["admin_h"], env["mine"], "jewish_status", "jewish").json()
    stale = _update(client, env["admin_h"], env["mine"], "jewish_status", "not_jewish")
    assert stale.status_code == 409
    current = client.get(f"{URL}/by-lineage/{first['lineage_id']}", headers=env["admin_h"]).json()
    assert current["apartment_id"] == first["apartment_id"] and current["jewish_status"] == "jewish"


def test_the_claim_refuses_a_version_retired_after_the_checks(client, env, monkeypatch):
    """The conditional UPDATE is what protects a concurrent edit: simulate the
    other request retiring the row between our checks and our claim."""
    db = env["db"]
    real = assistant_apartments._summaries

    def retire_then_read(session, org_id, rows):
        out = real(session, org_id, rows)
        db.query(models.Apartment).filter_by(id=env["mine"]).update({"is_display": False})
        db.commit()
        return out

    monkeypatch.setattr(assistant_apartments, "_summaries", retire_then_read)
    before = db.query(models.Apartment).count()
    r = _update(client, env["admin_h"], env["mine"], "jewish_status", "jewish")
    assert r.status_code == 409
    assert db.query(models.Apartment).count() == before  # nothing inserted


def test_invalid_values_and_fields_are_422_and_write_nothing(client, env):
    db = env["db"]
    before = db.query(models.Apartment).count()
    cases = [
        ("jewish_status", "martian", "value_not_allowed"),
        ("jewish_status", ["jewish"], "expected_text"),
        ("jewish_status", "  ", "expected_text"),
        ("language", "hebrew", "expected_list"),
        ("language", ["hebrew", "klingon"], "value_not_allowed"),
        ("phone", "0501234567", "field_not_supported"),
    ]
    for field, value, code in cases:
        r = _update(client, env["admin_h"], env["mine"], field, value)
        assert r.status_code == 422, (field, value)
        assert r.json()["detail"]["invalid_fields"][0] == {
            "field": field, "code": code, **({"value": "martian"} if value == "martian" else {}),
            **({"value": "klingon"} if code == "value_not_allowed" and field == "language" else {}),
        }
    assert db.query(models.Apartment).count() == before


def test_identity_in_the_body_is_refused(client, env):
    r = client.post(f"{URL}/{env['mine']}/update", headers=env["admin_h"],
                    json={"field": "jewish_status", "value": "jewish", "organization_id": 2})
    assert r.status_code == 422


def test_shliach_write_rules(client, env):
    assert _update(client, env["shliach_h"], env["not_mine"], "jewish_status", "jewish").status_code == 403
    r = _update(client, env["shliach_h"], env["mine"], "jewish_status", "jewish")
    assert r.status_code == 200 and r.json()["status"] == "updated"
    new_id = r.json()["apartment_id"]
    _set_config(env, apartment_edit_locked_fields=["language"])
    assert _update(client, env["shliach_h"], new_id, "language", ["hebrew"]).status_code == 403
    _set_config(env, disable_edit=True)
    assert _update(client, env["shliach_h"], new_id, "jewish_status", "not_jewish").status_code == 403


def test_other_org_and_drafts_are_404(client, env):
    assert _update(client, env["admin_b_h"], env["mine"], "jewish_status", "jewish").status_code == 404
    assert _update(client, env["admin_h"], env["draft"], "jewish_status", "jewish").status_code == 404
    assert client.get(f"{URL}/by-lineage/{env['mine']}", headers=env["admin_b_h"]).status_code == 404


def test_every_route_needs_a_login(client, env):
    assert client.get(f"{URL}/fields").status_code == 401
    assert client.get(f"{URL}/search", params={"q": "herzl"}).status_code == 401
    assert client.get(f"{URL}/by-lineage/{env['mine']}").status_code == 401
    assert client.post(f"{URL}/{env['mine']}/update", json={"field": "language", "value": []}).status_code == 401
