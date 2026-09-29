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


# --- §3: one task per report number -----------------------------------------


def test_bulk_preview_range_skips_missing_and_flags_conflicts(client, admin_headers, setup):
    existing = _task(client, admin_headers, setup, names=("3",))
    r = client.post(
        "/api/tasks/bulk/preview",
        json={"campaign_id": setup["campaign_id"], "range_text": "1-5, 9"},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [n["name"] for n in body["eligible"]] == ["1", "2", "4", "5"]
    assert [(n["name"], n["task_ids"]) for n in body["conflicts"]] == [("3", [existing["id"]])]
    assert body["missing"] == ["9"]


def test_bulk_preview_rejects_garbage(client, admin_headers, setup):
    r = client.post(
        "/api/tasks/bulk/preview",
        json={"campaign_id": setup["campaign_id"], "range_text": "10-abc"},
        headers=admin_headers,
    )
    assert r.status_code == 422


def test_bulk_create_refuses_on_conflict_unless_skipping(client, admin_headers, setup):
    _task(client, admin_headers, setup, names=("3",))
    ids = [setup["rns"][n] for n in ("1", "2", "3")]
    payload = {"campaign_id": setup["campaign_id"], "report_number_ids": ids}
    before = client.get("/api/tasks/list", headers=admin_headers).json()["total"]
    r = client.post("/api/tasks/bulk", json=payload, headers=admin_headers)
    assert r.status_code == 409
    assert client.get("/api/tasks/list", headers=admin_headers).json()["total"] == before

    r = client.post("/api/tasks/bulk", json={**payload, "skip_conflicts": True}, headers=admin_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["created_task_ids"]) == 2
    assert [n["name"] for n in body["skipped"]] == ["3"]
    tasks = client.get("/api/tasks/list", headers=admin_headers).json()["items"]
    created = [t for t in tasks if t["id"] in body["created_task_ids"]]
    # One separate task per number, each unassigned = available.
    assert sorted(t["report_number_names"][0] for t in created) == ["1", "2"]
    assert all(len(t["report_number_names"]) == 1 for t in created)
    assert all(t["status"] == "AVAILABLE" for t in created)


def test_bulk_create_with_activist_is_manual(client, admin_headers, setup, db_session, org_id):
    user = _mk_shliach(db_session, org_id, "act74bulk")
    r = client.post(
        "/api/tasks/bulk",
        json={
            "campaign_id": setup["campaign_id"],
            "report_number_ids": [setup["rns"]["4"], setup["rns"]["5"]],
            "volunteer_user_id": user.id,
        },
        headers=admin_headers,
    )
    assert r.status_code == 201
    for tid in r.json()["created_task_ids"]:
        t = client.get(f"/api/tasks/{tid}", headers=admin_headers).json()
        assert t["status"] == "ACTIVE" and t["claimed_via"] == "manual"


def test_conflicts_are_per_campaign(client, admin_headers, setup):
    _task(client, admin_headers, setup, names=("1",))
    other = client.post(
        "/api/campaigns", json={"name": "אחר", "is_active": False}, headers=admin_headers
    ).json()
    body = client.post(
        "/api/tasks/bulk/preview",
        json={"campaign_id": other["id"], "report_number_ids": [setup["rns"]["1"]]},
        headers=admin_headers,
    ).json()
    assert [n["name"] for n in body["eligible"]] == ["1"]
    assert body["conflicts"] == []


# --- §11: reports linked to tasks -------------------------------------------


def _activist_with_contact(db_session, org_id, username):
    user = _mk_shliach(db_session, org_id, username)
    contact = models.Contact(organization_id=org_id, name=username, contact_type="shliach")
    db_session.add(contact)
    db_session.flush()
    db_session.add(
        models.ContactShliach(
            organization_id=org_id, contact_id=contact.id, user_id=user.id, is_display=True
        )
    )
    db_session.commit()
    return user


def _report(client, headers, status, task_id=None, comments=None):
    return client.post(
        "/api/shliach-messages/report-completions",
        json={"status": status, "comments": comments, "task_id": task_id},
        headers=headers,
    )


def test_each_task_shows_its_own_report(client, admin_headers, setup, db_session, org_id):
    user = _activist_with_contact(db_session, org_id, "act74r")
    old_task = _task(client, admin_headers, setup, names=("1",), volunteer_user_id=user.id)
    new_task = _task(client, admin_headers, setup, names=("2",), volunteer_user_id=user.id)
    h = _login(client, "act74r")

    mine = client.get("/api/shliach-messages/my-tasks", headers=h).json()
    assert {t["id"] for t in mine} == {old_task["id"], new_task["id"]}

    assert _report(client, h, "partial", old_task["id"], "ישן").status_code == 201
    assert _report(client, h, "completed", new_task["id"], "חדש").status_code == 201
    # An unlinked report (no task) is attributed to nothing.
    assert _report(client, h, "not_completed").status_code == 201

    got_old = client.get(f"/api/tasks/{old_task['id']}", headers=admin_headers).json()
    got_new = client.get(f"/api/tasks/{new_task['id']}", headers=admin_headers).json()
    assert (got_old["latest_report_status"], got_old["latest_report_notes"]) == ("partial", "ישן")
    assert (got_new["latest_report_status"], got_new["latest_report_notes"]) == ("completed", "חדש")
    log = client.get("/api/shliach-messages/report-completions", headers=admin_headers).json()
    assert sorted(r["task_id"] or 0 for r in log)[-2:] == sorted([old_task["id"], new_task["id"]])


def test_report_before_reassignment_does_not_count(client, admin_headers, setup, db_session, org_id):
    import datetime

    first = _activist_with_contact(db_session, org_id, "act74s")
    task = _task(client, admin_headers, setup, names=("3",), volunteer_user_id=first.id)
    _report(client, _login(client, "act74s"), "partial", task["id"])
    second = _mk_shliach(db_session, org_id, "act74t")
    client.put(f"/api/tasks/{task['id']}", json={"volunteer_user_id": second.id}, headers=admin_headers)
    # Make the reassignment unambiguously later than the first report.
    row = db_session.get(models.Task, task["id"])
    db_session.refresh(row)
    row.assigned_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=5)
    db_session.commit()
    got = client.get(f"/api/tasks/{task['id']}", headers=admin_headers).json()
    assert got["latest_report_status"] is None


def test_cannot_link_someone_elses_task(client, admin_headers, setup, db_session, org_id):
    _activist_with_contact(db_session, org_id, "act74u")
    other = _mk_shliach(db_session, org_id, "act74v")
    task = _task(client, admin_headers, setup, names=("4",), volunteer_user_id=other.id)
    r = _report(client, _login(client, "act74u"), "completed", task["id"])
    assert r.status_code == 400


# --- §12: admin sees the activist's street2 view -----------------------------


def test_street_activity_sync_and_admin_view(client, admin_headers, setup, db_session, org_id):
    user = _mk_shliach(db_session, org_id, "act74w")
    _task(client, admin_headers, setup, names=("1", "2"), volunteer_user_id=user.id)
    h = _login(client, "act74w")

    # Before any sync: no log, no sync time.
    view = client.get(f"/api/street-activity/{user.id}", headers=admin_headers).json()
    assert view["last_sync_at"] is None and view["events"] == []

    import datetime

    tz = datetime.timezone(datetime.timedelta(hours=3))
    t1 = (datetime.datetime.now(tz) - datetime.timedelta(hours=1)).replace(microsecond=0)
    t2 = t1 + datetime.timedelta(minutes=5)
    events = [
        {"client_id": "11111111-aaaa", "event_type": "mark", "apartment_id": 5,
         "building_id": setup["building_id"], "label": "74 Main St · 1",
         "occurred_at": t1.isoformat()},
        {"client_id": "22222222-bbbb", "event_type": "building_complete",
         "building_id": setup["building_id"], "occurred_at": t2.isoformat()},
    ]
    assert client.post("/api/street-activity/sync", json={"events": events}, headers=h).status_code == 204
    # A retried upload doesn't duplicate.
    client.post("/api/street-activity/sync", json={"events": events}, headers=h)

    view = client.get(f"/api/street-activity/{user.id}", headers=admin_headers).json()
    assert view["last_sync_at"] is not None
    assert [e["event_type"] for e in view["events"]] == ["building_complete", "mark"]
    utc = t1.astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat()
    assert view["events"][1]["occurred_at"].startswith(utc)  # stored as UTC
    assert view["events"][0]["building_label"] == "74 Main St"

    # An empty upload is a heartbeat: sync time moves, no new events.
    client.post("/api/street-activity/sync", json={"events": []}, headers=h)
    again = client.get(f"/api/street-activity/{user.id}", headers=admin_headers).json()
    assert again["last_sync_at"] >= view["last_sync_at"] and len(again["events"]) == 2


def test_street_activity_permissions(client, admin_headers, setup, db_session, org_id):
    user = _mk_shliach(db_session, org_id, "act74x")
    _mk_shliach(db_session, org_id, "act74y")
    # An admin can't write into a log; an activist can't read one.
    assert client.post("/api/street-activity/sync", json={"events": []}, headers=admin_headers).status_code == 403
    assert client.get(f"/api/street-activity/{user.id}", headers=_login(client, "act74y")).status_code == 403
    # Only activists can be viewed.
    admin_id = _me(client, admin_headers)["id"]
    assert client.get(f"/api/street-activity/{admin_id}", headers=admin_headers).status_code == 404


def test_admin_lists_apartments_as_activist(client, admin_headers, setup, db_session, org_id):
    user = _mk_shliach(db_session, org_id, "act74z")
    _task(client, admin_headers, setup, names=("1", "2"), volunteer_user_id=user.id)
    mine = client.get(
        f"/api/apartments/list?as_user_id={user.id}&page_size=100", headers=admin_headers
    ).json()
    assert sorted(a["apartment_name"] for a in mine["items"]) == ["1", "2"]
    # The activist sees the same set on their own.
    theirs = client.get("/api/apartments/list?page_size=100", headers=_login(client, "act74z")).json()
    assert sorted(a["apartment_name"] for a in theirs["items"]) == ["1", "2"]
    # An activist can't use as_user_id to look at someone else's set.
    other = _mk_shliach(db_session, org_id, "act74zz")
    peek = client.get(
        f"/api/apartments/list?as_user_id={user.id}&page_size=100", headers=_login(client, "act74zz")
    ).json()
    assert peek["total"] == 0 and other.id
