"""fixes96: GET /api/tasks/map — the activist's buildings (+ task numbers) and
one task's buildings for the admin, with the polygons of their areas."""
import pytest

from app import models
from app.core.security import hash_password


@pytest.fixture
def org_id(client, admin_headers):
    return client.get("/api/auth/me", headers=admin_headers).json()["organization_id"]

POLY = '{"type":"Polygon","coordinates":[[[34.0,32.0],[34.1,32.0],[34.1,32.1],[34.0,32.0]]]}'


def _bearer(client, username):
    tok = client.post("/api/auth/token", data={"username": username, "password": "Passw0rd!"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _setup(db, org_id):
    area = models.Area(organization_id=org_id, area_name="אזור 96", area_polygon=POLY)
    other_area = models.Area(organization_id=org_id, area_name="לא קשור", area_polygon=POLY)
    db.add_all([area, other_area])
    db.flush()
    b1 = models.Building(organization_id=org_id, area_id=area.id, building_address="1 Map St", latitude=32.05, longitude=34.05)
    b2 = models.Building(organization_id=org_id, area_id=area.id, building_address="2 Map St", latitude=32.06, longitude=34.06)
    b_other = models.Building(organization_id=org_id, area_id=other_area.id, building_address="9 Far St", latitude=31.0, longitude=35.0)
    rn1 = models.ReportNumber(organization_id=org_id, name="RN96-1")
    rn2 = models.ReportNumber(organization_id=org_id, name="RN96-2")
    rn3 = models.ReportNumber(organization_id=org_id, name="RN96-other")
    db.add_all([b1, b2, b_other, rn1, rn2, rn3])
    db.flush()
    for b, rn in ((b1, rn1), (b1, rn2), (b2, rn2), (b_other, rn3)):
        db.add(models.Apartment(organization_id=org_id, building_id=b.id, report_number_id=rn.id, apartment_name="1"))
    user = models.User(
        organization_id=org_id, username="map96", full_name="map96", email="map96@example.com",
        password_hash=hash_password("Passw0rd!"), role="shliach", is_active=True, email_verified=True,
    )
    other = models.User(
        organization_id=org_id, username="other96", full_name="other96", email="other96@example.com",
        password_hash=hash_password("Passw0rd!"), role="shliach", is_active=True, email_verified=True,
    )
    camp = models.Campaign(organization_id=org_id, name="קמפיין 96", is_active=True)
    db.add_all([user, other, camp])
    db.flush()
    t1 = models.Task(organization_id=org_id, campaign_id=camp.id, volunteer_user_id=user.id, status="ACTIVE")
    t2 = models.Task(organization_id=org_id, campaign_id=camp.id, volunteer_user_id=user.id, status="ACTIVE")
    t3 = models.Task(organization_id=org_id, campaign_id=camp.id, volunteer_user_id=other.id, status="ACTIVE")
    db.add_all([t1, t2, t3])
    db.flush()
    for t, rn in ((t1, rn1), (t2, rn2), (t3, rn3)):
        db.add(models.TaskReportNumber(organization_id=org_id, task_id=t.id, report_number_id=rn.id))
    db.commit()
    return {"b1": b1.id, "b2": b2.id, "b_other": b_other.id, "t1": t1.id, "t2": t2.id, "t3": t3.id, "area": area.id}


def test_activist_map_shows_their_buildings_with_task_numbers(client, db_session, org_id):
    ids = _setup(db_session, org_id)
    d = client.get("/api/tasks/map", headers=_bearer(client, "map96")).json()
    assert d["task_count"] == 2
    by_id = {b["id"]: b for b in d["buildings"]}
    assert set(by_id) == {ids["b1"], ids["b2"]}  # never another activist's building
    assert by_id[ids["b1"]]["task_ids"] == sorted([ids["t1"], ids["t2"]])
    assert by_id[ids["b2"]]["task_ids"] == [ids["t2"]]
    assert by_id[ids["b1"]]["apartment_count"] == 2
    assert by_id[ids["b1"]]["latitude"] == 32.05
    # Only the polygons of the buildings' own areas.
    assert [a["id"] for a in d["areas"]] == [ids["area"]]


def test_admin_task_map_and_access(client, db_session, org_id, admin_headers):
    ids = _setup(db_session, org_id)
    d = client.get(f"/api/tasks/map?task_id={ids['t2']}", headers=admin_headers).json()
    assert d["task_count"] == 1
    assert {b["id"] for b in d["buildings"]} == {ids["b1"], ids["b2"]}
    # An activist can't open someone else's task map.
    r = client.get(f"/api/tasks/map?task_id={ids['t3']}", headers=_bearer(client, "map96"))
    assert r.status_code == 403
    assert client.get("/api/tasks/map?task_id=999999", headers=admin_headers).status_code == 404
    # An admin without a task gets an empty map (no org-wide dump).
    assert client.get("/api/tasks/map", headers=admin_headers).json()["buildings"] == []
