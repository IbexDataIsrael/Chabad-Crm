_phone_counter = [0]


def _make_contact(client, auth_headers, **overrides):
    _phone_counter[0] += 1
    payload = {"name": "ריכמן אלי", "phone": f"050-000{_phone_counter[0]:04d}"}
    payload.update(overrides)
    return client.post("/api/contacts", json=payload, headers=auth_headers)


def test_contacts_list_pagination(client, auth_headers):
    for n in range(25):
        assert _make_contact(client, auth_headers, name=f"מקורב {n:02d}").status_code == 201
    page1 = client.get("/api/contacts/list?page=1&page_size=20", headers=auth_headers).json()
    assert set(page1) == {"items", "total", "page", "page_size"}
    assert page1["total"] == 25 and len(page1["items"]) == 20
    page2 = client.get("/api/contacts/list?page=2&page_size=20", headers=auth_headers).json()
    assert len(page2["items"]) == 5
    # Pages are disjoint and ordered by name.
    names = [c["name"] for c in page1["items"] + page2["items"]]
    assert names == sorted(names) and len(set(names)) == 25
    # Filters still apply; bad page sizes are rejected.
    filtered = client.get(
        "/api/contacts/list?contact_type=shliach", headers=auth_headers
    ).json()
    assert filtered["total"] == 0
    assert (
        client.get("/api/contacts/list?page_size=7", headers=auth_headers).status_code
        == 422
    )


def test_contact_phone_optional(client, auth_headers):
    # Phone became optional for the data import; omitted → stored as NULL.
    r = client.post("/api/contacts", json={"name": "בלי טלפון"}, headers=auth_headers)
    assert r.status_code == 201, r.text
    assert r.json()["phone"] is None
    # Two phoneless contacts coexist (NULLs don't collide in the unique key).
    r = client.post("/api/contacts", json={"name": "גם בלי טלפון"}, headers=auth_headers)
    assert r.status_code == 201, r.text
    # A provided phone must still be valid.
    r = client.post(
        "/api/contacts", json={"name": "רע", "phone": "abc"}, headers=auth_headers
    )
    assert r.status_code == 422


def test_contact_phone_unique_per_org(client, auth_headers):
    assert _make_contact(client, auth_headers, phone="050-5550000").status_code == 201
    dup = _make_contact(client, auth_headers, phone="050-5550000")
    assert dup.status_code == 400


def test_contacts_require_auth(client):
    assert client.get("/api/contacts").status_code == 401


def test_contact_crud(client, auth_headers):
    r = _make_contact(client, auth_headers, pipeline_status="קולח", color_tag="magenta")
    assert r.status_code == 201
    body = r.json()
    cid = body["id"]
    # fixes25: no contact-level checklist anymore (Mivtzoim live on visits).
    assert "checklist" not in body

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
    # assigned_user_id is a user GUID (fixes10 §2.1); an unknown one is a 400.
    r = _make_contact(
        client, auth_headers,
        assigned_user_id="00000000-0000-0000-0000-000000000000",
    )
    assert r.status_code == 400


def test_contact_new_fields_roundtrip(client, auth_headers):
    # Kiruv fields live on the nested `mekurav` object (fixes2 contact split).
    cid = _make_contact(
        client,
        auth_headers,
        last_name="ריכמן",
        mekurav={
            "first_visit": "2026-01-15T10:00:00",
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
    assert mk["recommendations"] == "ממליץ"
    assert mk["background"] == "רקע כללי"
    assert mk["first_visit"].startswith("2026-01-15")


def test_visit_mivtzoim_roundtrip(client, auth_headers):
    """fixes25: the Mivtzoim flags + engagement extras live on the visit."""
    cid = _make_contact(client, auth_headers).json()["id"]
    r = client.post(
        f"/api/contacts/{cid}/visits",
        json={
            "visit_date": "2026-02-01T10:00:00",
            "tefillin": True,
            "shabbat_candles": True,
            "connection_to_rebbe": "קשר חזק",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["tefillin"] is True
    assert body["shabbat_candles"] is True
    assert body["tzedakah"] is False
    assert body["letter_in_torah"] is False
    assert body["connection_to_rebbe"] == "קשר חזק"

    # Partial update flips one flag and leaves the others alone.
    upd = client.put(
        f"/api/contacts/{cid}/visits/{body['id']}",
        json={"tzedakah": True},
        headers=auth_headers,
    )
    assert upd.status_code == 200
    assert upd.json()["tzedakah"] is True
    assert upd.json()["tefillin"] is True

    # The contact-level checklist endpoint is gone.
    assert (
        client.put(
            f"/api/contacts/{cid}/checklist", json={"tefillin": True}, headers=auth_headers
        ).status_code
        == 404
    )


def test_visit_interactions_log(client, auth_headers):
    """fixes25: interactions are a JSON log on the visit; missing timestamps
    and author names are stamped server-side."""
    cid = _make_contact(client, auth_headers).json()["id"]
    r = client.post(
        f"/api/contacts/{cid}/visits",
        json={
            "visit_date": "2026-02-01T10:00:00",
            "interactions": [{"category": "background", "note": "פתק"}],
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    entries = r.json()["interactions"]
    assert len(entries) == 1
    assert entries[0]["category"] == "background"
    assert entries[0]["note"] == "פתק"
    assert entries[0]["created_at"]  # stamped
    assert entries[0]["author_name"]  # stamped

    # The old standalone interactions API is gone.
    assert (
        client.post(
            "/api/interactions",
            json={"contact_id": cid, "category": "background", "note": "x"},
            headers=auth_headers,
        ).status_code
        == 404
    )


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


def test_delete_contact_cascades_visit_custom_values(client, auth_headers, db_session):
    """fixes25: deleting a contact removes its visits, and the visit delete
    cascades the visit-scoped custom-field values."""
    from app import models

    cid = _make_contact(client, auth_headers).json()["id"]
    vid = client.post(
        f"/api/contacts/{cid}/visits",
        json={"visit_date": "2026-02-01T10:00:00"},
        headers=auth_headers,
    ).json()["id"]
    org_id = db_session.get(models.Contact, cid).organization_id
    cf = models.CustomFieldDefinition(
        organization_id=org_id, field_key="test_field", hebrew_label="שדה"
    )
    db_session.add(cf)
    db_session.commit()
    r = client.put(
        f"/api/visits/{vid}/custom-fields",
        json=[{"definition_id": cf.id, "checked": True, "note": "כן"}],
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert db_session.query(models.CustomFieldValue).count() == 1

    client.delete(f"/api/contacts/{cid}", headers=auth_headers)
    assert db_session.query(models.VisitHistory).filter_by(contact_id=cid).count() == 0
    assert db_session.query(models.CustomFieldValue).count() == 0


def test_delete_contact_cascades_visits_and_picklists_but_keeps_donations(
    client, auth_headers, db_session
):
    """Deleting a contact removes its visits + picklist values (contact-specific)
    but preserves donations (financial records), nulling their contact link.

    Regression for the SQLite->Postgres move: these FKs had no cascade, so under
    enforced foreign keys a contact delete would have failed / orphaned rows.
    """
    import datetime

    from app import models, picklist_utils

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
            models.Donation(
                organization_id=org_id,
                contact_id=cid,
                donation_date=datetime.datetime.utcnow(),
                amount=100.0,
            ),
        ]
    )
    db_session.commit()
    # fixes32: dynamic picklist selections live in PicklistLink now.
    picklist_utils.set_value(db_session, org_id, "contacts", cid, "affiliation", "haredi")
    db_session.commit()

    assert client.delete(f"/api/contacts/{cid}", headers=auth_headers).status_code == 204

    db_session.expire_all()
    assert db_session.get(models.Contact, cid) is None
    assert db_session.query(models.VisitHistory).filter_by(contact_id=cid).count() == 0
    assert (
        db_session.query(models.PicklistLink)
        .filter_by(entity_table="contacts", entity_id=cid)
        .count()
        == 0
    )
    # Donation survives the contact, with its link nulled out.
    donations = db_session.query(models.Donation).all()
    assert len(donations) == 1
    assert donations[0].contact_id is None
