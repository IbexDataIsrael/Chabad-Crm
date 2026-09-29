"""fixes60 acceptance tests: the Tasks-page report-status resolution
(decision #2), task_id added to the Report Numbers campaign-status endpoint
(decision #3), and the area convex-hull polygon-generation endpoints
(decision #4)."""
import pytest

from app import models
from app.core.security import hash_password


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _mk_shliach_user(db_session, org_id, username="shliach60"):
    user = models.User(
        organization_id=org_id,
        username=username,
        full_name="פעיל60",
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
    area = models.Area(organization_id=org_id, area_name="א60")
    db_session.add(area)
    db_session.flush()
    building = models.Building(
        organization_id=org_id, area_id=area.id, building_address="1 Fixes60 St"
    )
    db_session.add(building)
    rn = models.ReportNumber(organization_id=org_id, name="RN60")
    db_session.add(rn)
    db_session.flush()
    apartment = models.Apartment(
        organization_id=org_id, building_id=building.id, report_number_id=rn.id
    )
    db_session.add(apartment)
    db_session.commit()
    db_session.refresh(rn)
    return rn


# --- Task 1: worker report resolution ---------------------------------------
def test_task_out_has_no_report_when_volunteer_never_submitted(
    client, admin_headers, db_session
):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id)
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין60א", "is_active": True}, headers=admin_headers
    ).json()
    task = client.post(
        "/api/tasks",
        json={"campaign_id": campaign["id"], "volunteer_user_id": volunteer.id},
        headers=admin_headers,
    ).json()
    assert task["latest_report_status"] is None
    assert task["latest_report_notes"] is None

    r = client.get("/api/tasks/list", headers=admin_headers)
    row = next(t for t in r.json()["items"] if t["id"] == task["id"])
    assert row["latest_report_status"] is None


def test_task_out_ignores_unlinked_reports(
    client, admin_headers, db_session
):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id, "shliach60b")

    contact = models.Contact(organization_id=org_id, name="פעיל60ב", contact_type="shliach")
    db_session.add(contact)
    db_session.flush()
    shliach_row = models.ContactShliach(
        organization_id=org_id, contact_id=contact.id, user_id=volunteer.id, is_display=True
    )
    db_session.add(shliach_row)
    db_session.flush()

    import datetime

    older = models.ShliachReportCompletion(
        organization_id=org_id,
        contact_id=contact.id,
        status="partial",
        comments="ישן",
        created_at=datetime.datetime.utcnow() - datetime.timedelta(days=1),
    )
    newer = models.ShliachReportCompletion(
        organization_id=org_id,
        contact_id=contact.id,
        status="completed",
        comments="חדש",
        created_at=datetime.datetime.utcnow(),
    )
    db_session.add_all([older, newer])
    db_session.commit()

    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין60ב", "is_active": True}, headers=admin_headers
    ).json()
    task = client.post(
        "/api/tasks",
        json={"campaign_id": campaign["id"], "volunteer_user_id": volunteer.id},
        headers=admin_headers,
    ).json()
    # fixes74 §11 supersedes this: reports without a task link (every
    # report sent before the link existed) are never attributed to a task.
    assert task["latest_report_status"] is None

    r = client.get("/api/tasks/list", headers=admin_headers)
    row = next(t for t in r.json()["items"] if t["id"] == task["id"])
    assert row["latest_report_status"] is None


# --- Task 2: task_id in the campaign-task-status endpoint --------------------
def test_campaign_task_status_includes_task_id(client, admin_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    volunteer = _mk_shliach_user(db_session, org_id, "shliach60c")
    rn = _mk_apartment_with_report_number(db_session, org_id)
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין60ג", "is_active": True}, headers=admin_headers
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

    r = client.get("/api/report-numbers/campaign-task-status", headers=admin_headers)
    cell = r.json()[str(rn.id)][str(campaign["id"])]
    assert cell["status"] == "ACTIVE"
    assert cell["task_id"] == task["id"]

    # The inline toggle this powers: PUT against that exact task_id works.
    r2 = client.put(f"/api/tasks/{task['id']}", json={"status": "PAUSED"}, headers=admin_headers)
    assert r2.status_code == 200
    r3 = client.get("/api/report-numbers/campaign-task-status", headers=admin_headers)
    assert r3.json()[str(rn.id)][str(campaign["id"])]["status"] == "PAUSED"


# --- Task 5: area polygon generation -----------------------------------------
def test_generate_area_polygon_needs_at_least_3_geocoded_buildings(
    client, admin_headers, db_session
):
    org_id = _me(client, admin_headers)["organization_id"]
    area = client.post("/api/areas", json={"area_name": "אזור60 מעט"}, headers=admin_headers).json()
    b1 = client.post(
        "/api/buildings",
        json={"area_id": area["id"], "building_address": "1 Hull St"},
        headers=admin_headers,
    ).json()
    db_session.query(models.Building).filter(models.Building.id == b1["id"]).update(
        {"latitude": 40.60, "longitude": -73.95}
    )
    db_session.commit()

    r = client.post(f"/api/areas/{area['id']}/generate-polygon", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["building_count"] == 1
    assert "3" in body["skipped_reason"]

    r2 = client.get(f"/api/areas/{area['id']}", headers=admin_headers)
    assert r2.json()["area_polygon"] is None


def test_generate_area_polygon_from_geocoded_buildings(client, admin_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    area = client.post("/api/areas", json={"area_name": "אזור60 מלא"}, headers=admin_headers).json()
    coords = [(40.590, -73.960), (40.592, -73.958), (40.591, -73.955), (40.589, -73.957)]
    for i, (lat, lng) in enumerate(coords):
        b = client.post(
            "/api/buildings",
            json={"area_id": area["id"], "building_address": f"{i} Hull St"},
            headers=admin_headers,
        ).json()
        db_session.query(models.Building).filter(models.Building.id == b["id"]).update(
            {"latitude": lat, "longitude": lng}
        )
    db_session.commit()

    r = client.post(f"/api/areas/{area['id']}/generate-polygon", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["building_count"] == 4

    r2 = client.get(f"/api/areas/{area['id']}", headers=admin_headers)
    import json as jsonlib

    poly = jsonlib.loads(r2.json()["area_polygon"])
    assert poly["type"] == "Polygon"
    ring = poly["coordinates"][0]
    assert len(ring) >= 4  # at least a triangle, closed (first == last)
    assert ring[0] == ring[-1]
    # GeoJSON order is [lng, lat] — every point's longitude should be negative
    # (west of the prime meridian), matching the (lat, lng) fixture above.
    assert all(pt[0] < 0 < pt[1] for pt in ring)


def test_generate_all_area_polygons_reports_per_area(client, admin_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    empty_area = client.post(
        "/api/areas", json={"area_name": "אזור60 ריק"}, headers=admin_headers
    ).json()

    r = client.post("/api/areas/generate-polygons", headers=admin_headers)
    assert r.status_code == 200
    by_id = {row["area_id"]: row for row in r.json()}
    assert by_id[empty_area["id"]]["ok"] is False
    assert by_id[empty_area["id"]]["building_count"] == 0


def test_generate_polygon_forbidden_for_staff(client, admin_headers, auth_headers, db_session):
    org_id = _me(client, admin_headers)["organization_id"]
    area = client.post("/api/areas", json={"area_name": "אזור60 הרשאה"}, headers=admin_headers).json()
    # auth_headers is a different org's staff login (register() makes a new
    # org per call) — this asserts the require_admin role gate, not org
    # isolation, matching the convention test_fixes58.py already uses.
    r = client.post(f"/api/areas/{area['id']}/generate-polygon", headers=auth_headers)
    assert r.status_code in (403, 404)
