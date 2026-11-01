"""fixes115/fixes118: the assistant apartment endpoints list and write the
status fields this user may edit (app/apartment_edit_rules.py), one label in
the user's language, request_id replay. In-memory SQLite (conftest); the
real-concurrency case runs on Postgres in
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


# fixes118: apartment fields only (lists, org picklists, yes/no fields) —
# everything else is never editable here.
NOT_APARTMENT_FIELDS = ["apartments.apartment_name", "apartments.floor", "apartments.report_number_id",
              "apartments.name", "apartments.phone", "apartments.email",
              "apartments.apartment_notes", "customfield.apartment.to_knock",
              "customfield.apartment.kids", "customfield.apartment.visit_day",
              "apartments.building_id", "id", "root_id",
              "is_display", "status", "nonsense"]
APARTMENT_FIELDS = ["apartment.Jewish_status", "apartment.campaign_status", "apartment.language",
          "apartment.chanuka", "customfield.apartment.has_mezuzah"]


def _set_locale(env, user, value):
    env["db"].add(models.UserPreference(user_id=user.id, key="locale", value=f'"{value}"'))
    env["db"].commit()


# --- what each user may edit ------------------------------------------------

def test_every_role_gets_the_apartment_fields_only(client, env):
    _, cm_h = _user(env["db"], env["org"].id, "campaign_manager", "cm_a")
    for headers in (env["admin_h"], env["staff_h"], cm_h, env["shliach_h"]):
        fields = _fields(client, headers, env["mine"])
        assert list(fields) == APARTMENT_FIELDS
        # mezuzah_status has no options in this org, so there is nothing to pick.
        assert "apartment.mezuzah_status" not in fields
        for entry in fields.values():
            if entry["kind"] == "yes_no":
                assert set(entry) == {"field_key", "label", "kind", "current_value"}
                continue
            assert set(entry) == {"field_key", "label", "kind", "current_value", "options"}
            assert all(set(o) == {"value", "label"} for o in entry["options"])

    fields = _fields(client, env["admin_h"], env["mine"])
    js = fields["apartment.Jewish_status"]
    assert (js["kind"], js["current_value"]) == ("single_option", "unknown")
    assert js["options"][0] == {"value": "jewish", "label": "יהודי"}
    lang = fields["apartment.language"]
    assert (lang["kind"], lang["current_value"]) == ("multi_option", [])
    mezuzah = fields["customfield.apartment.has_mezuzah"]
    assert (mezuzah["kind"], mezuzah["label"], mezuzah["current_value"]) == ("yes_no", "יש מזוזה", None)


def test_labels_follow_the_users_language(client, env):
    # No stored locale -> Hebrew.
    chanuka = _fields(client, env["admin_h"], env["mine"])["apartment.chanuka"]
    assert chanuka["label"] == "חנוכה"
    assert chanuka["options"][0] == {"value": "menorah", "label": "חנוכיה"}
    _set_locale(env, env["admin"], "en")
    fields = _fields(client, env["admin_h"], env["mine"])
    assert fields["apartment.chanuka"]["label"] == "Chanuka"
    assert fields["apartment.chanuka"]["options"][0] == {"value": "menorah", "label": "Menorah"}
    # An option with no English name shows its Hebrew label, never the raw value.
    env["db"].add(models.PicklistValue(organization_id=env["org"].id, field_key="apartment.chanuka",
                                       value="gelt", hebrew_label="דמי חנוכה", sort_order=9))
    env["db"].commit()
    opts = _fields(client, env["admin_h"], env["mine"])["apartment.chanuka"]["options"]
    assert opts[-1] == {"value": "gelt", "label": "דמי חנוכה"}
    # Another user's locale changes nothing for this one.
    assert _fields(client, env["staff_h"], env["mine"])["apartment.chanuka"]["label"] == "חנוכה"


def test_seasonal_field_with_its_current_value_and_new_options(client, env):
    chanuka = _fields(client, env["shliach_h"], env["mine"])["apartment.chanuka"]
    assert chanuka["current_value"] == "menorah"
    assert [o["value"] for o in chanuka["options"]] == ["menorah", "donuts"]
    env["db"].add(models.PicklistValue(organization_id=env["org"].id, field_key="apartment.chanuka",
                                       value="gelt", hebrew_label="דמי חנוכה", sort_order=9))
    env["db"].commit()
    chanuka = _fields(client, env["shliach_h"], env["mine"])["apartment.chanuka"]
    assert [o["value"] for o in chanuka["options"]] == ["menorah", "donuts", "gelt"]


def test_campaign_hidden_field_is_gone_for_every_role(client, env):
    _hide_for_campaign(env, "apartment.chanuka")
    for headers in (env["admin_h"], env["staff_h"], env["shliach_h"]):
        assert "apartment.chanuka" not in _fields(client, headers, env["mine"])


def test_org_hidden_field_is_gone_for_everyone(client, env):
    _hide_for_org(env, "apartment.Jewish_status")
    for headers in (env["admin_h"], env["staff_h"], env["shliach_h"]):
        assert "apartment.Jewish_status" not in _fields(client, headers, env["mine"])


def test_activist_locks_apply_to_every_role(client, env):
    _set_config(env, apartment_edit_locked_fields=[
        "jewish_status", "apartment.chanuka", "customfield.apartment.has_mezuzah"])
    for headers in (env["admin_h"], env["shliach_h"]):
        fields = _fields(client, headers, env["mine"])
        assert "apartment.Jewish_status" not in fields and "apartment.chanuka" not in fields
        assert "customfield.apartment.has_mezuzah" not in fields
        assert "apartment.language" in fields
    _set_config(env, disable_edit=True)
    for headers in (env["admin_h"], env["staff_h"], env["shliach_h"]):
        assert _fields(client, headers, env["mine"]) == {}


# --- update -----------------------------------------------------------------

def test_update_versions_stamps_the_editor_and_syncs_to_knock(client, env):
    db = env["db"]
    r = _update(client, env["admin_h"], env["mine"], "apartment.Jewish_status", "not_jewish")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["replayed"], body["field_key"], body["value"]) == (
        "updated", False, "apartment.Jewish_status", "not_jewish")
    assert body["previous_apartment_id"] == env["mine"] and body["lineage_id"] == env["mine"]
    new_id = body["apartment_id"]
    assert new_id != env["mine"] and body["apartment"]["apartment_id"] == new_id
    saved = {f["field_key"]: f for f in body["apartment"]["editable_fields"]}
    assert saved["apartment.Jewish_status"]["current_value"] == "not_jewish"
    assert saved["apartment.chanuka"]["current_value"] == "menorah"  # carried over

    db.expire_all()
    old, new = db.get(models.Apartment, env["mine"]), db.get(models.Apartment, new_id)
    assert old.is_display is False and old.editor_id == env["admin"].id
    assert new.is_display is True and new.root_id == env["mine"] and new.name == "Cohen"
    assert picklist_utils.get_values(db, env["org"].id, "apartments", new_id)[
        "apartment.Jewish_status"] == "not_jewish"
    custom = custom_field_utils.get_values(db, env["org"].id, "apartment", new_id)
    assert custom["to_knock"] is False and custom["kids"] == 2
    assert _apartment(client, env["admin_h"], env["mine"])["apartment_id"] == new_id


@pytest.mark.parametrize("field_key, value, stored", [
    ("apartment.chanuka", "donuts", "donuts"),
    ("apartment.language", ["russian", "hebrew", "russian"], ["russian", "hebrew"]),
    ("customfield.apartment.has_mezuzah", True, True),
])
def test_each_kind_writes_through_the_dashboard_path(client, env, field_key, value, stored):
    r = _update(client, env["admin_h"], env["mine"], field_key, value)
    assert r.status_code == 200, r.text
    saved = r.json()["value"]
    assert (sorted(saved) if isinstance(saved, list) else saved) == (
        sorted(stored) if isinstance(stored, list) else stored)


def test_an_empty_list_clears_a_multi_option(client, env):
    first = _update(client, env["admin_h"], env["mine"], "apartment.language", ["hebrew"]).json()
    r = _update(client, env["admin_h"], first["apartment_id"], "apartment.language", [])
    assert r.status_code == 200 and r.json()["status"] == "updated" and r.json()["value"] == []


def test_yes_no_field_hidden_by_org_or_campaign_is_gone(client, env):
    _hide_for_campaign(env, "customfield.apartment.has_mezuzah")
    assert "customfield.apartment.has_mezuzah" not in _fields(client, env["admin_h"], env["mine"])


def test_a_yes_no_sent_again_is_unchanged(client, env):
    first = _update(client, env["admin_h"], env["mine"], "customfield.apartment.has_mezuzah", False)
    assert first.json()["status"] == "updated" and first.json()["value"] is False
    count = env["db"].query(models.Apartment).count()
    r = _update(client, env["admin_h"], first.json()["apartment_id"],
                "customfield.apartment.has_mezuzah", False)
    assert r.json()["status"] == "unchanged"
    assert env["db"].query(models.Apartment).count() == count


def test_no_change_creates_no_new_version(client, env):
    db = env["db"]
    before = db.query(models.Apartment).count()
    for field_key, value in (("apartment.Jewish_status", "unknown"), ("apartment.language", [])):
        r = _update(client, env["admin_h"], env["mine"], field_key, value)
        assert r.status_code == 200, (field_key, r.text)
        assert r.json()["status"] == "unchanged" and r.json()["apartment_id"] == env["mine"]
        assert r.json()["previous_apartment_id"] is None
    assert db.query(models.Apartment).count() == before


def test_other_and_not_editable_fields_are_one_403_for_every_role(client, env):
    db = env["db"]
    _, cm_h = _user(db, env["org"].id, "campaign_manager", "cm_a")
    _hide_for_campaign(env, "apartment.chanuka")
    _set_config(env, apartment_edit_locked_fields=["language"])
    before = db.query(models.Apartment).count()
    keys = NOT_APARTMENT_FIELDS + ["apartment.chanuka", "apartment.language", "apartment.mezuzah_status"]
    for headers in (env["admin_h"], env["staff_h"], cm_h, env["shliach_h"]):
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
        ("apartment.Jewish_status", None, "expected_option"),  # a single option is never cleared
        ("apartment.Jewish_status", True, "expected_option"),
        ("apartment.language", "hebrew", "expected_list"),
        ("apartment.language", None, "expected_list"),
        ("apartment.language", ["hebrew", "klingon"], "value_not_allowed"),
        ("customfield.apartment.has_mezuzah", "yes", "expected_yes_no"),
        ("customfield.apartment.has_mezuzah", None, "expected_yes_no"),  # never cleared
        ("customfield.apartment.has_mezuzah", 1, "expected_yes_no"),
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


def test_unassigned_apartment_is_404_for_the_activist_like_a_missing_one(client, env):
    for apartment_id in (env["not_mine"], env["org_b_apt"], env["draft"], 999999):
        r = _update(client, env["shliach_h"], apartment_id, "apartment.Jewish_status", "jewish")
        assert r.status_code == 404, apartment_id
        assert r.json()["detail"] == "Apartment not found"
    # A retired version of an apartment the activist can't see: 404, not 409.
    other = _update(client, env["admin_h"], env["not_mine"], "apartment.Jewish_status", "jewish")
    assert other.status_code == 200
    r = _update(client, env["shliach_h"], env["not_mine"], "apartment.Jewish_status", "not_jewish")
    assert r.status_code == 404
    r = _update(client, env["shliach_h"], env["mine"], "apartment.Jewish_status", "jewish")
    assert r.status_code == 200 and r.json()["status"] == "updated"
    # A retired version of their own apartment is the ordinary 409.
    r = _update(client, env["shliach_h"], env["mine"], "apartment.Jewish_status", "not_jewish")
    assert r.status_code == 409


def test_identity_in_the_body_is_refused(client, env):
    r = client.post(f"{URL}/{env['mine']}/update", headers=env["admin_h"],
                    json={"field_key": "apartment.chanuka", "value": "donuts", "organization_id": 2})
    assert r.status_code == 422


def test_superadmin_is_refused_everywhere(client, env):
    _, h = _user(env["db"], env["org"].id, "superadmin", "super_a")
    assert client.get(f"{URL}/search", params={"q": "herzl"}, headers=h).status_code == 403
    assert client.get(f"{URL}/getapartment", params={"id": env["mine"]}, headers=h).status_code == 403
    assert client.get(f"{URL}/by-lineage/{env['mine']}", headers=h).status_code == 403
    assert _update(client, h, env["mine"], "apartment.chanuka", "donuts").status_code == 403


# --- request_id: proof of write --------------------------------------------

def _post(client, headers, apartment_id, **body):
    return client.post(f"{URL}/{apartment_id}/update", headers=headers, json=body)


def test_same_request_id_replays_and_writes_once(client, env):
    db = env["db"]
    body = {"field_key": "apartment.chanuka", "value": "donuts", "request_id": "req-1"}
    first = _post(client, env["admin_h"], env["mine"], **body)
    assert first.status_code == 200 and first.json()["replayed"] is False
    count = db.query(models.Apartment).count()
    again = _post(client, env["admin_h"], env["mine"], **body)
    assert again.status_code == 200, again.text
    a, b = first.json(), again.json()
    assert b["replayed"] is True and b["status"] == "updated"
    for key in ("apartment_id", "previous_apartment_id", "lineage_id", "value", "field_key"):
        assert a[key] == b[key], key
    assert db.query(models.Apartment).count() == count
    # Still a replay after someone else edits the apartment further.
    _update(client, env["staff_h"], a["apartment_id"], "apartment.chanuka", "menorah")
    later = _post(client, env["admin_h"], env["mine"], **body).json()
    assert later["replayed"] is True and later["apartment_id"] == a["apartment_id"]
    assert later["value"] == "donuts"  # what OUR write saved


def test_request_id_reused_with_another_request_is_422(client, env):
    db = env["db"]
    _post(client, env["admin_h"], env["mine"],
          field_key="apartment.chanuka", value="donuts", request_id="req-2")
    count = db.query(models.Apartment).count()
    r = _post(client, env["admin_h"], env["mine"],
              field_key="apartment.chanuka", value="menorah", request_id="req-2")
    assert r.status_code == 422
    assert r.json()["detail"]["invalid_fields"][0] == {"field": "request_id", "code": "request_id_reused"}
    assert db.query(models.Apartment).count() == count


def test_unchanged_is_recorded_and_replayed_too(client, env):
    body = {"field_key": "apartment.chanuka", "value": "menorah", "request_id": "req-3"}
    first = _post(client, env["admin_h"], env["mine"], **body).json()
    assert (first["status"], first["replayed"]) == ("unchanged", False)
    again = _post(client, env["admin_h"], env["mine"], **body).json()
    assert (again["status"], again["replayed"], again["apartment_id"]) == ("unchanged", True, env["mine"])


def test_request_id_of_another_user_is_never_matched(client, env):
    body = {"field_key": "apartment.chanuka", "value": "donuts", "request_id": "req-4"}
    first = _post(client, env["admin_h"], env["mine"], **body).json()
    # Staff sends the same request_id for the (now retired) version: not a replay.
    assert _post(client, env["staff_h"], env["mine"], **body).status_code == 409
    r = _post(client, env["staff_h"], first["apartment_id"], **{**body, "value": "menorah"})
    assert r.status_code == 200 and r.json()["replayed"] is False


def test_a_failed_write_leaves_no_request_record(client, env):
    body = {"field_key": "apartment.chanuka", "value": "martian", "request_id": "req-5"}
    assert _post(client, env["admin_h"], env["mine"], **body).status_code == 422
    assert env["db"].query(models.AssistantRequest).count() == 0
    body["value"] = "donuts"
    r = _post(client, env["admin_h"], env["mine"], **body)
    assert r.status_code == 200 and r.json()["replayed"] is False


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


def test_getapartment_and_its_alias_read_the_same_current_version(client, env):
    first = _update(client, env["admin_h"], env["mine"], "apartment.chanuka", "donuts").json()
    r = client.get(f"{URL}/getapartment", params={"id": env["mine"]}, headers=env["admin_h"])
    assert r.status_code == 200
    assert r.json() == _apartment(client, env["admin_h"], env["mine"])
    assert r.json()["apartment_id"] == first["apartment_id"]
    assert client.get(f"{URL}/getapartment", headers=env["admin_h"]).status_code == 422


def test_shliach_sees_only_assigned_and_never_drafts(client, env):
    assert [r["apartment_id"] for r in _search(client, env["shliach_h"], "herzl")["results"]] == [env["mine"]]
    for lineage in (env["not_mine"], env["draft"], env["org_b_apt"], 999999):
        assert client.get(f"{URL}/by-lineage/{lineage}", headers=env["shliach_h"]).status_code == 404
        assert client.get(f"{URL}/getapartment", params={"id": lineage},
                          headers=env["shliach_h"]).status_code == 404
    assert client.get(f"{URL}/by-lineage/{env['draft']}", headers=env["admin_h"]).status_code == 404
    assert client.get(f"{URL}/by-lineage/{env['mine']}", headers=env["admin_b_h"]).status_code == 404
    assert _update(client, env["admin_b_h"], env["mine"], "apartment.chanuka", "donuts").status_code == 404


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
        assert client.get(f"{URL}/getapartment", params={"id": env["mine"]},
                          headers=headers).status_code == 401
        assert client.post(f"{URL}/{env['mine']}/update", headers=headers,
                           json={"field_key": "apartment.chanuka", "value": "donuts"}).status_code == 401
