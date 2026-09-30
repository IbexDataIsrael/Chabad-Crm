"""fixes79: /api/auth/me tells an activist whether they hold a taken task —
street2 shows the sample building while they don't."""
from app import models


def _login(client, username, role):
    client.post(
        "/api/auth/register",
        json={"username": username, "full_name": "פעיל", "password": "pw12345", "role": role},
    )
    token = client.post(
        "/api/auth/token", data={"username": username, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_me_has_active_task_follows_the_activists_tasks(client, db_session, grant_task_access):
    headers = _login(client, "act1", "shliach")
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["has_active_task"] is False

    user = db_session.query(models.User).filter_by(username="act1").first()
    rn = models.ReportNumber(organization_id=user.organization_id, name="R1")
    db_session.add(rn)
    db_session.commit()

    # An available (not taken) task, or one under an inactive campaign, doesn't count.
    grant_task_access(user.organization_id, user.id, rn.id, status="AVAILABLE")
    grant_task_access(user.organization_id, user.id, rn.id, campaign_active=False)
    assert client.get("/api/auth/me", headers=headers).json()["has_active_task"] is False

    grant_task_access(user.organization_id, user.id, rn.id)
    assert client.get("/api/auth/me", headers=headers).json()["has_active_task"] is True


def test_me_has_active_task_is_unset_for_non_activists(client):
    headers = _login(client, "boss2", "admin")
    assert client.get("/api/auth/me", headers=headers).json()["has_active_task"] is None
