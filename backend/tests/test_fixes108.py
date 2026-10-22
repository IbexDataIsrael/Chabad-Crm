"""fixes108: a new task can be created with the org's own task fields
(single + bulk create), and the built-in task.custom_date is listed on the
Fields page's Tasks tab."""
from app import models

# Reuse fixes104's org setup: task.priority picklist + called/note custom fields.
from tests.test_fixes104 import setup  # noqa: F401


def _campaign_and_rns(client, admin_headers, db_session, org_id, n):
    rns = [models.ReportNumber(organization_id=org_id, name=f"RN108-{i}") for i in range(n)]
    db_session.add_all(rns)
    db_session.commit()
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין 108", "is_active": True}, headers=admin_headers
    ).json()
    return campaign["id"], [rn.id for rn in rns]


def test_create_sets_custom_values(client, admin_headers, db_session, setup):  # noqa: F811
    campaign_id, rn_ids = _campaign_and_rns(client, admin_headers, db_session, setup["org_id"], 1)
    r = client.post(
        "/api/tasks",
        json={
            "campaign_id": campaign_id,
            "report_number_ids": rn_ids,
            "picklist_values": {"task.priority": "high"},
            "custom_field_values": {"called": True, "note": "קומה ב"},
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["picklist_values"] == {"task.priority": "high"}
    assert r.json()["custom_field_values"] == {"called": True, "note": "קומה ב"}


def test_create_rejects_foreign_picklist(client, admin_headers, db_session, setup):  # noqa: F811
    campaign_id, rn_ids = _campaign_and_rns(client, admin_headers, db_session, setup["org_id"], 1)
    r = client.post(
        "/api/tasks",
        json={"campaign_id": campaign_id, "report_number_ids": rn_ids,
              "picklist_values": {"apartment.language": "he"}},
        headers=admin_headers,
    )
    assert r.status_code == 400


def test_bulk_create_sets_custom_values_on_every_task(client, admin_headers, db_session, setup):  # noqa: F811
    campaign_id, rn_ids = _campaign_and_rns(client, admin_headers, db_session, setup["org_id"], 2)
    r = client.post(
        "/api/tasks/bulk",
        json={
            "campaign_id": campaign_id,
            "report_number_ids": rn_ids,
            "picklist_values": {"task.priority": "low"},
            "custom_field_values": {"note": "x"},
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    created = r.json()["created_task_ids"]
    assert len(created) == 2
    for tid in created:
        body = client.get(f"/api/tasks/{tid}", headers=admin_headers).json()
        assert body["picklist_values"] == {"task.priority": "low"}
        assert body["custom_field_values"] == {"note": "x"}


def test_custom_date_is_a_toggleable_task_field(client, admin_headers):
    rows = client.get("/api/field-settings", headers=admin_headers).json()
    row = next(r for r in rows if r["field_key"] == "task.custom_date")
    assert row["entity"] == "task" and row["is_visible"] is True
    r = client.put(
        "/api/field-settings",
        json={"field_key": "task.custom_date", "is_visible": False},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
