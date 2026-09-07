"""Fixes13 acceptance tests: apartment language picklist + label rename."""
from app import models
from app.seed import seed_localization, seed_picklist_definitions, seed_picklists


def _provision(client, db_session, headers):
    """Give the test org its seeded picklists (registration doesn't provision)."""
    org_id = client.get("/api/auth/me", headers=headers).json()["organization_id"]
    seed_picklists(db_session, org_id)
    seed_picklist_definitions(db_session, org_id)
    return org_id


def _mk_building(client, headers):
    area = client.post(
        "/api/areas", json={"area_name": "שכונה יג"}, headers=headers
    ).json()
    return client.post(
        "/api/buildings",
        json={"area_id": area["id"], "building_address": "13 Lang St", "floors": []},
        headers=headers,
    ).json()


def test_apartment_language_roundtrip_and_validation(client, admin_headers, db_session):
    # fixes51 §2.2: language became multi-select — a list of technical
    # values instead of one string.
    _provision(client, db_session, admin_headers)
    b = _mk_building(client, admin_headers)
    # Valid picklist value round-trips.
    r = client.post(
        "/api/apartments",
        json={"building_id": b["id"], "apartment_name": "3", "language": ["russian"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    apt = r.json()
    assert apt["language"] == ["russian"]
    # Update to another valid value. fixes19: an update returns a NEW active
    # version (the old id becomes a historical snapshot) — follow the new id.
    r = client.put(
        f"/api/apartments/{apt['id']}", json={"language": ["yiddish"]}, headers=admin_headers
    )
    assert r.status_code == 200 and r.json()["language"] == ["yiddish"]
    current_id = r.json()["id"]
    # Unknown value is rejected against the org's picklist.
    r = client.put(
        f"/api/apartments/{current_id}", json={"language": ["klingon"]}, headers=admin_headers
    )
    assert r.status_code == 400


def test_apartment_language_picklist_provisioned(client, admin_headers, db_session):
    _provision(client, db_session, admin_headers)
    # The definition appears in the registry (apartment.* → the Apartment group).
    defs = client.get("/api/picklists", headers=admin_headers).json()
    by_key = {d["field_key"]: d for d in defs}
    assert "apartment.language" in by_key
    assert by_key["apartment.language"]["english_label"] == "Language"
    assert by_key["apartment.language"]["label"] == "שפה"

    # The five bilingual options are seeded.
    options = client.get(
        "/api/picklists/apartment.language", headers=admin_headers
    ).json()
    got = {(o["value"], o["hebrew_label"], o.get("english_value")) for o in options}
    assert got == {
        ("hebrew", "עברית", "Hebrew"),
        ("english", "אנגלית", "English"),
        ("russian", "רוסית", "Russian"),
        ("yiddish", "יידיש", "Yiddish"),
        ("missing", "חסר", "Missing"),
    }


def test_apartment_name_label_renamed(client, db_session):
    seed_localization(db_session)
    row = (
        db_session.query(models.FieldLocalization)
        .filter(models.FieldLocalization.technical_name == "apartments.apartment_name")
        .one()
    )
    assert row.hebrew_label == "מספר דירה"
    assert row.english_label == "Apartment number"

    # The rename also converts rows still carrying the OLD seed text (existing
    # DBs) — but never a custom admin label.
    row.hebrew_label = "כותרת"
    db_session.commit()
    seed_localization(db_session)
    db_session.refresh(row)
    assert row.hebrew_label == "מספר דירה"

    row.hebrew_label = "מותאם אישית"
    db_session.commit()
    seed_localization(db_session)
    db_session.refresh(row)
    assert row.hebrew_label == "מותאם אישית"
