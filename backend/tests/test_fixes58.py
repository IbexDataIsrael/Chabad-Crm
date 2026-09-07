"""fixes58 acceptance tests: Campaign/Task CRUD, the Task/Campaign-gated
apartment-access logic that replaces direct report-number assignment, and
the Campaign Manager role's permission boundaries (docs/plan58-plan.md)."""
import pytest

from app import models
from app.core.security import hash_password
from app.routers.apartments import _shliach_apartment_ids


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


@pytest.fixture
def campaign_manager_headers(client, db_session, admin_headers):
    """A campaign_manager login inside the admin's own org."""
    org_id = _me(client, admin_headers)["organization_id"]
    user = models.User(
        organization_id=org_id,
        username="cm58",
        full_name="מנהל קמפיינים",
        email="cm58@example.com",
        password_hash=hash_password("pw12345"),
        role="campaign_manager",
        is_active=True,
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "cm58", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _mk_shliach_user(db_session, org_id, username="shliach58"):
    user = models.User(
        organization_id=org_id,
        username=username,
        full_name="פעיל58",
        email=f"{username}@example.com",
        password_hash=hash_password("pw12345"),
        role="shliach",
        is_active=True,
        email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _mk_apartment_with_report_number(db_session, org_id):
    area = models.Area(organization_id=org_id, area_name="א58")
    db_session.add(area)
    db_session.flush()
    building = models.Building(
        organization_id=org_id, area_id=area.id, building_address="1 Fixes58 St"
    )
    db_session.add(building)
    rn = models.ReportNumber(organization_id=org_id, name="RN58")
    db_session.add(rn)
    db_session.flush()
    apartment = models.Apartment(
        organization_id=org_id, building_id=building.id, report_number_id=rn.id
    )
    db_session.add(apartment)
    db_session.commit()
    db_session.refresh(apartment)
    db_session.refresh(rn)
    return apartment, rn


# --- Campaign CRUD -----------------------------------------------------------
def test_campaign_crud_admin_only(client, admin_headers, auth_headers):
    r = client.post(
        "/api/campaigns", json={"name": "קמפיין א", "is_active": True}, headers=admin_headers
    )
    assert r.status_code == 201, r.text
    campaign = r.json()
    assert campaign["is_active"] is True

    # staff (a different org, per auth_headers/admin_headers each registering
    # their own org) — same-org staff would also be blocked; either way this
    # asserts the role gate, not org isolation.
    r = client.get("/api/campaigns", headers=auth_headers)
    assert r.status_code == 403

    r = client.get("/api/campaigns", headers=admin_headers)
    assert r.status_code == 200
    assert any(c["id"] == campaign["id"] for c in r.json())

    r = client.put(
        f"/api/campaigns/{campaign['id']}", json={"is_active": False}, headers=admin_headers
    )
    assert r.status_code == 200
    assert r.json()["is_active"] is False

    r = client.delete(f"/api/campaigns/{campaign['id']}", headers=admin_headers)
    assert r.status_code == 204
    r = client.get("/api/campaigns", headers=admin_headers)
    assert all(c["id"] != campaign["id"] for c in r.json())


def test_campaign_manager_can_manage_campaigns_and_tasks(
    client, admin_headers, campaign_manager_headers, db_session
):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id, "shliach58b")
    _, rn = _mk_apartment_with_report_number(db_session, org_id)

    r = client.post(
        "/api/campaigns",
        json={"name": "קמפיין מנהל", "is_active": True},
        headers=campaign_manager_headers,
    )
    assert r.status_code == 201, r.text
    campaign_id = r.json()["id"]

    r = client.post(
        "/api/tasks",
        json={
            "campaign_id": campaign_id,
            "volunteer_user_id": volunteer.id,
            "report_number_ids": [rn.id],
        },
        headers=campaign_manager_headers,
    )
    assert r.status_code == 201, r.text
    task = r.json()
    assert task["status"] == "ACTIVE"
    assert task["report_number_ids"] == [rn.id]
    assert task["campaign_name"] == "קמפיין מנהל"
    assert task["volunteer_name"] == "פעיל58"


# --- Task list/filter/update --------------------------------------------------
def test_task_list_filters_and_update(client, admin_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id)
    _, rn = _mk_apartment_with_report_number(db_session, org_id)
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין ב", "is_active": True}, headers=admin_headers
    ).json()
    task = client.post(
        "/api/tasks",
        json={
            "campaign_id": campaign["id"],
            "volunteer_user_id": volunteer.id,
            "report_number_ids": [rn.id],
        },
        headers=admin_headers,
    ).json()

    r = client.get("/api/tasks/list", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["total"] >= 1

    r = client.get(
        f"/api/tasks/list?status=PAUSED&campaign_id={campaign['id']}", headers=admin_headers
    )
    assert all(t["id"] != task["id"] for t in r.json()["items"])

    r = client.put(f"/api/tasks/{task['id']}", json={"status": "PAUSED"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "PAUSED"

    r = client.delete(f"/api/tasks/{task['id']}", headers=admin_headers)
    assert r.status_code == 204


# --- Access logic: the actual point of the whole refactor --------------------
def test_shliach_apartment_access_gated_by_active_task_and_campaign(client, admin_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id, "shliach58c")
    apartment, rn = _mk_apartment_with_report_number(db_session, org_id)

    campaign = models.Campaign(organization_id=org_id, name="Legacy", is_active=True)
    db_session.add(campaign)
    db_session.flush()
    task = models.Task(
        organization_id=org_id,
        campaign_id=campaign.id,
        volunteer_user_id=volunteer.id,
        status="ACTIVE",
    )
    db_session.add(task)
    db_session.flush()
    db_session.add(
        models.TaskReportNumber(
            organization_id=org_id, task_id=task.id, report_number_id=rn.id
        )
    )
    db_session.commit()

    assert apartment.id in _shliach_apartment_ids(db_session, volunteer)

    task.status = "PAUSED"
    db_session.commit()
    assert apartment.id not in _shliach_apartment_ids(db_session, volunteer)

    task.status = "ACTIVE"
    campaign.is_active = False
    db_session.commit()
    assert apartment.id not in _shliach_apartment_ids(db_session, volunteer)

    campaign.is_active = True
    task.status = "COMPLETED"
    db_session.commit()
    assert apartment.id not in _shliach_apartment_ids(db_session, volunteer)


# --- Campaign Manager permission boundaries -----------------------------------
def test_campaign_manager_forbidden_from_contacts_visits_and_settings(
    client, admin_headers, campaign_manager_headers
):
    assert client.get("/api/contacts", headers=campaign_manager_headers).status_code == 403
    assert (
        client.post("/api/contacts", json={"name": "x"}, headers=campaign_manager_headers).status_code
        == 403
    )
    mekurav = client.post("/api/contacts", json={"name": "מ", "phone": "050-1112223"}, headers=admin_headers).json()
    assert (
        client.get(f"/api/contacts/{mekurav['id']}/visits", headers=campaign_manager_headers).status_code
        == 403
    )
    # Global system settings: forbidden; the one carve-out (shliach_view_config) is not.
    r = client.put(
        "/api/organizations/me", json={"name": "New Name"}, headers=campaign_manager_headers
    )
    assert r.status_code == 403
    r = client.put(
        "/api/organizations/me",
        json={"shliach_view_config": {"disable_edit": False}},
        headers=campaign_manager_headers,
    )
    assert r.status_code == 200


def test_campaign_manager_allowed_apartments_users_shliach_config(
    client, admin_headers, campaign_manager_headers, db_session
):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id, "shliach58d")

    assert client.get("/api/apartments/list", headers=campaign_manager_headers).status_code == 200
    assert client.get("/api/users", headers=campaign_manager_headers).status_code == 200

    # Read/write a shliach-role user: allowed.
    r = client.put(
        f"/api/users/{volunteer.id}",
        json={"full_name": "פעיל עודכן"},
        headers=campaign_manager_headers,
    )
    assert r.status_code == 200, r.text

    # No role elevation, even on a shliach row: role is silently untouchable
    # here (same guard admins get — a shliach's role is managed elsewhere),
    # so this must NOT come back as "admin".
    r = client.put(
        f"/api/users/{volunteer.id}", json={"role": "admin"}, headers=campaign_manager_headers
    )
    assert r.status_code == 200
    assert r.json()["role"] == "shliach"

    # A non-shliach target row (the admin) stays out of reach.
    admin_user_id = _me(client, admin_headers)["id"]
    r = client.put(
        f"/api/users/{admin_user_id}",
        json={"full_name": "hacked"},
        headers=campaign_manager_headers,
    )
    assert r.status_code == 403

    r = client.delete(f"/api/users/{admin_user_id}", headers=campaign_manager_headers)
    assert r.status_code == 403

    r = client.delete(f"/api/users/{volunteer.id}", headers=campaign_manager_headers)
    assert r.status_code == 204
