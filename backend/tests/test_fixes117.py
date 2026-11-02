"""fixes117: the chat helper's combined search (`GET /api/assistant/search`)
— people + apartments, the helper's permission rule, the apartment object
shape of the apartment search. Reuses the fixes115 apartment fixture."""
from app import models
from tests.test_fixes115 import _user, env  # noqa: F401

URL = "/api/assistant/search"


def _contact(db, org_id, name, last_name=None, **kw):
    c = models.Contact(organization_id=org_id, name=name, last_name=last_name, **kw)
    db.add(c)
    db.commit()
    return c


def _search(client, headers, q):
    r = client.get(URL, params={"q": q}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _people_env(env):
    db, org = env["db"], env["org"]
    env["cohen"] = _contact(db, org.id, "Moshe", "Cohen", phone="0501111111",
                            email="moshe@x.com", address="Herzl 10, Tel Aviv").id
    env["herzl_person"] = _contact(db, org.id, "Herzl", "Ben").id
    # An activist contact: never in the helper (fixes117 round 4).
    env["herzl_activist"] = _contact(db, org.id, "Herzl", "Activist", contact_type="shliach").id
    env["draft_person"] = _contact(db, org.id, "Dina", "Cohen", status="draft").id
    org_b_id = db.query(models.Organization).filter_by(name="Org B").one().id
    env["cohen_b"] = _contact(db, org_b_id, "Avi", "Cohen").id
    shliach = db.query(models.User).filter_by(username="activist_a").one()
    # Assigned to the activist: the global search would show it to them.
    env["activist_own"] = _contact(db, org.id, "Yossi", "Cohen", assigned_user_id=shliach.guid).id
    env["cm_h"] = _user(db, org.id, "campaign_manager", "cm_a")[1]
    env["bare_shliach_h"] = _user(db, org.id, "shliach", "activist_no_task")[1]
    return env


def test_shape_and_both_groups_for_admin(client, env):
    _people_env(env)
    data = _search(client, env["admin_h"], "herzl")
    assert set(data) == {"people", "apartments", "people_truncated", "apartments_truncated",
                         "can_add_person"}
    # A person matches by name; the address alone does not match people (global search rule).
    assert [p["id"] for p in data["people"]] == [env["herzl_person"]]
    assert {a["apartment_id"] for a in data["apartments"]} == {env["mine"], env["not_mine"]}
    assert data["people_truncated"] is False and data["apartments_truncated"] is False
    assert data["can_add_person"] is True

    person = _search(client, env["admin_h"], "moshe")["people"][0]
    assert person == {"id": env["cohen"], "name": "Moshe", "last_name": "Cohen",
                      "phone": "0501111111", "address": "Herzl 10, Tel Aviv",
                      "status": "active", "status_label": None}


def test_a_draft_person_is_labelled_in_the_users_language(client, env):
    _people_env(env)
    env["db"].add(models.FieldLocalization(
        entity_type="page", technical_name="contacts.draft_badge",
        hebrew_label="טיוטה", english_label="Draft",
    ))
    env["db"].commit()
    draft = next(p for p in _search(client, env["admin_h"], "dina")["people"])
    assert draft["id"] == env["draft_person"]
    assert (draft["status"], draft["status_label"]) == ("draft", "טיוטה")
    assert "status_label_en" not in draft
    env["db"].add(models.UserPreference(user_id=env["admin"].id, key="locale", value='"en"'))
    env["db"].commit()
    draft = _search(client, env["admin_h"], "dina")["people"][0]
    assert draft["status_label"] == "Draft"


def test_superadmin_is_refused(client, env):
    _, h = _user(env["db"], env["org"].id, "superadmin", "super_a")
    r = client.get(URL, params={"q": "herzl"}, headers=h)
    assert r.status_code == 403


def test_apartment_results_match_the_apartment_search_exactly(client, env):
    combined = _search(client, env["admin_h"], "herzl")["apartments"]
    r = client.get("/api/assistant/apartments/search", params={"q": "herzl"}, headers=env["admin_h"])
    assert combined == r.json()["results"]
    row = next(a for a in combined if a["apartment_id"] == env["mine"])
    labels = {f["field_key"]: f["label"] for f in row["editable_fields"]}
    assert labels["apartment.chanuka"] == "חנוכה"
    assert all("label_en" not in f for f in row["editable_fields"])


def test_people_match_name_last_name_phone_email(client, env):
    _people_env(env)
    for q in ("moshe", "COHEN", "050111", "moshe@x"):
        assert env["cohen"] in {p["id"] for p in _search(client, env["admin_h"], q)["people"]}, q
    # Same as the global search: drafts included, org from the token only.
    ids = {p["id"] for p in _search(client, env["admin_h"], "cohen")["people"]}
    assert ids == {env["cohen"], env["draft_person"], env["activist_own"]}
    assert [p["id"] for p in _search(client, env["admin_b_h"], "cohen")["people"]] == [env["cohen_b"]]


def test_apartments_also_match_notes_and_phone(client, env):
    db = env["db"]
    apt = db.get(models.Apartment, env["not_mine"])
    apt.apartment_notes, apt.phone = "speaks yiddish", "0529999999"
    db.commit()
    for q in ("yiddish", "052999"):
        assert [a["apartment_id"] for a in _search(client, env["admin_h"], q)["apartments"]] == [env["not_mine"]]


def test_staff_gets_people_like_admin(client, env):
    _people_env(env)
    data = _search(client, env["staff_h"], "cohen")
    assert {p["id"] for p in data["people"]} == {env["cohen"], env["draft_person"], env["activist_own"]}
    assert data["can_add_person"] is True


def test_activist_gets_assigned_apartments_only_and_no_people(client, env):
    _people_env(env)
    # Even a contact assigned to them, and even with the org's mekurav opt-in.
    env["org"].shliach_can_view_contacts = True
    env["db"].commit()
    data = _search(client, env["shliach_h"], "cohen")
    assert data["people"] == [] and data["people_truncated"] is False
    assert [a["apartment_id"] for a in data["apartments"]] == [env["mine"]]
    assert data["can_add_person"] is True  # today's CRM permission (mekurav drafts)
    # Without coverage: nothing at all.
    data = _search(client, env["bare_shliach_h"], "herzl")
    assert data["people"] == [] and data["apartments"] == []


def test_campaign_manager_gets_apartments_only_and_cannot_add(client, env):
    _people_env(env)
    data = _search(client, env["cm_h"], "cohen")
    assert data["people"] == []
    assert [a["apartment_id"] for a in data["apartments"]] == [env["mine"]]
    assert data["can_add_person"] is False


def test_each_group_capped_at_20_and_says_so(client, env):
    db, org = env["db"], env["org"]
    building = db.query(models.Building).filter_by(building_address="Jabotinsky 5").one()
    db.add_all([models.Apartment(organization_id=org.id, building_id=building.id,
                                 apartment_name=f"x{i}", name="Zalman") for i in range(25)])
    db.add_all([models.Contact(organization_id=org.id, name="Zalman", last_name=str(i))
                for i in range(25)])
    db.commit()
    data = _search(client, env["admin_h"], "zalman")
    assert len(data["people"]) == 20 and data["people_truncated"] is True
    assert len(data["apartments"]) == 20 and data["apartments_truncated"] is True


def test_short_query_is_400(client, env):
    for q in ("", "a", "  b  "):
        r = client.get(URL, params={"q": q}, headers=env["admin_h"])
        assert r.status_code == 400, q
    assert client.get(URL, headers=env["admin_h"]).status_code == 400


def test_needs_a_login(client, env):
    for headers in ({}, {"Authorization": "Bearer nope"}):
        assert client.get(URL, params={"q": "herzl"}, headers=headers).status_code == 401


def test_wildcards_are_literal(client, env):
    _people_env(env)
    assert _search(client, env["admin_h"], "%%")["people"] == []
    assert _search(client, env["admin_h"], "__")["apartments"] == []
