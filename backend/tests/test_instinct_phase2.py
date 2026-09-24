"""docs/system_api_part2.md: Instinct API phase 2 (search, phone rule, visits,
contact custom fields, apartments, WhatsApp read queries)."""
import datetime

import pytest

from app import models
from app.seed import seed_visit_mivtzoim_custom_fields

KEY = {"X-Instinct-Key": "test-instinct-key"}
PHONE_ERROR = (
    "invalid Israeli mobile phone: expected 05X + 8 more digits (10 total), "
    "e.g. 0501234567"
)
TODAY = datetime.date.today().isoformat()


@pytest.fixture
def org_id(client, admin_headers, monkeypatch):
    oid = client.get("/api/auth/me", headers=admin_headers).json()["organization_id"]
    monkeypatch.setenv("INSTINCT_API_KEY", KEY["X-Instinct-Key"])
    monkeypatch.setenv("INSTINCT_ORG_ID", str(oid))
    return oid


@pytest.fixture
def contact_defs(org_id, db_session):
    """The four §4 contact counters (the migration seeds them on real DBs)."""
    for key, ftype in (
        ("tefillin_laid_count", "number"),
        ("tefillin_last_date", "date"),
        ("mezuzot_ordered", "number"),
        ("mezuzot_installed", "number"),
    ):
        db_session.add(
            models.CustomFieldDefinition(
                organization_id=org_id, entity_type="contact_mekurav",
                field_key=key, hebrew_label=key, field_type=ftype,
            )
        )
    db_session.commit()


@pytest.fixture
def visit_defs(org_id, db_session):
    seed_visit_mivtzoim_custom_fields(db_session, org_id)
    db_session.add(
        models.CustomFieldDefinition(
            organization_id=org_id, entity_type="visit", field_key="tefillin_count",
            hebrew_label="זוגות תפילין", field_type="number",
        )
    )
    db_session.commit()


def _new_contact(client, first="Moshe", last="Mizrahi", **extra):
    r = client.post(
        "/api/instinct/contacts", headers=KEY, json={"first_name": first, "last_name": last, **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _new_apartment(client, **body):
    body = {"building_address": "1414 Eastern Parkway, Brooklyn", "apartment_name": "4F", **body}
    r = client.post("/api/instinct/apartments", headers=KEY, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_all_new_endpoints_require_key(client, org_id):
    for method, path in (
        ("get", "/api/instinct/contacts/search?q=a"),
        ("get", "/api/instinct/contacts"),
        ("post", "/api/instinct/visits"),
        ("get", "/api/instinct/apartments/search?q=a"),
        ("post", "/api/instinct/apartments"),
        ("get", "/api/instinct/stats/registrations"),
        ("get", "/api/instinct/stats/daily"),
    ):
        r = getattr(client, method)(path, headers={"X-Instinct-Key": "nope"})
        assert r.status_code == 401, (method, path)


# --- §1 search -----------------------------------------------------------

def test_search_by_name_any_order_drafts_first(client, org_id, admin_headers):
    draft_id = _new_contact(client)
    active = client.post(
        "/api/contacts", headers=admin_headers,
        json={"name": "Moshe", "last_name": "Cohen", "phone": "0521111111"},
    ).json()["id"]

    for q in ("Moshe Mizrahi", "mizrahi moshe", "MIZ", "oshe Miz"):
        ids = [r["id"] for r in client.get(
            "/api/instinct/contacts/search", headers=KEY, params={"q": q}
        ).json()["results"]]
        assert draft_id in ids, q

    results = client.get(
        "/api/instinct/contacts/search", headers=KEY, params={"q": "Moshe"}
    ).json()["results"]
    assert [r["id"] for r in results] == [draft_id, active]  # drafts first
    assert set(results[0]) == {
        "id", "name", "last_name", "phone", "email", "source", "status", "apartment_id",
    }
    assert results[0]["status"] == "draft" and results[0]["apartment_id"] is None

    only_active = client.get(
        "/api/instinct/contacts/search", headers=KEY, params={"q": "Moshe", "status": "active"}
    ).json()["results"]
    assert [r["id"] for r in only_active] == [active]
    assert client.get("/api/instinct/contacts/search", headers=KEY).status_code == 422


def test_search_matches_hebrew_and_null_last_name(client, org_id, admin_headers):
    cid = _new_contact(client, first="משה", last="")
    ids = [r["id"] for r in client.get(
        "/api/instinct/contacts/search", headers=KEY, params={"q": "משה"}
    ).json()["results"]]
    assert cid in ids


def test_names_are_never_validated(client, org_id):
    cid = _new_contact(client, first="J0hn-!!", last="123 @@")
    assert cid


# --- §2 phone ------------------------------------------------------------

@pytest.mark.parametrize(
    "raw, stored",
    [
        ("050-123-4567", "0501234567"),
        ("(052) 765 4321", "0527654321"),
        ("+972-54-111-2233", "0541112233"),
        ("972541112244", "0541112244"),
    ],
)
def test_phone_normalized(client, org_id, db_session, raw, stored):
    cid = _new_contact(client, phone=raw)
    assert db_session.get(models.Contact, cid).phone == stored


@pytest.mark.parametrize("raw", ["12345", "0301234567", "05012345678", "+1 718 555 0100", "05O1234567"])
def test_phone_rejected(client, org_id, raw):
    r = client.post(
        "/api/instinct/contacts", headers=KEY,
        json={"first_name": "Moshe", "last_name": "Mizrahi", "phone": raw},
    )
    assert r.status_code == 422 and r.json() == {"detail": PHONE_ERROR}


# --- §3 visits -----------------------------------------------------------

def test_create_visit_with_followup_and_custom_fields(client, org_id, visit_defs, db_session):
    cid = _new_contact(client)
    r = client.post(
        "/api/instinct/visits", headers=KEY,
        json={
            "contact_id": cid, "date": "2026-09-24", "time": "23:50",
            "notes": "danced with him until midnight", "followup_task": "bring mezuza",
            "custom_fields": {"tefillin": True, "tefillin_count": 2, "lulav": "yes"},
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["followup_task"] == "bring mezuza" and body["followup_done"] is False
    assert body["visit_date"] == "2026-09-24T23:50:00"
    assert body["custom_fields_written"] == {"tefillin": True, "tefillin_count": 2}
    assert body["parked_in_notes"] == ["lulav"]
    assert body["notes"] == "danced with him until midnight\nlulav=yes"

    values = db_session.query(models.CustomFieldValue).filter_by(
        entity_table="visit_history", entity_id=body["id"]
    ).all()
    assert len(values) == 2 and all(v.visit_id == body["id"] for v in values)
    assert any(v.checked for v in values)

    r = client.patch(
        f"/api/instinct/visits/{body['id']}/followup", headers=KEY, json={"followup_done": True}
    )
    assert r.status_code == 200 and r.json()["followup_done"] is True
    assert client.patch(
        "/api/instinct/visits/99999/followup", headers=KEY, json={"followup_done": True}
    ).status_code == 404


def test_visit_validation(client, org_id, visit_defs):
    def post(body):
        return client.post("/api/instinct/visits", headers=KEY, json=body)

    assert post({"date": "2026-09-24"}).status_code == 422  # no contact/apartment
    assert post({"contact_id": 99999, "date": "2026-09-24"}).status_code == 422
    assert post({"apartment_id": 99999, "date": "2026-09-24"}).status_code == 422
    cid = _new_contact(client)
    assert post({"contact_id": cid, "date": "24/09/2026"}).status_code == 422
    assert post({"contact_id": cid, "date": "2026-09-24", "time": "9pm"}).status_code == 422
    bad = post({"contact_id": cid, "date": "2026-09-24", "custom_fields": {"tefillin_count": "two"}})
    assert bad.status_code == 422 and "tefillin_count" in bad.json()["detail"]
    ok = post({"contact_id": cid, "date": "2026-09-24"})
    assert ok.status_code == 201 and ok.json()["visit_date"] == "2026-09-24T12:00:00"


def test_visit_on_apartment_follows_versioning(client, org_id, db_session):
    apt = _new_apartment(client)
    visit = client.post(
        "/api/instinct/visits", headers=KEY,
        json={"apartment_id": apt["apartment_id"], "date": "2026-09-24"},
    ).json()
    new = client.patch(
        f"/api/instinct/apartments/{apt['apartment_id']}", headers=KEY, json={"floor": "5"}
    ).json()
    assert new["apartment_id"] != apt["apartment_id"]
    db_session.expire_all()
    assert db_session.get(models.VisitHistory, visit["id"]).apartment_id == new["apartment_id"]


# --- §4 contact custom fields --------------------------------------------

def test_contact_fields_upsert_and_parking(client, org_id, contact_defs, db_session):
    cid = _new_contact(client)
    url = f"/api/instinct/contacts/{cid}/fields"
    body = {"fields": {"tefillin_laid_count": 3, "mezuzot_installed": 2}}
    for _ in range(2):  # re-run = same result, no duplicate rows
        r = client.patch(url, headers=KEY, json=body)
        assert r.status_code == 200, r.text
        assert r.json() == {"id": cid, "fields_written": body["fields"], "parked_in_notes": []}
    rows = db_session.query(models.CustomFieldValue).filter_by(entity_table="contacts", entity_id=cid)
    assert rows.count() == 2

    r = client.patch(
        url, headers=KEY,
        json={"fields": {"tefillin_last_date": "2026-09-24", "shofar": 1}, "notes": "likes niggunim"},
    )
    assert r.json()["parked_in_notes"] == ["shofar"]
    assert r.json()["fields_written"] == {"tefillin_last_date": "2026-09-24"}
    db_session.expire_all()
    notes = db_session.get(models.Contact, cid).notes
    assert "likes niggunim" in notes and "shofar: 1" in notes

    # Appended, never overwritten.
    client.patch(url, headers=KEY, json={"notes": "second note"})
    db_session.expire_all()
    notes = db_session.get(models.Contact, cid).notes
    assert "likes niggunim" in notes and "second note" in notes

    for bad in ({"tefillin_laid_count": "lots"}, {"tefillin_last_date": "yesterday"}):
        r = client.patch(url, headers=KEY, json={"fields": bad})
        assert r.status_code == 422 and next(iter(bad)) in r.json()["detail"]
    assert client.patch(
        "/api/instinct/contacts/99999/fields", headers=KEY, json={"fields": {}}
    ).status_code == 404


# --- §5 apartments -------------------------------------------------------

def test_apartment_create_search_draft(client, org_id, admin_headers, db_session):
    apt = _new_apartment(client, floor="4", resident_name="Levi", phone="050 999 8877")
    assert apt["status"] == "draft" and apt["source"] == "instinct"
    a = db_session.get(models.Apartment, apt["apartment_id"])
    assert a.phone == "0509998877" and a.is_display
    assert [f.name for f in a.building.floors] == ["4"]

    # Same address (case/space-insensitive) reuses the building.
    again = _new_apartment(client, building_address="  1414 eastern parkway, brooklyn ", apartment_name="5A")
    assert again["building_id"] == apt["building_id"]

    results = client.get(
        "/api/instinct/apartments/search", headers=KEY, params={"q": "1414 Eastern Parkway"}
    ).json()["results"]
    assert {r["apartment_id"] for r in results} == {apt["apartment_id"], again["apartment_id"]}
    assert all(r["status"] == "draft" for r in results)
    assert client.get(
        "/api/instinct/apartments/search", headers=KEY, params={"q": "levi"}
    ).json()["results"][0]["resident_name"] == "Levi"

    # Drafts stay out of the regular UI lists, but show on request / by id.
    page = client.get("/api/apartments/list", headers=admin_headers).json()
    assert page["total"] == 0
    page = client.get("/api/apartments/list", headers=admin_headers, params={"status": "draft"}).json()
    assert page["total"] == 2
    one = client.get(
        "/api/apartments/list", headers=admin_headers, params={"apartment_id": apt["apartment_id"]}
    ).json()
    assert one["total"] == 1
    assert client.get("/api/apartments", headers=admin_headers).json() == []

    bad = client.post(
        "/api/instinct/apartments", headers=KEY, json={"building_address": "x", "phone": "123"}
    )
    assert bad.status_code == 422 and bad.json() == {"detail": PHONE_ERROR}
    assert client.post("/api/instinct/apartments", headers=KEY, json={"building_address": " "}).status_code == 422


def test_apartment_patch_versions_and_approves(client, org_id, admin_headers, db_session):
    apt = _new_apartment(client, notes="first")
    old_id = apt["apartment_id"]
    r = client.patch(
        f"/api/instinct/apartments/{old_id}", headers=KEY,
        json={"resident_name": "Cohen", "notes": "second"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    new_id = body["apartment_id"]
    assert new_id != old_id and body["previous_apartment_id"] == old_id
    # Still a draft — an edit never approves on its own.
    assert body["status"] == "draft" and body["source"] == "instinct"
    db_session.expire_all()
    old, new = db_session.get(models.Apartment, old_id), db_session.get(models.Apartment, new_id)
    assert not old.is_display and old.editor_id is None and old.last_edit is not None
    assert new.is_display and new.root_id == old_id and new.name == "Cohen"
    assert new.apartment_notes.startswith("first\n[") and new.apartment_notes.endswith("second")

    # The retired id is gone for the API.
    assert client.patch(f"/api/instinct/apartments/{old_id}", headers=KEY, json={}).status_code == 404

    approved = client.patch(
        f"/api/instinct/apartments/{new_id}", headers=KEY, json={"status": "active"}
    ).json()
    assert approved["status"] == "active" and approved["source"] == "instinct"
    page = client.get("/api/apartments/list", headers=admin_headers).json()
    assert [i["id"] for i in page["items"]] == [approved["apartment_id"]]

    # A UI edit keeps source/status (they ride _VERSIONED_COLUMNS).
    ui = client.put(
        f"/api/apartments/{approved['apartment_id']}", headers=admin_headers, json={"floor": "2"}
    )
    assert ui.status_code == 200, ui.text
    db_session.expire_all()
    latest = db_session.get(models.Apartment, ui.json()["id"])
    assert (latest.source, latest.status) == ("instinct", "active")


def test_link_apartment(client, org_id, admin_headers, db_session):
    cid = _new_contact(client)
    apt = _new_apartment(client)
    url = f"/api/instinct/contacts/{cid}/link-apartment"
    r = client.post(url, headers=KEY, json={"apartment_id": apt["apartment_id"]})
    assert r.status_code == 200 and r.json() == {"contact_id": cid, "apartment_id": apt["apartment_id"]}
    found = client.get(
        "/api/instinct/contacts/search", headers=KEY, params={"q": "Mizrahi"}
    ).json()["results"][0]
    assert found["apartment_id"] == apt["apartment_id"]

    # Mekurav row missing -> created.
    db_session.query(models.ContactMekurav).filter_by(contact_id=cid).delete()
    db_session.commit()
    assert client.post(url, headers=KEY, json={"apartment_id": apt["apartment_id"]}).status_code == 200

    assert client.post(url, headers=KEY, json={"apartment_id": 99999}).status_code == 422
    assert client.post(
        "/api/instinct/contacts/99999/link-apartment", headers=KEY, json={"apartment_id": 1}
    ).status_code == 404
    shliach = models.Contact(organization_id=org_id, name="S", contact_type="shliach")
    db_session.add(shliach)
    db_session.commit()
    assert client.post(
        f"/api/instinct/contacts/{shliach.id}/link-apartment", headers=KEY,
        json={"apartment_id": apt["apartment_id"]},
    ).status_code == 422


# --- §6 read queries -----------------------------------------------------

def test_registrations_and_contact_list(client, org_id, admin_headers):
    a = _new_contact(client, phone="0501111111")
    b = _new_contact(client, first="Dovid", last="Levi")
    client.post("/api/contacts", headers=admin_headers, json={"name": "UI", "phone": "0522222222"})

    r = client.get("/api/instinct/stats/registrations", headers=KEY).json()
    assert r == {"date": TODAY, "total": 3, "by_source": {"crm": 1, "instinct": 2}}
    empty = client.get(
        "/api/instinct/stats/registrations", headers=KEY, params={"date": "2001-01-01"}
    ).json()
    assert empty["total"] == 0 and empty["by_source"] == {"crm": 0, "instinct": 0}
    assert client.get(
        "/api/instinct/stats/registrations", headers=KEY, params={"date": "today"}
    ).status_code == 422

    rows = client.get(
        "/api/instinct/contacts", headers=KEY, params={"created_on": TODAY, "status": "draft"}
    ).json()["results"]
    assert {r["id"] for r in rows} == {a, b}
    assert set(rows[0]) == {"id", "name", "last_name", "phone", "status"}
    assert len(client.get("/api/instinct/contacts", headers=KEY, params={"limit": 1}).json()["results"]) == 1


def test_daily_summary(client, org_id, visit_defs):
    cid = _new_contact(client)

    def visit(**body):
        r = client.post("/api/instinct/visits", headers=KEY, json={"contact_id": cid, **body})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    v1 = visit(date="2026-09-24", time="09:00", custom_fields={"tefillin": True})
    visit(date="2026-09-24", time="21:30", custom_fields={"tefillin": True, "tefillin_count": 2},
          followup_task="bring mezuza")
    visit(date="2026-09-24", time="22:00")
    visit(date="2026-09-23", followup_task="call back")
    done = visit(date="2026-09-22", followup_task="done already")
    client.patch(f"/api/instinct/visits/{done}/followup", headers=KEY, json={"followup_done": True})

    r = client.get("/api/instinct/stats/daily", headers=KEY, params={"date": "2026-09-24"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["date"] == "2026-09-24" and body["visits_count"] == 3
    assert body["visits"][0] == {
        "id": v1, "contact_id": cid, "contact_name": "Moshe Mizrahi", "apartment_id": None,
        "time": "09:00", "followup_task": None, "followup_done": False,
    }
    assert body["tefillin"] == {"visits_with_tefillin": 2, "total_pairs": 3}
    assert body["open_followups"] == [
        "bring mezuza (Moshe Mizrahi)", "call back (Moshe Mizrahi)",
    ]
