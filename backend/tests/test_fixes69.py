"""fixes69 Admin§3a: the printable task sheet's data columns (resident name,
Jewish status, mezuzah, language, notes) carry whatever's already on file
instead of printing blank boxes."""
import pytest

from app import models


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


@pytest.fixture
def org_id(client, admin_headers):
    return _me(client, admin_headers)["organization_id"]


@pytest.fixture
def task_setup(client, admin_headers, org_id, db_session):
    """An active campaign + a report number covering one already-filled-in
    apartment."""
    area = models.Area(organization_id=org_id, area_name="א69")
    db_session.add(area)
    db_session.flush()
    building = models.Building(organization_id=org_id, area_id=area.id, building_address="69 Main St")
    rn = models.ReportNumber(organization_id=org_id, name="RN69")
    db_session.add_all([building, rn])
    db_session.flush()
    apt = models.Apartment(
        organization_id=org_id, building_id=building.id, report_number_id=rn.id, floor="2",
        apartment_name="5", name="ישראל ישראלי", apartment_notes="לא לדפוק לפני 10",
    )
    db_session.add(apt)
    db_session.commit()
    client.put(
        f"/api/apartments/{apt.id}",
        json={"jewish_status": "jewish", "mezuzah_status": "checked", "language": ["hebrew", "russian"]},
        headers=admin_headers,
    )
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין 69", "is_active": True}, headers=admin_headers
    ).json()
    return {"campaign_id": campaign["id"], "rn_id": rn.id, "apt_id": apt.id}


def _orphan_task(client, admin_headers, task_setup):
    r = client.post(
        "/api/tasks",
        json={"campaign_id": task_setup["campaign_id"], "report_number_ids": [task_setup["rn_id"]]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_print_data_carries_existing_apartment_fields(client, admin_headers, task_setup):
    task = _orphan_task(client, admin_headers, task_setup)
    printed = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()
    assert len(printed["apartments"]) == 1
    apt = printed["apartments"][0]
    assert apt["name"] == "ישראל ישראלי"
    assert apt["jewish_status"] == "jewish"
    assert apt["mezuzah_status"] == "checked"
    assert sorted(apt["language"]) == ["hebrew", "russian"]
    assert apt["apartment_notes"] == "לא לדפוק לפני 10"


def test_print_data_apartment_with_no_data_is_all_blank(client, admin_headers, task_setup, org_id, db_session):
    building = models.Building(organization_id=org_id, area_id=None, building_address="69 Empty St")
    empty_rn = models.ReportNumber(organization_id=org_id, name="RN69-empty")
    db_session.add_all([building, empty_rn])
    db_session.flush()
    apt = models.Apartment(
        organization_id=org_id, building_id=building.id, report_number_id=empty_rn.id, floor="1",
    )
    db_session.add(apt)
    db_session.commit()
    task = client.post(
        "/api/tasks",
        json={"campaign_id": task_setup["campaign_id"], "report_number_ids": [empty_rn.id]},
        headers=admin_headers,
    ).json()
    printed = client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()
    apt_out = printed["apartments"][0]
    assert apt_out["jewish_status"] is None
    assert apt_out["mezuzah_status"] is None
    assert apt_out["language"] == []
    assert apt_out["apartment_notes"] is None
