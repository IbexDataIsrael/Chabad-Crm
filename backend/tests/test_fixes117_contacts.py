"""fixes117: a contact in the chat helper — read (endpoint 2), new visit
(endpoint 4), one-field edit (endpoint 3) — plus the fixes118 apartment link
by lineage id. Reuses the fixes115 apartment fixture (orgs, users, roles)."""
import datetime

import pytest

from app import custom_field_utils, models, picklist_utils
from tests.test_fixes115 import _set_locale, _user, env  # noqa: F401

URL = "/api/assistant/contacts"


def _picklist(db, org_id, key, he, en, options, entity_type):
    db.add(models.PicklistDefinition(
        organization_id=org_id, system_name=key, hebrew_display_name=he,
        english_display_name=en, entity_type=entity_type, is_system=True,
    ))
    for i, (value, label_he, label_en) in enumerate(options):
        db.add(models.PicklistValue(
            organization_id=org_id, field_key=key, value=value, hebrew_label=label_he,
            english_value=label_en, sort_order=i,
        ))


def _custom(db, org_id, entity_type, key, he, en, field_type, sort_order=0):
    db.add(models.CustomFieldDefinition(
        organization_id=org_id, entity_type=entity_type, field_key=key, hebrew_label=he,
        english_label=en, field_type=field_type, sort_order=sort_order,
    ))


def _show(db, org_id, key, visible=True):
    db.add(models.FieldSetting(organization_id=org_id, field_key=key, is_visible=visible))
    db.commit()


@pytest.fixture
def cenv(env, monkeypatch):  # noqa: F811
    monkeypatch.setattr("app.routers.contacts.geocode_address", lambda address: (32.0, 34.8))
    db, org = env["db"], env["org"]
    m = "contact_mekurav"
    _picklist(db, org.id, "contact.pipeline_status", "סטטוס", "Status",
              [("new", "חדש", "New"), ("warm", "חם", "Warm")], m)
    _picklist(db, org.id, "contact.color_tag", "צבע", "Color", [("magenta", "מג'נטה", "Magenta")], m)
    _picklist(db, org.id, "contact.potential_next_step", "צעד הבא", "Next step",
              [("call", "להתקשר", "Call"), ("visit", "לבקר", "Visit")], m)
    _picklist(db, org.id, "Jewish_status", "מעמד יהודי", "Jewish status",
              [("jewish", "יהודי", "Jewish"), ("unknown", "לא ידוע", "Unknown")], m)
    _custom(db, org.id, m, "tefillin_count", "פעמים תפילין", "Tefillin count", "number")
    _picklist(db, org.id, "visit.type", "סוג ביקור", "Visit type",
              [("home", "בית", "Home"), ("street", "רחוב", "Street")], "visit")
    _picklist(db, org.id, "checklist.torah_thought", "דבר תורה", "Torah thought",
              [("given", "נמסר", "Given"), ("planned", "מתוכנן", "Planned")], "visit")
    _picklist(db, org.id, "interaction.category", "קטגוריה", "Category",
              [("call", "שיחה", "Call")], "visit")
    _custom(db, org.id, "visit", "tefillin", "תפילין", "Tefillin", "boolean", 0)
    _custom(db, org.id, "visit", "shabbat_candles", "נרות", "Shabbat candles", "boolean", 1)
    _custom(db, org.id, "visit", "connection_to_rebbe", "קשר לרבי", "Connection to the Rebbe", "text", 2)
    _custom(db, org.id, "visit", "chanuka", "חנוכה", "Chanuka", "select", 3)
    _picklist(db, org.id, "checklist.chanuka", "חנוכה", "Chanuka",
              [("menorah", "חנוכיה", "Menorah")], "visit")
    _custom(db, org.id, "visit", "old_flag", "ישן", "Old", "boolean", 4)
    db.flush()
    db.query(models.CustomFieldDefinition).filter_by(field_key="old_flag").update({"is_active": False})

    def contact(name, **kw):
        c = models.Contact(organization_id=kw.pop("org_id", org.id), name=name, **kw)
        db.add(c)
        db.commit()
        return c.id

    env["moshe"] = contact("Moshe", last_name="Cohen", phone="0501111111", email="m@x.com",
                           address="Herzl 10")
    env["other"] = contact("Other", phone="0502222222")
    env["draft"] = contact("Dina", status="draft")
    env["activist_contact"] = contact("Avi", contact_type="shliach")
    org_b = db.query(models.Organization).filter_by(name="Org B").one()
    env["foreign"] = contact("Foreign", org_id=org_b.id)
    env["cm_h"] = _user(db, org.id, "campaign_manager", "cm_c")[1]
    env["super_h"] = _user(db, org.id, "superadmin", "super_c")[1]
    return env


def _get(client, h, cid):
    return client.get(f"{URL}/{cid}", headers=h)


def _keys(view):
    return [f["field_key"] for f in view["editable_fields"]]


def _update(client, h, cid, field_key, value, **kw):
    return client.post(f"{URL}/{cid}/update", json={"field_key": field_key, "value": value, **kw},
                       headers=h)


def _visit(client, h, cid, values, **kw):
    return client.post(f"{URL}/{cid}/visits", json={"values": values, **kw}, headers=h)


def _code(r):
    return r.json()["detail"]["invalid_fields"][0]["code"]


# --- read ---------------------------------------------------------------------
def test_read_shape_for_admin(client, cenv):
    r = _get(client, cenv["admin_h"], cenv["moshe"])
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["contact_id"] == cenv["moshe"]
    assert (view["status"], view["status_label"], view["can_add_visit"]) == ("active", None, True)
    assert (view["name"], view["last_name"], view["phone"], view["email"], view["address"]) == (
        "Moshe", "Cohen", "0501111111", "m@x.com", "Herzl 10")
    assert view["web_path"] == f"/dashboard/contacts/{cenv['moshe']}"
    # Color tag and the prospect section are hidden by default (field_registry).
    assert _keys(view) == ["contacts.name", "contacts.last_name", "contacts.phone", "contacts.email",
                           "contacts.address", "contacts.pipeline_status", "contacts.priority_score"]
    status = next(f for f in view["editable_fields"] if f["field_key"] == "contacts.pipeline_status")
    assert status["kind"] == "single_option" and status["label"] == "סטטוס"
    assert status["options"] == [{"value": "new", "label": "חדש"}, {"value": "warm", "label": "חם"}]
    assert all("label_en" not in f for f in view["editable_fields"])
    assert view["recent_visits"] == []


def test_new_visit_fields_are_every_visit_field(client, cenv):
    fields = _get(client, cenv["admin_h"], cenv["moshe"]).json()["new_visit_fields"]
    assert [f["field_key"] for f in fields] == [
        "visits.visit_date", "visits.visit_type", "visits.location", "visits.torah_thought",
        "customfield.visit.tefillin", "customfield.visit.shabbat_candles",
        "customfield.visit.connection_to_rebbe", "customfield.visit.chanuka",
        "visits.notes", "visits.interactions"]
    by_key = {f["field_key"]: f for f in fields}
    date = by_key["visits.visit_date"]
    assert date["kind"] == "date" and date["required"] is True
    assert date["default"] == datetime.date.today().isoformat()
    assert by_key["customfield.visit.tefillin"]["kind"] == "yes_no"
    assert by_key["customfield.visit.connection_to_rebbe"]["kind"] == "text"
    assert by_key["customfield.visit.chanuka"]["options"] == [{"value": "menorah", "label": "חנוכיה"}]
    assert by_key["visits.interactions"]["kind"] == "entries"


def test_hidden_visit_fields_are_left_out(client, cenv):
    db, org = cenv["db"], cenv["org"]
    for key in ("visits.location", "visits.torah_thought", "customfield.visit.tefillin"):
        _show(db, org.id, key, visible=False)
    keys = [f["field_key"] for f in _get(client, cenv["admin_h"], cenv["moshe"]).json()["new_visit_fields"]]
    assert "visits.location" not in keys and "visits.torah_thought" not in keys
    assert "customfield.visit.tefillin" not in keys and "customfield.visit.shabbat_candles" in keys
    r = _visit(client, cenv["admin_h"], cenv["moshe"], {"visits.location": "x"})
    assert r.status_code == 403


def test_prospect_section_when_the_org_shows_it(client, cenv):
    db, org = cenv["db"], cenv["org"]
    _show(db, org.id, "contact_mekurav.section")
    _show(db, org.id, "contacts.color_tag")
    _show(db, org.id, "contacts.phone", visible=False)
    view = _get(client, cenv["admin_h"], cenv["moshe"]).json()
    keys = _keys(view)
    assert "contacts.color_tag" in keys and "contacts.phone" not in keys and "phone" not in view
    assert keys[-3:] == ["contact_mekurav.potential_next_step", "Jewish_status",
                         "customfield.contact_mekurav.tefillin_count"]


def test_permission_matrix(client, cenv):
    assert _get(client, cenv["staff_h"], cenv["moshe"]).status_code == 200
    for h in (cenv["shliach_h"], cenv["cm_h"]):
        assert _get(client, h, cenv["moshe"]).status_code == 404
        assert _update(client, h, cenv["moshe"], "contacts.name", "X").status_code == 404
        assert _visit(client, h, cenv["moshe"], {}).status_code == 404
    assert _get(client, cenv["super_h"], cenv["moshe"]).status_code == 403
    # Hidden looks exactly like missing.
    for cid in (cenv["activist_contact"], cenv["foreign"], 999999):
        r = _get(client, cenv["admin_h"], cid)
        assert (r.status_code, r.json()["detail"]) == (404, "Contact not found")
    assert client.get(f"{URL}/{cenv['moshe']}").status_code == 401


def test_labels_follow_the_users_language(client, cenv):
    _set_locale(cenv, cenv["admin"], "en")
    view = _get(client, cenv["admin_h"], cenv["moshe"]).json()
    status = next(f for f in view["editable_fields"] if f["field_key"] == "contacts.pipeline_status")
    assert status["label"] == "Status" and status["options"][1]["label"] == "Warm"
    visit = {f["field_key"]: f for f in view["new_visit_fields"]}
    assert visit["customfield.visit.tefillin"]["label"] == "Tefillin"
    assert visit["visits.visit_date"]["label"] == "Date"  # fallback label, no localization row


# --- update one field -----------------------------------------------------------
def test_update_reads_back_and_unchanged(client, cenv):
    h, cid = cenv["admin_h"], cenv["moshe"]
    r = _update(client, h, cid, "contacts.last_name", "Levi")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["status"], body["value"], body["contact_id"], body["replayed"]) == (
        "updated", "Levi", cid, False)
    assert body["contact"]["last_name"] == "Levi"
    assert cenv["db"].get(models.Contact, cid).last_name == "Levi"
    r = _update(client, h, cid, "contacts.last_name", "Levi")
    assert r.json()["status"] == "unchanged"
    r = _update(client, h, cid, "contacts.pipeline_status", "warm")
    assert r.json()["value"] == "warm"
    assert picklist_utils.get_values(cenv["db"], cenv["org"].id, "contacts", cid)[
        "contact.pipeline_status"] == "warm"


def test_staff_edits_and_address_is_located(client, cenv):
    r = _update(client, cenv["staff_h"], cenv["moshe"], "contacts.address", "Jabotinsky 5")
    assert r.status_code == 200, r.text
    c = cenv["db"].get(models.Contact, cenv["moshe"])
    cenv["db"].refresh(c)
    assert (c.address, c.latitude, c.longitude) == ("Jabotinsky 5", 32.0, 34.8)


def test_prospect_fields_update(client, cenv):
    db, org = cenv["db"], cenv["org"]
    _show(db, org.id, "contact_mekurav.section")
    h, cid = cenv["admin_h"], cenv["moshe"]
    assert _update(client, h, cid, "contact_mekurav.potential_next_step", "visit").json()["value"] == "visit"
    assert _update(client, h, cid, "Jewish_status", "jewish").json()["value"] == "jewish"
    r = _update(client, h, cid, "customfield.contact_mekurav.tefillin_count", 3)
    assert r.json()["value"] == 3
    assert custom_field_utils.get_values(db, org.id, "contact_mekurav", cid)["tefillin_count"] == 3.0
    assert _update(client, h, cid, "customfield.contact_mekurav.tefillin_count", 3).json()["status"] == "unchanged"


def test_update_validation(client, cenv):
    h, cid = cenv["admin_h"], cenv["moshe"]
    cases = [
        ("contacts.name", None, "required"),
        ("contacts.name", "  ", "required"),
        ("contacts.phone", "123", "invalid_phone"),
        ("contacts.phone", "0502222222", "phone_taken"),
        ("contacts.email", "not-an-email", "invalid_email"),
        ("contacts.pipeline_status", "cold", "value_not_allowed"),
        ("contacts.pipeline_status", None, "expected_option"),
        ("contacts.priority_score", "abc", "expected_number"),
        ("contacts.priority_score", 2.5, "expected_whole_number"),
        ("contacts.last_name", 5, "expected_text"),
    ]
    for key, value, code in cases:
        r = _update(client, h, cid, key, value)
        assert (r.status_code, _code(r)) == (422, code), (key, value, r.text)
    assert _update(client, h, cid, "contacts.name", "x" * 151).json()["detail"]["invalid_fields"][0][
        "code"] == "too_long"
    # Clearing a text field is allowed.
    assert _update(client, h, cid, "contacts.email", None).json()["value"] is None


def test_hidden_unknown_and_other_fields_are_the_same_403(client, cenv):
    for key in ("contacts.color_tag", "Jewish_status", "contact_mekurav.background",
                "contacts.assigned_user_id", "contact_type", "status", "nonsense"):
        r = _update(client, cenv["admin_h"], cenv["moshe"], key, "x")
        assert (r.status_code, r.json()["detail"]) == (403, "This field cannot be edited here"), key


def test_draft_contact_opens_and_edits_but_no_visit(client, cenv):
    view = _get(client, cenv["admin_h"], cenv["draft"]).json()
    assert view["status"] == "draft" and view["status_label"] == "טיוטה"
    assert view["can_add_visit"] is False
    assert _update(client, cenv["admin_h"], cenv["draft"], "contacts.last_name", "B").status_code == 200
    r = _visit(client, cenv["admin_h"], cenv["draft"], {})
    assert (r.status_code, r.json()["detail"]) == (409, "Approve the contact first")


def test_update_request_id_replay_and_reuse(client, cenv):
    h, cid = cenv["admin_h"], cenv["moshe"]
    first = _update(client, h, cid, "contacts.last_name", "Katz", request_id="u-1").json()
    _update(client, h, cid, "contacts.last_name", "Other")  # someone edits meanwhile
    again = _update(client, h, cid, "contacts.last_name", "Katz", request_id="u-1")
    assert again.status_code == 200
    assert (again.json()["status"], again.json()["replayed"]) == ("updated", True)
    assert first["replayed"] is False
    assert cenv["db"].get(models.Contact, cid).last_name == "Other"  # nothing written twice
    r = _update(client, h, cid, "contacts.last_name", "Different", request_id="u-1")
    assert (r.status_code, _code(r)) == (422, "request_id_reused")
    # Scoped to the user: staff's own "u-1" is a fresh request.
    assert _update(client, cenv["staff_h"], cid, "contacts.last_name", "S",
                   request_id="u-1").json()["replayed"] is False


# --- new visit --------------------------------------------------------------------
def test_new_visit_writes_every_field_and_reads_back(client, cenv):
    h, cid = cenv["admin_h"], cenv["moshe"]
    values = {
        "visits.visit_date": "2026-11-01",
        "visits.visit_type": "home",
        "visits.location": "Beit Shemesh",
        "visits.torah_thought": "given",
        "customfield.visit.tefillin": True,
        "customfield.visit.shabbat_candles": False,
        "customfield.visit.connection_to_rebbe": "Farbrengen",
        "customfield.visit.chanuka": "menorah",
        "visits.notes": "Good talk",
        "visits.interactions": [{"category": "call", "note": "called first"}],
    }
    r = _visit(client, h, cid, values)
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["status"], body["replayed"], body["contact_id"]) == ("created", False, cid)
    assert body["visit"] == {
        "visit_id": body["visit_id"], "visit_date": "2026-11-01", "visit_type": "בית",
        "location": "Beit Shemesh", "notes": "Good talk",
        "done": ["דבר תורה: נמסר", "תפילין", "קשר לרבי: Farbrengen", "חנוכה: חנוכיה"],
        "interactions": [{"category": "שיחה", "note": "called first"}],
    }
    v = cenv["db"].get(models.VisitHistory, body["visit_id"])
    assert (v.contact_id, v.organization_id, v.location) == (cid, cenv["org"].id, "Beit Shemesh")
    recent = _get(client, h, cid).json()["recent_visits"]
    assert recent == [body["visit"]]


def test_new_visit_date_defaults_to_today(client, cenv):
    body = _visit(client, cenv["admin_h"], cenv["moshe"], {}).json()
    assert body["visit"]["visit_date"] == datetime.date.today().isoformat()
    assert body["visit"]["done"] == []


def test_new_visit_validation(client, cenv):
    h, cid = cenv["admin_h"], cenv["moshe"]
    cases = [
        ({"visits.visit_date": "yesterday"}, "expected_date"),
        ({"visits.visit_type": "office"}, "value_not_allowed"),
        ({"customfield.visit.tefillin": "yes"}, "expected_yes_no"),
        ({"visits.interactions": [{"category": "nope", "note": ""}]}, "value_not_allowed"),
        ({"visits.interactions": "call"}, "expected_list"),
        ({"visits.notes": ["x"]}, "expected_text"),
    ]
    for values, code in cases:
        r = _visit(client, h, cid, values)
        assert (r.status_code, _code(r)) == (422, code), values
    for key in ("customfield.visit.old_flag", "visits.interaction", "contact_id"):
        assert _visit(client, h, cid, {key: True}).status_code == 403, key
    assert cenv["db"].query(models.VisitHistory).count() == 0


def test_new_visit_request_id_creates_once(client, cenv):
    h, cid = cenv["admin_h"], cenv["moshe"]
    values = {"customfield.visit.tefillin": True}
    first = _visit(client, h, cid, values, request_id="v-1").json()
    again = _visit(client, h, cid, values, request_id="v-1")
    assert again.status_code == 201
    assert (again.json()["visit_id"], again.json()["replayed"]) == (first["visit_id"], True)
    assert cenv["db"].query(models.VisitHistory).count() == 1
    r = _visit(client, h, cid, {"customfield.visit.tefillin": False}, request_id="v-1")
    assert (r.status_code, _code(r)) == (422, "request_id_reused")
    assert cenv["db"].query(models.VisitHistory).count() == 1


# --- fixes118: the apartment link by lineage id ------------------------------------
def test_apartment_link_follows_the_lineage(client, cenv):
    h, lineage = cenv["admin_h"], cenv["mine"]
    apt = client.get("/api/assistant/apartments/getapartment", params={"id": lineage}, headers=h).json()
    assert apt["web_path"] == f"/dashboard/apartments/lineage/{lineage}"
    assert client.get(f"/api/apartments/lineage/{lineage}", headers=h).json() == {"id": lineage}
    saved = client.post(f"/api/assistant/apartments/{lineage}/update",
                        json={"field_key": "apartment.Jewish_status", "value": "jewish"},
                        headers=h).json()
    assert saved["apartment_id"] != lineage
    assert saved["apartment"]["web_path"] == f"/dashboard/apartments/lineage/{lineage}"
    assert client.get(f"/api/apartments/lineage/{lineage}", headers=h).json() == {
        "id": saved["apartment_id"]}
    assert client.get(f"/api/apartments/lineage/{lineage}", headers=cenv["admin_b_h"]).status_code == 404
