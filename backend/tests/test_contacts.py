_phone_counter = [0]


def _make_contact(client, auth_headers, **overrides):
    _phone_counter[0] += 1
    payload = {"name": "ריכמן אלי", "phone": f"050-000{_phone_counter[0]:04d}"}
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=auth_headers)


def test_contact_phone_required(client, auth_headers):
    r = client.post("/api/contacts", json={"name": "בלי טלפון"}, headers=auth_headers)
    assert r.status_code == 422  # phone is required


def test_contact_phone_unique_per_org(client, auth_headers):
    assert _make_contact(client, auth_headers, phone="050-5550000").status_code == 201
    dup = _make_contact(client, auth_headers, phone="050-5550000")
    assert dup.status_code == 400


def test_contacts_require_auth(client):
    assert client.get("/api/contacts").status_code == 401


def test_contact_crud_and_checklist_autocreated(client, auth_headers):
    r = _make_contact(client, auth_headers, pipeline_status="קולח", color_tag="magenta")
    assert r.status_code == 201
    body = r.json()
    cid = body["id"]
    # Checklist is auto-created and nested on detail responses.
    assert body["checklist"]["contact_id"] == cid
    assert body["checklist"]["tefillin"] is False

    # Update
    upd = client.put(
        f"/api/contacts/{cid}", json={"priority_score": 5}, headers=auth_headers
    )
    assert upd.status_code == 200
    assert upd.json()["priority_score"] == 5

    # Delete
    assert client.delete(f"/api/contacts/{cid}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/contacts/{cid}", headers=auth_headers).status_code == 404


def test_contact_list_filters(client, auth_headers):
    _make_contact(client, auth_headers, name="א", pipeline_status="קולח")
    _make_contact(client, auth_headers, name="ב", pipeline_status="שלח")

    by_status = client.get("/api/contacts?pipeline_status=שלח", headers=auth_headers).json()
    assert len(by_status) == 1 and by_status[0]["name"] == "ב"


def test_contact_invalid_assignee_fk(client, auth_headers):
    r = _make_contact(client, auth_headers, assigned_user_id=99999)
    assert r.status_code == 400


def test_contact_new_fields_roundtrip(client, auth_headers):
    # Kiruv fields live on the nested `mekurav` object (fixes2 contact split).
    cid = _make_contact(
        client,
        auth_headers,
        last_name="ריכמן",
        mekurav={
            "first_visit": "2026-01-15T10:00:00",
            "rebbe_connection": "קשר חזק",
            "recommendations": "ממליץ",
            "background": "רקע כללי",
        },
        address="דיזנגוף 100, תל אביב",
        latitude=32.0809,
        longitude=34.7738,
    ).json()["id"]
    body = client.get(f"/api/contacts/{cid}", headers=auth_headers).json()
    assert body["last_name"] == "ריכמן"
    assert body["latitude"] == 32.0809
    assert body["longitude"] == 34.7738
    mk = body["mekurav"]
    assert mk["rebbe_connection"] == "קשר חזק"
    assert mk["recommendations"] == "ממליץ"
    assert mk["background"] == "רקע כללי"
    assert mk["first_visit"].startswith("2026-01-15")


def test_checklist_update(client, auth_headers):
    cid = _make_contact(client, auth_headers).json()["id"]
    upd = client.put(
        f"/api/contacts/{cid}/checklist",
        json={"tefillin": True, "shabbat_candles": True},
        headers=auth_headers,
    )
    assert upd.status_code == 200
    body = upd.json()
    assert body["tefillin"] is True
    assert body["shabbat_candles"] is True
    assert body["tzedakah"] is False

    # New note + picklist fields on the checklist.
    upd2 = client.put(
        f"/api/contacts/{cid}/checklist",
        json={"charity_note": "נתן בעין יפה", "letter_torah_notes": "נרכש"},
        headers=auth_headers,
    )
    assert upd2.status_code == 200
    assert upd2.json()["charity_note"] == "נתן בעין יפה"
    assert upd2.json()["letter_torah_notes"] == "נרכש"


def test_geocode_fallback_fills_coords(client, auth_headers, monkeypatch):
    import app.routers.contacts as contacts_router

    monkeypatch.setattr(contacts_router, "geocode_address", lambda addr: (1.5, 2.5))
    r = _make_contact(client, auth_headers, address="כתובת כלשהי")
    assert r.status_code == 201
    body = r.json()
    assert body["latitude"] == 1.5
    assert body["longitude"] == 2.5


def test_geocode_skipped_when_coords_provided(client, auth_headers, monkeypatch):
    import app.routers.contacts as contacts_router

    monkeypatch.setattr(contacts_router, "geocode_address", lambda addr: (9.9, 9.9))
    r = _make_contact(
        client, auth_headers, address="כתובת", latitude=10.0, longitude=20.0
    )
    # Coordinates supplied by the client are not overwritten.
    assert r.json()["latitude"] == 10.0
    assert r.json()["longitude"] == 20.0


def test_geocode_fallback_on_update(client, auth_headers, monkeypatch):
    import app.routers.contacts as contacts_router

    cid = _make_contact(client, auth_headers).json()["id"]
    monkeypatch.setattr(contacts_router, "geocode_address", lambda addr: (3.3, 4.4))
    upd = client.put(
        f"/api/contacts/{cid}",
        json={"address": "רחוב חדש", "latitude": None, "longitude": None},
        headers=auth_headers,
    )
    assert upd.status_code == 200
    assert upd.json()["latitude"] == 3.3
    assert upd.json()["longitude"] == 4.4


def test_delete_contact_cascades_interactions(client, auth_headers):
    cid = _make_contact(client, auth_headers).json()["id"]
    client.post(
        "/api/interactions",
        json={"contact_id": cid, "category": "background", "note": "פתק"},
        headers=auth_headers,
    )
    assert len(client.get(f"/api/interactions?contact_id={cid}", headers=auth_headers).json()) == 1
    client.delete(f"/api/contacts/{cid}", headers=auth_headers)
    # Interactions for the deleted contact are gone (cascade).
    assert client.get(f"/api/interactions?contact_id={cid}", headers=auth_headers).json() == []


def test_delete_contact_cascades_visits_and_picklists_but_keeps_donations(
    client, auth_headers, db_session
):
    """Deleting a contact removes its visits + picklist values (contact-specific)
    but preserves donations (financial records), nulling their contact link.

    Regression for the SQLite->Postgres move: these FKs had no cascade, so under
    enforced foreign keys a contact delete would have failed / orphaned rows.
    """
    import datetime

    from app import models

    cid = _make_contact(client, auth_headers).json()["id"]
    org_id = db_session.get(models.Contact, cid).organization_id

    pl = models.PicklistDefinition(
        organization_id=org_id, system_name="affiliation", hebrew_display_name="זרם"
    )
    db_session.add(pl)
    db_session.flush()
    db_session.add_all(
        [
            models.VisitHistory(
                organization_id=org_id,
                contact_id=cid,
                visit_date=datetime.datetime.utcnow(),
            ),
            models.ContactPicklistValue(
                organization_id=org_id, contact_id=cid, picklist_id=pl.id, value="haredi"
            ),
            models.Donation(
                organization_id=org_id,
                contact_id=cid,
                donation_date=datetime.datetime.utcnow(),
                amount=100.0,
            ),
        ]
    )
    db_session.commit()

    assert client.delete(f"/api/contacts/{cid}", headers=auth_headers).status_code == 204

    db_session.expire_all()
    assert db_session.get(models.Contact, cid) is None
    assert db_session.query(models.VisitHistory).filter_by(contact_id=cid).count() == 0
    assert (
        db_session.query(models.ContactPicklistValue).filter_by(contact_id=cid).count()
        == 0
    )
    # Donation survives the contact, with its link nulled out.
    donations = db_session.query(models.Donation).all()
    assert len(donations) == 1
    assert donations[0].contact_id is None
