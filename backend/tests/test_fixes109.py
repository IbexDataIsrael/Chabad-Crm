"""fixes109: task date & time (scheduled_at) on create / bulk / update /
output, and the tasks list sorts by every displayed column."""
import pytest

from app import models

# fixes104's org setup: task.priority picklist + called/note custom fields,
# two tasks on one report number.
from tests.test_fixes104 import setup  # noqa: F401

FIXED_SORTS = [
    "id", "volunteer_name", "campaign", "report_number", "status", "report_status",
    "report_notes", "custom_date", "scheduled_at", "apartment_count", "created_at",
]


def _campaign(client, headers, name):
    return client.post(
        "/api/campaigns", json={"name": name, "is_active": True}, headers=headers
    ).json()["id"]


def _rns(db_session, org_id, n, prefix):
    rns = [models.ReportNumber(organization_id=org_id, name=f"{prefix}-{i}") for i in range(n)]
    db_session.add_all(rns)
    db_session.commit()
    return [rn.id for rn in rns]


def _ids(client, headers, sort, direction="asc"):
    r = client.get("/api/tasks/list", params={"sort": sort, "dir": direction}, headers=headers)
    assert r.status_code == 200, r.text
    return [t["id"] for t in r.json()["items"]]


def test_scheduled_at_create_update_and_bulk(client, admin_headers, db_session, setup):  # noqa: F811
    campaign_id = _campaign(client, admin_headers, "קמפיין 109")
    rn_ids = _rns(db_session, setup["org_id"], 3, "RN109")
    r = client.post(
        "/api/tasks",
        json={"campaign_id": campaign_id, "report_number_ids": [rn_ids[0]],
              "scheduled_at": "2026-11-05T18:30"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    # Stored and returned as typed (wall-clock, no zone shift).
    assert r.json()["scheduled_at"].startswith("2026-11-05T18:30")
    assert client.get(f"/api/tasks/{tid}", headers=admin_headers).json()["scheduled_at"].startswith(
        "2026-11-05T18:30"
    )

    r = client.put(f"/api/tasks/{tid}", json={"scheduled_at": "2026-12-01T09:15"}, headers=admin_headers)
    assert r.json()["scheduled_at"].startswith("2026-12-01T09:15")
    # Untouched by an update that doesn't mention it.
    r = client.put(f"/api/tasks/{tid}", json={"status": "PAUSED"}, headers=admin_headers)
    assert r.json()["scheduled_at"].startswith("2026-12-01T09:15")
    r = client.put(f"/api/tasks/{tid}", json={"scheduled_at": None}, headers=admin_headers)
    assert r.json()["scheduled_at"] is None

    r = client.post(
        "/api/tasks/bulk",
        json={"campaign_id": campaign_id, "report_number_ids": rn_ids[1:],
              "scheduled_at": "2026-11-07T10:00"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    for created in r.json()["created_task_ids"]:
        body = client.get(f"/api/tasks/{created}", headers=admin_headers).json()
        assert body["scheduled_at"].startswith("2026-11-07T10:00")


@pytest.mark.parametrize("sort", FIXED_SORTS + ["pl:task.priority", "cf:called", "cf:note", "pl:nope", "bogus"])
@pytest.mark.parametrize("direction", ["asc", "desc"])
def test_every_sort_key_is_accepted(client, admin_headers, setup, sort, direction):  # noqa: F811
    assert sorted(_ids(client, admin_headers, sort, direction)) == sorted(setup["task_ids"])


def test_sort_orders(client, admin_headers, db_session, setup):  # noqa: F811
    a, b = setup["task_ids"]
    client.put(f"/api/tasks/{a}", json={
        "scheduled_at": "2026-11-02T08:00", "status": "PAUSED",
        "picklist_values": {"task.priority": "low"},
        "custom_field_values": {"note": "בית", "called": True},
    }, headers=admin_headers)
    client.put(f"/api/tasks/{b}", json={
        "scheduled_at": "2026-11-01T08:00", "status": "COMPLETED",
        "picklist_values": {"task.priority": "high"},
        "custom_field_values": {"note": "אלף"},
    }, headers=admin_headers)

    assert _ids(client, admin_headers, "id") == [a, b]
    assert _ids(client, admin_headers, "id", "desc") == [b, a]
    assert _ids(client, admin_headers, "scheduled_at") == [b, a]
    assert _ids(client, admin_headers, "scheduled_at", "desc") == [a, b]
    # Workflow order: COMPLETED before PAUSED.
    assert _ids(client, admin_headers, "status") == [b, a]
    # Picklist sorts by option order: "high" was added before "low".
    assert _ids(client, admin_headers, "pl:task.priority") == [b, a]
    assert _ids(client, admin_headers, "cf:note") == [b, a]
    # Blank (never-set) values sort last in both directions.
    assert _ids(client, admin_headers, "cf:called", "asc")[-1] == b
    assert _ids(client, admin_headers, "cf:called", "desc")[-1] == b

    # Campaign name.
    other = _campaign(client, admin_headers, "אאא 109")
    client.put(f"/api/tasks/{b}", json={"campaign_id": other}, headers=admin_headers)
    assert _ids(client, admin_headers, "campaign") == [b, a]
