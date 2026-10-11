"""fixes98: activist emails (self-registration welcome, new-task email),
messages for activists + per-org stats, text tasks, password change without
the old password."""
import pytest

from app import models
from app.core.claim_token import make_claim_token
from app.core.security import hash_password


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sent(monkeypatch):
    out = []

    def fake_send(to, subject, body, html=None, from_name=None, reply_to=None):
        out.append({"to": to, "subject": subject, "text": body, "html": html or ""})

    monkeypatch.setattr("app.core.email.send_email", fake_send)
    return out


@pytest.fixture
def org_id(client, admin_headers):
    return _me(client, admin_headers)["organization_id"]


@pytest.fixture
def public_org(client, admin_headers, org_id):
    r = client.put(
        "/api/organizations/me",
        json={"slug": "sb", "self_registration_enabled": True},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def setup(client, admin_headers, org_id, db_session):
    """Campaign + report number RN covering 2 apartments ("2 Second St"
    sorts after "1 First St") and an activist with an email."""
    area = models.Area(organization_id=org_id, area_name="א98")
    db_session.add(area)
    db_session.flush()
    b1 = models.Building(organization_id=org_id, area_id=area.id, building_address="2 Second St")
    b2 = models.Building(organization_id=org_id, area_id=area.id, building_address="1 First St")
    rn = models.ReportNumber(organization_id=org_id, name="RN98")
    db_session.add_all([b1, b2, rn])
    db_session.flush()
    for b in (b1, b2):
        db_session.add(
            models.Apartment(
                organization_id=org_id, building_id=b.id, report_number_id=rn.id,
                floor="1", apartment_name="1",
            )
        )
    user = models.User(
        organization_id=org_id, username="act98", full_name="דנה כהן",
        email="act98@example.com", password_hash=hash_password("Passw0rd!"),
        role="shliach", is_active=True, email_verified=True,
    )
    db_session.add(user)
    db_session.commit()
    campaign = client.post(
        "/api/campaigns", json={"name": "קמפיין 98", "is_active": True}, headers=admin_headers
    ).json()
    return {"campaign_id": campaign["id"], "rn_id": rn.id, "user_id": user.id}


# --- emails -------------------------------------------------------------------
def test_org_page_registration_sends_welcome_with_org_link(client, public_org, sent):
    r = client.post(
        "/api/public/register",
        json={"full_name": "משה כהן", "email": "moshe@example.com", "password": "Passw0rd1",
              "org_slug": "sb"},
    )
    assert r.status_code == 201, r.text
    welcome = [m for m in sent if m["to"] == "moshe@example.com"]
    assert len(welcome) == 1
    assert "Welcome to Jewish Points" in welcome[0]["subject"]
    assert "/org/sb" in welcome[0]["html"]


def test_qr_registration_sends_welcome(client, admin_headers, public_org, setup, sent):
    task = client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "report_number_ids": [setup["rn_id"]]},
        headers=admin_headers,
    ).json()
    token = make_claim_token(task["guid"])
    r = client.post(
        "/api/public/register",
        json={"full_name": "רינה לוי", "email": "rina@example.com", "password": "Passw0rd1",
              "claim_token": token},
    )
    assert r.status_code == 201, r.text
    assert r.json()["claim_state"] == "claimed"
    assert [m["to"] for m in sent if m["to"] == "rina@example.com"] == ["rina@example.com"]


def test_assigning_a_task_emails_the_activist_with_first_address(
    client, admin_headers, public_org, setup, sent
):
    r = client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "report_number_ids": [setup["rn_id"]],
              "volunteer_user_id": setup["user_id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    mails = [m for m in sent if m["to"] == "act98@example.com"]
    assert len(mails) == 1
    html = mails[0]["html"]
    assert "שובצה לך משימה חדשה." in html and "A new task has been assigned to you." in html
    assert "1 First St" in html and "2 Second St" not in html  # the first address only
    assert "/org/sb" in html
    assert html.index("שובצה לך") < html.index("A new task has been")


def test_task_email_text_comes_from_shliach_config(client, admin_headers, setup, sent):
    client.put(
        "/api/organizations/me",
        json={"shliach_view_config": {"task_email_text_he": "יש לך משימה!",
                                      "task_email_text_en": "You have a task!"}},
        headers=admin_headers,
    )
    client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "task_text": "לחלק עלונים ברחוב הרצל",
              "volunteer_user_id": setup["user_id"]},
        headers=admin_headers,
    )
    html = [m for m in sent if m["to"] == "act98@example.com"][0]["html"]
    assert "יש לך משימה!" in html and "You have a task!" in html
    assert "לחלק עלונים ברחוב הרצל" in html  # a text task shows its text, no address


def test_reassign_emails_but_unrelated_edit_does_not(client, admin_headers, setup, sent):
    task = client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "report_number_ids": [setup["rn_id"]]},
        headers=admin_headers,
    ).json()
    assert not [m for m in sent if m["to"] == "act98@example.com"]  # no activist yet
    client.put(f"/api/tasks/{task['id']}", json={"volunteer_user_id": setup["user_id"]},
               headers=admin_headers)
    client.put(f"/api/tasks/{task['id']}", json={"status": "PAUSED"}, headers=admin_headers)
    assert len([m for m in sent if m["to"] == "act98@example.com"]) == 1


def test_bulk_assignment_sends_one_email(client, admin_headers, setup, org_id, db_session, sent):
    rn2 = models.ReportNumber(organization_id=org_id, name="RN98b")
    db_session.add(rn2)
    db_session.commit()
    r = client.post(
        "/api/tasks/bulk",
        json={"campaign_id": setup["campaign_id"], "report_number_ids": [setup["rn_id"], rn2.id],
              "volunteer_user_id": setup["user_id"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert len([m for m in sent if m["to"] == "act98@example.com"]) == 1


# --- text tasks -----------------------------------------------------------------
def test_text_task(client, admin_headers, setup):
    r = client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "task_text": "  להתקשר לרב  "},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["task_text"] == "להתקשר לרב"
    assert r.json()["report_number_ids"] == []

    both = client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "task_text": "x",
              "report_number_ids": [setup["rn_id"]]},
        headers=admin_headers,
    )
    assert both.status_code == 400

    # Switching a text task to report numbers clears the text in the same edit.
    tid = r.json()["id"]
    upd = client.put(f"/api/tasks/{tid}", json={"task_text": "", "report_number_ids": [setup["rn_id"]]},
                     headers=admin_headers)
    assert upd.status_code == 200, upd.text
    assert upd.json()["task_text"] is None


def test_my_tasks_carries_task_text(client, admin_headers, setup):
    client.post(
        "/api/tasks",
        json={"campaign_id": setup["campaign_id"], "task_text": "משימה כתובה",
              "volunteer_user_id": setup["user_id"]},
        headers=admin_headers,
    )
    token = client.post("/api/auth/token", data={"username": "act98", "password": "Passw0rd!"}).json()
    mine = client.get("/api/shliach-messages/my-tasks", headers=_bearer(token["access_token"])).json()
    assert [t["task_text"] for t in mine] == ["משימה כתובה"]


# --- messages for activists + stats --------------------------------------------
def test_first_use_computes_stats_and_seeds_messages_once(client, admin_headers, setup, org_id, db_session):
    stats = client.get("/api/activist-messages/stats", headers=admin_headers).json()
    assert stats["number_of_apartments"] == 2
    assert stats["number_of_jews"] == 0
    assert stats["organization_name"]
    msgs = client.get("/api/activist-messages", headers=admin_headers).json()
    assert {m["language"] for m in msgs} == {"he", "en"}
    he = next(m for m in msgs if m["language"] == "he")
    assert "{organization_name}" in he["text"] and "{number_of_jews}" in he["text"]

    # Deleting every message doesn't bring the seeds back.
    for m in msgs:
        client.delete(f"/api/activist-messages/{m['id']}", headers=admin_headers)
    assert client.get("/api/activist-messages", headers=admin_headers).json() == []


def test_messages_crud_and_admin_only(client, admin_headers, setup):
    r = client.post("/api/activist-messages", json={"text": "כל הכבוד!", "language": "he"},
                    headers=admin_headers)
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    upd = client.put(f"/api/activist-messages/{mid}", json={"text": "Great job!", "language": "en"},
                     headers=admin_headers)
    assert upd.json()["language"] == "en"
    assert client.post("/api/activist-messages", json={"text": "x", "language": "fr"},
                       headers=admin_headers).status_code == 422

    token = client.post("/api/auth/token", data={"username": "act98", "password": "Passw0rd!"}).json()
    activist = _bearer(token["access_token"])
    assert client.post("/api/activist-messages", json={"text": "x", "language": "he"},
                       headers=activist).status_code == 403
    feed = client.get("/api/activist-messages/feed", headers=activist)
    assert feed.status_code == 200
    assert "Great job!" in [m["text"] for m in feed.json()["messages"]]
    assert feed.json()["stats"]["number_of_apartments"] == 2


def test_stats_edit_and_recalculate(client, admin_headers, setup, org_id, db_session):
    client.get("/api/activist-messages/stats", headers=admin_headers)
    edited = client.put("/api/activist-messages/stats",
                        json={"number_of_apartments": 25, "organization_name": "בית חב\"ד"},
                        headers=admin_headers).json()
    assert edited["number_of_apartments"] == 25 and edited["organization_name"] == "בית חב\"ד"
    # Data changes don't touch the stored numbers until "recalculate".
    db_session.add(models.Apartment(organization_id=org_id, building_id=db_session.query(
        models.Building.id).filter_by(organization_id=org_id).first()[0], floor="2", apartment_name="9"))
    db_session.commit()
    assert client.get("/api/activist-messages/stats", headers=admin_headers).json()[
        "number_of_apartments"] == 25
    again = client.post("/api/activist-messages/stats/recalculate", headers=admin_headers).json()
    assert again["number_of_apartments"] == 3


# --- password -------------------------------------------------------------------
def test_change_password_without_current(client, setup):
    token = client.post("/api/auth/token", data={"username": "act98", "password": "Passw0rd!"}).json()
    r = client.post("/api/auth/change-password", json={"new_password": "NewPassw0rd"},
                    headers=_bearer(token["access_token"]))
    assert r.status_code == 200, r.text
    assert client.post("/api/auth/token", data={"username": "act98", "password": "NewPassw0rd"}
                       ).status_code == 200
