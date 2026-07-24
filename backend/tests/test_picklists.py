from app.picklist_utils import PICKLIST_FIELDS
from app.seed import seed_picklist_definitions, seed_picklists

FK = "contact.pipeline_status"


def _org_id(client, headers):
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def test_reads_require_auth(client):
    assert client.get("/api/picklists").status_code == 401
    assert client.get(f"/api/picklists/{FK}").status_code == 401


def test_staff_can_read_but_not_mutate(client, auth_headers, db_session):
    seed_picklists(db_session, _org_id(client, auth_headers))
    # Read OK
    r = client.get(f"/api/picklists/{FK}", headers=auth_headers)
    assert r.status_code == 200
    assert len(r.json()) == 4  # new, in_progress, sent, completed
    # Mutation forbidden for staff
    m = client.post(
        f"/api/picklists/{FK}",
        json={"value": "x", "hebrew_label": "איקס"},
        headers=auth_headers,
    )
    assert m.status_code == 403


def test_admin_crud_and_uniqueness(client, admin_headers, db_session):
    # The picklist registry is DB-driven: seed the org's definitions so the
    # registry lists them (values are created by the test itself, not seeded).
    seed_picklist_definitions(db_session, _org_id(client, admin_headers))

    # Create
    r = client.post(
        f"/api/picklists/{FK}",
        json={"value": "new", "hebrew_label": "חדש", "sort_order": 0},
        headers=admin_headers,
    )
    assert r.status_code == 201
    pid = r.json()["id"]

    # Duplicate value within same field_key rejected
    dup = client.post(
        f"/api/picklists/{FK}",
        json={"value": "new", "hebrew_label": "שוב"},
        headers=admin_headers,
    )
    assert dup.status_code == 400

    # field_keys listing returns the full registry of managed picklists.
    keys = [k["field_key"] for k in client.get("/api/picklists", headers=admin_headers).json()]
    assert FK in keys
    assert "contact.pipeline_status" in keys  # registry includes empty picklists too

    # Update label
    upd = client.put(
        f"/api/picklists/{pid}",
        json={"hebrew_label": "חדש מאוד"},
        headers=admin_headers,
    )
    assert upd.status_code == 200
    assert upd.json()["hebrew_label"] == "חדש מאוד"


def test_soft_delete_hides_from_default_list(client, admin_headers):
    pid = client.post(
        f"/api/picklists/{FK}",
        json={"value": "temp", "hebrew_label": "זמני"},
        headers=admin_headers,
    ).json()["id"]
    # Soft delete
    d = client.delete(f"/api/picklists/{pid}", headers=admin_headers)
    assert d.status_code == 200
    assert d.json()["is_active"] is False
    # Hidden by default, visible with include_inactive
    active = client.get(f"/api/picklists/{FK}", headers=admin_headers).json()
    assert all(o["value"] != "temp" for o in active)
    all_opts = client.get(
        f"/api/picklists/{FK}?include_inactive=true", headers=admin_headers
    ).json()
    assert any(o["value"] == "temp" for o in all_opts)


def test_reorder(client, admin_headers):
    ids = []
    for i, v in enumerate(["a", "b", "c"]):
        ids.append(
            client.post(
                f"/api/picklists/{FK}",
                json={"value": v, "hebrew_label": v, "sort_order": i},
                headers=admin_headers,
            ).json()["id"]
        )
    reversed_ids = list(reversed(ids))
    r = client.put(
        f"/api/picklists/{FK}/reorder",
        json={"ordered_ids": reversed_ids},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert [o["id"] for o in r.json()] == reversed_ids


def test_hard_delete_blocked_when_in_use(client, admin_headers, db_session):
    seed_picklists(db_session, _org_id(client, admin_headers))
    # Create a contact using the 'new' pipeline status
    cid = client.post(
        "/api/contacts",
        json={"name": "בדיקה", "phone": "050-7000001", "pipeline_status": "new"},
        headers=admin_headers,
    ).json()["id"]
    assert cid

    # Find the 'new' option id
    opts = client.get(f"/api/picklists/{FK}", headers=admin_headers).json()
    new_id = next(o["id"] for o in opts if o["value"] == "new")

    # Hard delete blocked (in use)
    blocked = client.delete(
        f"/api/picklists/{new_id}?hard=true", headers=admin_headers
    )
    assert blocked.status_code == 409

    # An unused option can be hard-deleted
    unused_id = next(o["id"] for o in opts if o["value"] == "completed")
    ok = client.delete(f"/api/picklists/{unused_id}?hard=true", headers=admin_headers)
    assert ok.status_code == 200


def test_out_of_picklist_value_rejected(client, admin_headers, db_session):
    seed_picklists(db_session, _org_id(client, admin_headers))
    # pipeline_status not in the picklist
    bad = client.post(
        "/api/contacts",
        json={"name": "x", "phone": "050-7100001", "pipeline_status": "not_a_status"},
        headers=admin_headers,
    )
    assert bad.status_code == 400
    # interaction category not in the picklist (fixes25: entries ride on the
    # visit's interactions log)
    cid = client.post(
        "/api/contacts",
        json={"name": "y", "phone": "050-7100002", "pipeline_status": "new"},
        headers=admin_headers,
    ).json()["id"]
    bad_ix = client.post(
        f"/api/contacts/{cid}/visits",
        json={
            "visit_date": "2026-07-01T00:00:00",
            "interactions": [{"category": "nope", "note": "n"}],
        },
        headers=admin_headers,
    )
    assert bad_ix.status_code == 400


# --- fixes37: PicklistDefinition.entity_type as real data --------------------
def test_seed_backfills_entity_type_per_registry_key(client, admin_headers, db_session):
    seed_picklist_definitions(db_session, _org_id(client, admin_headers))
    rows = {
        d["field_key"]: d["entity_type"]
        for d in client.get("/api/picklists", headers=admin_headers).json()
    }
    for system_name, (_, expected_entity) in PICKLIST_FIELDS.items():
        assert rows[system_name] == expected_entity, system_name


def test_create_definition_round_trips_entity_type(client, admin_headers):
    r = client.post(
        "/api/picklists/definition",
        json={
            "system_name": "apartment.diet37",
            "hebrew_display_name": "בדיקה37",
            "entity_type": "apartment",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["entity_type"] == "apartment"

    listed = {
        d["field_key"]: d["entity_type"]
        for d in client.get("/api/picklists", headers=admin_headers).json()
    }
    assert listed["apartment.diet37"] == "apartment"


def test_create_definition_auto_upgrades_shliach_prefix_to_contact_shliach(
    client, admin_headers
):
    """A "contacts"-tab addition named shliach.* is a real, existing
    sub-namespace (fixes35 §5) — the router must still split it out of the
    generic "contact_mekurav" bucket even though the caller (matching the
    admin Picklists page's actual UI, which has no separate shliach tab)
    only ever sends entity_type="contact_mekurav" for it."""
    r = client.post(
        "/api/picklists/definition",
        json={
            "system_name": "shliach.role37",
            "hebrew_display_name": "תפקיד37",
            "entity_type": "contact_mekurav",
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["entity_type"] == "contact_shliach"
