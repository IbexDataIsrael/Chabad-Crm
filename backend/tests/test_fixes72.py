"""Fixes72 §1: a picklist value still used by live records can't be
hard-deleted; /usage reports where. Apartments are versioned — only the
active version counts, a retired version's link is purged with the value."""
from app import models
from tests.test_fixes51 import _mk_apartment, _mk_area, _mk_building, _provision


def _lang_id(client, headers, value):
    opts = client.get(
        "/api/picklists/apartment.language?include_inactive=true", headers=headers
    ).json()
    return next(o["id"] for o in opts if o["value"] == value)


def test_active_apartment_blocks_retired_version_does_not(client, admin_headers, db_session):
    _provision(client, db_session, admin_headers)
    b = _mk_building(client, admin_headers, _mk_area(client, admin_headers)["id"], "72 Use St")
    ap = _mk_apartment(client, admin_headers, b["id"], apartment_name="3", language=["russian"])

    russian = _lang_id(client, admin_headers, "russian")
    usage = client.get(f"/api/picklists/{russian}/usage", headers=admin_headers).json()
    assert usage["count"] == 1
    loc = usage["locations"][0]
    assert loc["entity"] == "apartments"
    assert loc["samples"] == [{"id": ap["id"], "label": "72 Use St 3"}]
    assert client.delete(f"/api/picklists/{russian}?hard=true", headers=admin_headers).status_code == 409

    # Editing creates a new active version without "russian"; the retired
    # version still links it, but that no longer blocks.
    r = client.put(f"/api/apartments/{ap['id']}", json={"language": ["yiddish"]}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert (
        db_session.query(models.PicklistLink)
        .filter(models.PicklistLink.picklist_value_id == russian)
        .count()
        == 1
    )
    assert client.get(f"/api/picklists/{russian}/usage", headers=admin_headers).json() == {
        "count": 0,
        "locations": [],
    }
    assert client.delete(f"/api/picklists/{russian}?hard=true", headers=admin_headers).status_code == 200
    db_session.expire_all()
    assert (
        db_session.query(models.PicklistLink)
        .filter(models.PicklistLink.picklist_value_id == russian)
        .count()
        == 0
    )
