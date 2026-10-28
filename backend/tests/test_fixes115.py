"""fixes115: the assistant apartment endpoints list and write any field the
CRM lets this user edit (app/apartment_edit_rules.py). In-memory SQLite
(conftest); the real-concurrency case runs on Postgres in
test_fixes114_postgres.py."""
import pytest

from app import custom_field_utils, models, picklist_utils
from app.core.security import create_access_token
from app.routers import assistant_apartments

URL = "/api/assistant/apartments"
FORBIDDEN = "This field cannot be edited here"


def _user(db, org_id, role, username):
    user = models.User(
        organization_id=org_id, username=username, full_name=username, role=role, is_active=True
    )
    db.add(user)
    db.commit()
    token = create_access_token(subject=str(user.id), role=role)
    return user, {"Authorization": f"Bearer {token}"}


def _picklist(db, org_id, field_key, he, en, options, *, system=True):
    db.add(models.PicklistDefinition(
        organization_id=org_id, system_name=field_key, hebrew_display_name=he,
        english_display_name=en, entity_type="apartment", is_system=system,
    ))
    for i, (value, label_he) in enumerate(options):
        db.add(models.PicklistValue(
            organization_id=org_id, field_key=field_key, value=value, hebrew_label=label_he,
            english_value=value.replace("_", " ").title(), sort_order=i,
        ))


def _custom_field(db, org_id, key, he, field_type):
    db.add(models.CustomFieldDefinition(
        organization_id=org_id, entity_type="apartment", field_key=key,
        hebrew_label=he, english_label=key.title(), field_type=field_type,
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
    _picklist(db, org.id, "apartment.campaign_status", "סטטוס מבצע", "Campaign status",
              [("visited", "בוקר"), ("not_home", "לא בבית")])
    _picklist(db, org.id, "apartment.language", "שפה", "Language",
              [("hebrew", "עברית"), ("russian", "רוסית"), ("english", "אנגלית")])
    # A seasonal (campaign) field: an admin-added picklist.
    _picklist(db, org.id, "apartment.chanuka", "חנוכה", "Chanuka",
              [("menorah", "חנוכיה"), ("donuts", "סופגניות")], system=False)
    _custom_field(db, org.id, "to_knock", "לדפוק", "boolean")
    _custom_field(db, org.id, "kids", "ילדים", "number")
    _custom_field(db, org.id, "visit_day", "יום ביקור", "date")
    _custom_field(db, org.id, "has_mezuzah", "יש מזוזה", "boolean")
    db.add(models.FieldLocalization(
        entity_type="apartments", technical_name="apartments.name",
        hebrew_label="שם דייר", english_label="Resident",
    ))
    herzl = models.Building(organization_id=org.id, building_address="Herzl 10, Tel Aviv")
    other = models.Building(organization_id=org.id, building_address="Jabotinsky 5")
    foreign = models.Building(organization_id=org_b.id, building_address="Herzl 10, Haifa")
    db.add_all([herzl, other, foreign])
    db.flush()
    db.add_all([
        models.Floor(organization_id=org.id, building_id=herzl.id, name="1", sort_order=1),
        models.Floor(organization_id=org.id, building_id=herzl.id, name="2", sort_order=2),
    ])
    rn = models.ReportNumber(organization_id=org.id, name="R1")
    rn2 = models.ReportNumber(organization_id=org.id, name="R2")
    db.add_all([rn, rn2])
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
    picklist_utils.set_value(db, org.id, "apartments", mine.id, "apartment.chanuka", "menorah")
    custom_field_utils.set_value(db, org.id, "apartment", mine.id, "kids", 2)
    db.commit()

    admin, admin_h = _user(db, org.id, "admin", "admin_a")
    _, staff_h = _user(db, org.id, "staff", "staff_a")
    shliach, shliach_h = _user(db, org.id, "shliach", "activist_a")
    _, admin_b_h = _user(db, org_b.id, "admin", "admin_b")
    grant_task_access(org.id, shliach.id, rn.id)
    campaign = db.query(models.Campaign).filter_by(organization_id=org.id, is_active=True).one()
    return {
        "db": db, "org": org, "admin": admin, "admin_h": admin_h, "staff_h": staff_h,
        "shliach_h": shliach_h, "admin_b_h": admin_b_h, "campaign": campaign,
        "mine": mine.id, "not_mine": not_mine.id, "draft": draft.id, "org_b_apt": org_b_apt.id,
        "rn": rn.id, "rn2": rn2.id,
    }


def _search(client, headers, q):
    r = client.get(f"{URL}/search", params={"q": q}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _apartment(client, headers, lineage_id):
    r = client.get(f"{URL}/by-lineage/{lineage_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _fields(client, headers, lineage_id):
    return {f["field_key"]: f for f in _apartment(client, headers, lineage_id)["editable_fields"]}


def _update(client, headers, apartment_id, field_key, value):
    return client.post(f"{URL}/{apartment_id}/update",
                       json={"field_key": field_key, "value": value}, headers=headers)


def _set_config(env, **cfg):
    env["org"].shliach_view_config = cfg
    env["db"].commit()


def _hide_for_org(env, field_key):
    env["db"].add(models.FieldSetting(
        organization_id=env["org"].id, field_key=field_key, is_visible=False))
    env["db"].commit()


def _hide_for_campaign(env, field_key):
    env["db"].add(models.CampaignFieldVisibility(
        campaign_id=env["campaign"].id, field_key=field_key, is_visible=False))
    env["db"].commit()


INTERNAL = {"customfield.apartment.to_knock", "apartments.building_id", "id", "root_id",
            "is_display", "editor_id", "status", "source", "campaign_id"}


# --- what each user may edit ------------------------------------------------

def test_admin_and_staff_get_every_visible_field_with_values_and_options(client, env):
    for headers in (env["admin_h"], env["staff_h"]):
        fields = _fields(client, headers, env["mine"])
        assert list(fields) == [
            "apartments.apartment_name", "apartments.floor", "apartments.apartment_notes",
            "apartments.name", "apartments.phone", "apartments.email",
            "apartment.Jewish_status", "apartment.campaign_status", "apartment.language",
            "apartments.report_number_id", "apartment.chanuka",
            "customfield.apartment.kids", "customfield.apartment.visit_day",
            "customfield.apartment.has_mezuzah",
        ]
        assert not INTERNAL & set(fields)
        # mezuzah_status has no options in this org, so there is nothing to pick.
        assert "apartment.mezuzah_status" not in fields

    fields = _fields(client, env["admin_h"], env["mine"])
    assert fields["apartments.name"] == {
        "field_key": "apartments.name", "label": "שם דייר", "label_en": "Resident",
        "kind": "text", "current_value": "Cohen",
    }
    js = fields["apartment.Jewish_status"]
    assert (js["kind"], js["current_value"]) == ("single_option", "unknown")
    assert js["options"][0] == {"value": "jewish", "label": "יהודי", "label_en": "Jewish"}
    assert (fields["apartment.language"]["kind"], fields["apartment.language"]["current_value"]) == (
        "multi_option", [])
    assert [o["value"] for o in fields["apartments.floor"]["options"]] == ["1", "2"]
    assert fields["apartments.report_number_id"]["current_value"] == env["rn"]
    assert [o["label"] for o in fields["apartments.report_number_id"]["options"]] == ["R1", "R2"]
    assert fields["customfield.apartment.kids"]["kind"] == "number"
    assert fields["customfield.apartment.kids"]["current_value"] == 2
    assert fields["customfield.apartment.visit_day"]["kind"] == "date"
    assert fields["customfield.apartment.has_mezuzah"]["kind"] == "yes_no"
    for entry in fields.values():
        assert ("options" in entry) == (entry["kind"] in ("single_option", "multi_option"))


def test_shliach_gets_street2_fields_only(client, env):
    fields = _fields(client, env["shliach_h"], env["mine"])
    # Never the apartment number (dashboard PUT 403), floor or report number.
    assert not {"apartments.apartment_name", "apartments.floor",
                "apartments.report_number_id"} & set(fields)
    assert "apartment.campaign_status" in fields  # a business status field
    assert "apartment.chanuka" in fields and not INTERNAL & set(fields)


def test_seasonal_field_with_its_current_value_and_new_options(client, env):
    chanuka = _fields(client, env["shliach_h"], env["mine"])["apartment.chanuka"]
    assert chanuka["label"] == "חנוכה" and chanuka["label_en"] == "Chanuka"
    assert chanuka["current_value"] == "menorah"
    assert [o["value"] for o in chanuka["options"]] == ["menorah", "donuts"]
    env["db"].add(models.PicklistValue(organization_id=env["org"].id, field_key="apartment.chanuka",
                                       value="gelt", hebrew_label="דמי חנוכה", sort_order=9))
    env["db"].commit()
    chanuka = _fields(client, env["shliach_h"], env["mine"])["apartment.chanuka"]
    assert [o["value"] for o in chanuka["options"]] == ["menorah", "donuts", "gelt"]


def test_campaign_hidden_field_is_gone_for_the_activist_only(client, env):
    _hide_for_campaign(env, "apartment.chanuka")
    assert "apartment.chanuka" not in _fields(client, env["shliach_h"], env["mine"])
    assert "apartment.chanuka" in _fields(client, env["admin_h"], env["mine"])


def test_org_hidden_field_is_gone_for_everyone(client, env):
    _hide_for_org(env, "apartments.phone")
    _hide_for_org(env, "customfield.apartment.kids")
    for headers in (env["admin_h"], env["staff_h"], env["shliach_h"]):
        fields = _fields(client, headers, env["mine"])
        assert "apartments.phone" not in fields and "customfield.apartment.kids" not in fields


def test_activist_locks_use_the_shliach_config_keys(client, env):
    _set_config(env, apartment_edit_locked_fields=[
        "resident", "jewish_status", "apartment.chanuka", "customfield.apartment.kids"])
    fields = _fields(client, env["shliach_h"], env["mine"])
    for key in ("apartments.name", "apartment.Jewish_status", "apartment.chanuka",
                "customfield.apartment.kids"):
        assert key not in fields
    assert "apartments.phone" in fields
    assert "apartments.name" in _fields(client, env["admin_h"], env["mine"])  # activists only
    _set_config(env, disable_edit=True)
    assert _fields(client, env["shliach_h"], env["mine"]) == {}


# --- update -----------------------------------------------------------------

def test_update_versions_stamps_the_editor_and_syncs_to_knock(client, env):
    db = env["db"]
    r = _update(client, env["admin_h"], env["mine"], "apartment.Jewish_status", "not_jewish")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["field_key"], body["value"]) == (
        "updated", "apartment.Jewish_status", "not_jewish")
    assert body["previous_apartment_id"] == env["mine"] and body["lineage_id"] == env["mine"]
    new_id = body["apartment_id"]
    assert new_id != env["mine"] and body["apartment"]["apartment_id"] == new_id
    saved = {f["field_key"]: f for f in body["apartment"]["editable_fields"]}
    assert saved["apartment.Jewish_status"]["current_value"] == "not_jewish"
    assert saved["apartments.name"]["current_value"] == "Cohen"  # carried over

    db.expire_all()
    old, new = db.get(models.Apartment, env["mine"]), db.get(models.Apartment, new_id)
    assert old.is_display is False and old.editor_id == env["admin"].id
    assert new.is_display is True and new.root_id == env["mine"]
    assert custom_field_utils.get_values(db, env["org"].id, "apartment", new_id)["to_knock"] is False
    assert _apartment(client, env["admin_h"], env["mine"])["apartment_id"] == new_id


@pytest.mark.parametrize("field_key, value, stored", [
    ("apartments.name", "  Mizrahi ", "Mizrahi"),
    ("apartments.phone", "050-1234567", "050-1234567"),
    ("apartments.email", "a@b.co", "a@b.co"),
    ("apartments.apartment_notes", "", None),
    ("apartments.apartment_name", "3A", "3A"),
    ("apartments.floor", "2", "2"),
    ("apartment.chanuka", "donuts", "donuts"),
    ("apartment.language", ["russian", "hebrew", "russian"], ["russian", "hebrew"]),
    ("customfield.apartment.kids", "4", 4.0),
    ("customfield.apartment.visit_day", "2026-12-14", "2026-12-14"),
    ("customfield.apartment.has_mezuzah", True, True),
])
def test_each_kind_writes_through_the_dashboard_path(client, env, field_key, value, stored):
    r = _update(client, env["admin_h"], env["mine"], field_key, value)
    assert r.status_code == 200, r.text
    body = r.json()
    if body["status"] == "unchanged":
        assert stored is None  # notes were already empty
    else:
        saved = body["value"]
        assert (sorted(saved) if isinstance(saved, list) else saved) == (
            sorted(stored) if isinstance(stored, list) else stored)


def test_report_number_is_picked_by_id(client, env):
    r = _update(client, env["admin_h"], env["mine"], "apartments.report_number_id", env["rn2"])
    assert r.status_code == 200, r.text
    assert r.json()["value"] == env["rn2"]


def test_no_change_creates_no_new_version(client, env):
    db = env["db"]
    before = db.query(models.Apartment).count()
    for field_key, value in (("apartment.Jewish_status", "unknown"), ("apartments.name", "Cohen"),
                             ("customfield.apartment.kids", 2), ("apartment.language", [])):
        r = _update(client, env["admin_h"], env["mine"], field_key, value)
        assert r.status_code == 200, (field_key, r.text)
        assert r.json()["status"] == "unchanged" and r.json()["apartment_id"] == env["mine"]
        assert r.json()["previous_apartment_id"] is None
    assert db.query(models.Apartment).count() == before


def test_not_editable_fields_are_one_403_and_write_nothing(client, env):
    db = env["db"]
    _hide_for_org(env, "apartments.email")
    _hide_for_campaign(env, "apartment.chanuka")
    _set_config(env, apartment_edit_locked_fields=["phone"])
    before = db.query(models.Apartment).count()
    cases = [
        (env["admin_h"], ["apartments.email", "customfield.apartment.to_knock", "nonsense",
                         "is_display", "apartments.building_id", "apartment.mezuzah_status"]),
        (env["shliach_h"], ["apartment.chanuka", "apartments.phone", "apartments.apartment_name",
                            "apartments.floor", "apartments.email"]),
    ]
    for headers, keys in cases:
        for key in keys:
            r = _update(client, headers, env["mine"], key, "x")
            assert r.status_code == 403, key
            assert r.json()["detail"] == FORBIDDEN, key
    assert db.query(models.Apartment).count() == before


def test_invalid_values_are_422_naming_the_field(client, env):
    db = env["db"]
    before = db.query(models.Apartment).count()
    cases = [
        ("apartment.Jewish_status", "martian", "value_not_allowed"),
        ("apartment.Jewish_status", ["jewish"], "expected_option"),
        ("apartment.Jewish_status", None, "expected_option"),
        ("apartment.language", "hebrew", "expected_list"),
        ("apartment.language", ["hebrew", "klingon"], "value_not_allowed"),
        ("apartments.floor", "9", "value_not_allowed"),
        ("apartments.phone", "123", "invalid_format"),
        ("apartments.email", "not-an-email", "invalid_format"),
        ("apartments.name", 5, "expected_text"),
        ("customfield.apartment.kids", "many", "expected_number"),
        ("customfield.apartment.visit_day", "soon", "expected_date"),
        ("customfield.apartment.has_mezuzah", "yes", "expected_yes_no"),
    ]
    for field_key, value, code in cases:
        r = _update(client, env["admin_h"], env["mine"], field_key, value)
        assert r.status_code == 422, (field_key, value, r.text)
        item = r.json()["detail"]["invalid_fields"][0]
        assert (item["field"], item["code"]) == (field_key, code)
    assert db.query(models.Apartment).count() == before


def test_a_retired_version_is_409_and_the_lineage_read_recovers(client, env):
    first = _update(client, env["admin_h"], env["mine"], "apartment.Jewish_status", "jewish").json()
    stale = _update(client, env["admin_h"], env["mine"], "apartment.Jewish_status", "not_jewish")
    assert stale.status_code == 409
    current = _apartment(client, env["admin_h"], first["lineage_id"])
    assert current["apartment_id"] == first["apartment_id"]


def test_the_claim_refuses_a_version_retired_after_the_checks(client, env, monkeypatch):
    """The conditional UPDATE is what protects a concurrent edit: simulate the
    other request retiring the row between our checks and our claim."""
    db = env["db"]
    real = assistant_apartments._views

    def retire_then_read(session, user, rows):
        out = real(session, user, rows)
        db.query(models.Apartment).filter_by(id=env["mine"]).update({"is_display": False})
        db.commit()
        return out

    monkeypatch.setattr(assistant_apartments, "_views", retire_then_read)
    before = db.query(models.Apartment).count()
    r = _update(client, env["admin_h"], env["mine"], "apartment.Jewish_status", "jewish")
    assert r.status_code == 409
    assert db.query(models.Apartment).count() == before


def test_shliach_cannot_edit_an_unassigned_apartment(client, env):
    r = _update(client, env["shliach_h"], env["not_mine"], "apartment.Jewish_status", "jewish")
    assert r.status_code == 403
    r = _update(client, env["shliach_h"], env["mine"], "apartment.Jewish_status", "jewish")
    assert r.status_code == 200 and r.json()["status"] == "updated"


def test_identity_in_the_body_is_refused(client, env):
    r = client.post(f"{URL}/{env['mine']}/update", headers=env["admin_h"],
                    json={"field_key": "apartments.name", "value": "X", "organization_id": 2})
    assert r.status_code == 422


# --- reads and visibility ---------------------------------------------------

def test_search_matches_address_number_or_resident(client, env):
    data = _search(client, env["admin_h"], "herzl")
    assert {r["apartment_id"] for r in data["results"]} == {env["mine"], env["not_mine"]}
    row = next(r for r in data["results"] if r["apartment_id"] == env["mine"])
    assert {k: row[k] for k in ("lineage_id", "building_address", "apartment_name", "floor",
                                "resident_name")} == {
        "lineage_id": env["mine"], "building_address": "Herzl 10, Tel Aviv",
        "apartment_name": "3", "floor": "1", "resident_name": "Cohen"}
    assert row["editable_fields"]
    assert [r["apartment_id"] for r in _search(client, env["admin_h"], "levi")["results"]] == [env["not_mine"]]
    # Org always from the token.
    assert [r["apartment_id"] for r in _search(client, env["admin_b_h"], "herzl")["results"]] == [env["org_b_apt"]]


def test_shliach_sees_only_assigned_and_never_drafts(client, env):
    assert [r["apartment_id"] for r in _search(client, env["shliach_h"], "herzl")["results"]] == [env["mine"]]
    for lineage in (env["not_mine"], env["draft"], env["org_b_apt"], 999999):
        assert client.get(f"{URL}/by-lineage/{lineage}", headers=env["shliach_h"]).status_code == 404
    assert client.get(f"{URL}/by-lineage/{env['draft']}", headers=env["admin_h"]).status_code == 404
    assert client.get(f"{URL}/by-lineage/{env['mine']}", headers=env["admin_b_h"]).status_code == 404
    assert _update(client, env["admin_b_h"], env["mine"], "apartments.name", "X").status_code == 404


def test_search_is_capped_at_20_and_says_so(client, env):
    db = env["db"]
    building = db.query(models.Building).filter_by(building_address="Jabotinsky 5").one()
    db.add_all([models.Apartment(organization_id=env["org"].id, building_id=building.id,
                                 apartment_name=f"x{i}") for i in range(25)])
    db.commit()
    data = _search(client, env["admin_h"], "jabotinsky")
    assert len(data["results"]) == 20 and data["truncated"] is True


def test_every_route_needs_a_login(client, env):
    bad = {"Authorization": "Bearer nope"}
    for headers in ({}, bad):
        assert client.get(f"{URL}/search", params={"q": "herzl"}, headers=headers).status_code == 401
        assert client.get(f"{URL}/by-lineage/{env['mine']}", headers=headers).status_code == 401
        assert client.post(f"{URL}/{env['mine']}/update", headers=headers,
                           json={"field_key": "apartments.name", "value": "X"}).status_code == 401
