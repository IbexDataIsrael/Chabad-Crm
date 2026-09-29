"""fixes74: task statuses (available/taken), manual-assignment marker, the
copyable claim link, bulk task creation, task-linked activist reports and
the admin's read-only view of an activist's street2 progress."""
import pytest

from app import models
from app.core.security import hash_password


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


@pytest.fixture
def org_id(client, admin_headers):
    return _me(client, admin_headers)["organization_id"]


@pytest.fixture
def setup(client, admin_headers, org_id, db_session):
    """An active campaign, report numbers "1".."5" (each with one
    apartment) and a report number "X" with none."""
    area = models.Area(organization_id=org_id, area_name="א74")
    db_session.add(area)
    db_session.flush()
    building = models.Building(organization_id=org_id, area_id=area.id, building_address="74 Main St")
    db_session.add(building)
    db_session.flush()
    rns = {}
    for name in ["1", "2", "3", "4", "5", "X"]:
        rn = models.ReportNumber(organization_id=org_id, name=name)
        db_session.add(rn)
        db_session.flush()
        rns[name] = rn.id
        if name != "X":
            db_session.add(
                models.Apartment(
                    organization_id=org_id, building_id=building.id, report_number_id=rn.id,
                    floor="1", apartment_name=name,
                )
            )
    db_session.commit()
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין 74", "is_active": True}, headers=admin_headers
    ).json()
    return {"campaign_id": campaign["id"], "rns": rns, "building_id": building.id}


def _mk_shliach(db_session, org_id, username):
    user = models.User(
        organization_id=org_id, username=username, full_name=username,
        email=f"{username}@example.com", password_hash=hash_password("Passw0rd!"),
        role="shliach", is_active=True, email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _login(client, username):
    token = client.post(
        "/api/auth/token", data={"username": username, "password": "Passw0rd!"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _task(client, admin_headers, setup, names=("1",), **extra):
    r = client.post(
        "/api/tasks",
        json={
            "campaign_id": setup["campaign_id"],
            "report_number_ids": [setup["rns"][n] for n in names],
            **extra,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


# --- §2/§5: available / taken ------------------------------------------------


def test_unassigned_task_is_available(client, admin_headers, setup):
    task = _task(client, admin_headers, setup)  # default status ACTIVE is coerced
    assert task["status"] == "AVAILABLE"
    assert task["is_orphan"] is True
    assert task["claim_token"]


def test_qr_claim_makes_task_taken(client, admin_headers, setup, db_session, org_id):
    task = _task(client, admin_headers, setup)
    _mk_shliach(db_session, org_id, "act74a")
    r = client.post(f"/api/tasks/claim/{task['claim_token']}", headers=_login(client, "act74a"))
    assert r.json()["state"] == "claimed"
    got = client.get(f"/api/tasks/{task['id']}", headers=admin_headers).json()
    assert got["status"] == "ACTIVE"
    assert got["claimed_via"] == "qr"
    assert got["assigned_at"]
    # The QR link stays on (it's the activist's sign-in door).
    assert got["claim_token"] == task["claim_token"]


def test_unassign_returns_to_available(client, admin_headers, setup, db_session, org_id):
    user = _mk_shliach(db_session, org_id, "act74b")
    task = _task(client, admin_headers, setup, volunteer_user_id=user.id)
    assert task["status"] == "ACTIVE"
    r = client.post(f"/api/tasks/{task['id']}/unassign", headers=admin_headers)
    body = r.json()
    assert body["status"] == "AVAILABLE"
    assert body["claim_token"]  # link back on
    assert body["assigned_at"] is None


def test_available_and_taken_follow_the_assignment(client, admin_headers, setup, db_session, org_id):
    orphan = _task(client, admin_headers, setup)
    r = client.put(f"/api/tasks/{orphan['id']}", json={"status": "ACTIVE"}, headers=admin_headers)
    assert r.status_code == 400
    user = _mk_shliach(db_session, org_id, "act74c")
    taken = _task(client, admin_headers, setup, names=("2",), volunteer_user_id=user.id)
    r = client.put(f"/api/tasks/{taken['id']}", json={"status": "AVAILABLE"}, headers=admin_headers)
    assert r.status_code == 400
    # Paused / completed stay free choices.
    r = client.put(f"/api/tasks/{orphan['id']}", json={"status": "PAUSED"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "PAUSED"


# --- §4 + §1: manual assignment disables the link ---------------------------


def test_manual_assignment_marks_and_disables_link(client, admin_headers, setup, db_session, org_id):
    task = _task(client, admin_headers, setup)
    token = task["claim_token"]
    user = _mk_shliach(db_session, org_id, "act74d")
    r = client.put(
        f"/api/tasks/{task['id']}", json={"volunteer_user_id": user.id}, headers=admin_headers
    )
    body = r.json()
    assert body["status"] == "ACTIVE"
    assert body["claimed_via"] == "manual"
    assert body["claim_token"] is None
    # The old link (printed or copied) is dead now.
    assert client.get(f"/api/public/claim/{token}").json()["state"] == "invalid"
    other = _mk_shliach(db_session, org_id, "act74e")
    r = client.post(f"/api/tasks/claim/{token}", headers=_login(client, "act74e"))
    assert r.json()["state"] == "invalid"
    # No QR on its printed sheet either.
    assert client.get(f"/api/tasks/{task['id']}/print-data", headers=admin_headers).json()[
        "claim_token"
    ] is None
    # Returning it to the pool switches the same link back on.
    client.post(f"/api/tasks/{task['id']}/unassign", headers=admin_headers)
    assert client.get(f"/api/public/claim/{token}").json()["state"] == "available"
    assert other.id


def test_manual_assignment_forces_taken_even_when_paused(client, admin_headers, setup, db_session, org_id):
    task = _task(client, admin_headers, setup, status="PAUSED")
    user = _mk_shliach(db_session, org_id, "act74f")
    body = client.put(
        f"/api/tasks/{task['id']}", json={"volunteer_user_id": user.id}, headers=admin_headers
    ).json()
    assert body["status"] == "ACTIVE"
