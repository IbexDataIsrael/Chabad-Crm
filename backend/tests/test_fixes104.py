"""fixes104: the org's own task fields (task picklists from the Picklists
page's Tasks tab + entity_type="task" custom fields) are stored, returned,
filterable on the tasks list, printable, and cleaned up on delete."""
import pytest

from app import models

EMPTY = "\x00__empty__\x00"


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


@pytest.fixture
def setup(client, admin_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    area = models.Area(organization_id=org_id, area_name="א104")
    db_session.add(area)
    db_session.flush()
    building = models.Building(organization_id=org_id, area_id=area.id, building_address="1 Main St")
    rn = models.ReportNumber(organization_id=org_id, name="RN104")
    db_session.add_all([building, rn])
    db_session.flush()
    db_session.add(
        models.Apartment(
            organization_id=org_id, building_id=building.id, report_number_id=rn.id,
            floor="1", apartment_name="1",
        )
    )
    db_session.commit()

    r = client.post(
        "/api/picklists/definition",
        json={"system_name": "task.priority", "hebrew_display_name": "עדיפות", "entity_type": "task"},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    for value in ("high", "low"):
        r = client.post(
            "/api/picklists/task.priority",
            json={"value": value, "hebrew_label": value},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
    for key, field_type in (("called", "boolean"), ("note", "text")):
        r = client.post(
            "/api/custom-fields",
            json={"entity_type": "task", "field_key": key, "hebrew_label": key, "field_type": field_type},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text

    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין 104", "is_active": True}, headers=admin_headers
    ).json()
    ids = []
    for _ in range(2):
        r = client.post(
            "/api/tasks",
            json={"campaign_id": campaign["id"], "report_number_ids": [rn.id]},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return {"org_id": org_id, "task_ids": ids}


def _list_ids(client, headers, name=None, value=None):
    params = {name: value} if name else None
    r = client.get("/api/tasks/list", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return {t["id"] for t in r.json()["items"]}


def test_values_are_saved_and_returned(client, admin_headers, setup):
    tid = setup["task_ids"][0]
    r = client.put(
        f"/api/tasks/{tid}",
        json={
            "picklist_values": {"task.priority": "high"},
            "custom_field_values": {"called": True, "note": "קומה שלישית"},
        },
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["picklist_values"] == {"task.priority": "high"}
    assert body["custom_field_values"] == {"called": True, "note": "קומה שלישית"}

    listed = {t["id"]: t for t in client.get("/api/tasks/list", headers=admin_headers).json()["items"]}
    assert listed[tid]["picklist_values"] == {"task.priority": "high"}
    assert listed[tid]["custom_field_values"]["called"] is True
    assert listed[setup["task_ids"][1]]["picklist_values"] == {}

    printed = client.get(f"/api/tasks/{tid}/print-data", headers=admin_headers).json()
    assert printed["task"]["custom_field_values"]["note"] == "קומה שלישית"

    # Clearing a value removes it.
    r = client.put(
        f"/api/tasks/{tid}", json={"picklist_values": {"task.priority": None}}, headers=admin_headers
    )
    assert r.json()["picklist_values"] == {}


def test_list_filters(client, admin_headers, setup):
    a, b = setup["task_ids"]
    client.put(
        f"/api/tasks/{a}",
        json={"picklist_values": {"task.priority": "high"},
              "custom_field_values": {"called": True, "note": "ליד המעלית"}},
        headers=admin_headers,
    )
    assert _list_ids(client, admin_headers, "picklist", "task.priority:high") == {a}
    assert _list_ids(client, admin_headers, "picklist", "task.priority:low") == set()
    assert _list_ids(client, admin_headers, "picklist", f"task.priority:{EMPTY}") == {b}
    assert _list_ids(client, admin_headers, "custom_field_filter", "called:true") == {a}
    assert _list_ids(client, admin_headers, "custom_field_filter", "note:מעלית") == {a}
    assert _list_ids(client, admin_headers, "custom_field_filter", f"note:{EMPTY}") == {b}
    # An unknown field is ignored, not an error.
    assert _list_ids(client, admin_headers, "custom_field_filter", "nope:x") == {a, b}


def test_only_task_picklists_can_be_set(client, admin_headers, setup):
    tid = setup["task_ids"][0]
    r = client.put(
        f"/api/tasks/{tid}", json={"picklist_values": {"apartment.language": "he"}}, headers=admin_headers
    )
    assert r.status_code == 400
    r = client.put(
        f"/api/tasks/{tid}", json={"picklist_values": {"task.custom_date": "x"}}, headers=admin_headers
    )
    assert r.status_code == 400


def test_delete_cleans_up_values(client, admin_headers, setup, db_session):
    tid = setup["task_ids"][0]
    client.put(
        f"/api/tasks/{tid}",
        json={"picklist_values": {"task.priority": "low"}, "custom_field_values": {"note": "x"}},
        headers=admin_headers,
    )
    assert client.delete(f"/api/tasks/{tid}", headers=admin_headers).status_code == 204
    assert db_session.query(models.PicklistLink).filter_by(entity_table="tasks", entity_id=tid).count() == 0
    assert db_session.query(models.CustomFieldValue).filter_by(entity_table="tasks", entity_id=tid).count() == 0
