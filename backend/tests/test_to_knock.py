"""to_knock sync (fixes71 §C.2): every Jewish-status write keeps the
apartment's "to_knock" custom field in step — false for an explicit
no-knock status (incl. prod's admin-added "dont_knock" = "לא לדפוק!"),
true otherwise. street2's door colors and building completion read it."""
import uuid

import pytest

from app import models
from app.seed import seed_apartment_custom_fields, seed_picklist_definitions, seed_picklists


def _provision(client, db_session, headers):
    org_id = client.get("/api/auth/me", headers=headers).json()["organization_id"]
    seed_picklists(db_session, org_id)
    seed_picklist_definitions(db_session, org_id)
    seed_apartment_custom_fields(db_session, org_id)
    # Admin-added on prod, not in the seed.
    for i, (value, label) in enumerate([("gentile", "גוי"), ("dont_knock", "לא לדפוק!")]):
        db_session.add(
            models.PicklistValue(
                guid=str(uuid.uuid4()),
                organization_id=org_id,
                field_key="apartment.Jewish_status",
                value=value,
                hebrew_label=label,
                sort_order=20 + i,
                is_active=True,
                is_default=False,
            )
        )
    db_session.commit()


def _mk_apartment(client, headers):
    r = client.post("/api/areas", json={"area_name": "knock area"}, headers=headers)
    assert r.status_code == 201, r.text
    r = client.post(
        "/api/buildings",
        json={"area_id": r.json()["id"], "building_address": "1 Knock St", "floors": ["1"]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    r = client.post("/api/apartments", json={"building_id": r.json()["id"]}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.parametrize(
    "status,expected",
    [
        ("gentile", False),
        ("dont_knock", False),
        ("not_jewish", False),
        ("jewish", True),
        ("jewish_gentile", True),
    ],
)
def test_jewish_status_write_syncs_to_knock(client, admin_headers, db_session, status, expected):
    _provision(client, db_session, admin_headers)
    apt = _mk_apartment(client, admin_headers)
    r = client.put(
        f"/api/apartments/{apt['id']}", json={"jewish_status": status}, headers=admin_headers
    )
    assert r.status_code == 200, r.text
    assert r.json()["custom_field_values"]["to_knock"] is expected
