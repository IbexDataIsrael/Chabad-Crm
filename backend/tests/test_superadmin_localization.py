"""The translations table is global, so the platform superadmin can list and
edit it (org admins still can; staff cannot)."""
import pytest

from app import models
from app.core.security import hash_password


@pytest.fixture
def superadmin_headers(client, db_session):
    org = models.Organization(name="System", is_active=True)
    db_session.add(org)
    db_session.flush()
    db_session.add(
        models.User(
            organization_id=org.id,
            username="superadmin",
            full_name="superadmin",
            email="root@system.local",
            password_hash=hash_password("pw12345"),
            role="superadmin",
            is_active=True,
            email_verified=True,
        )
    )
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "superadmin", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_superadmin_lists_and_edits_translations(client, db_session, superadmin_headers):
    db_session.add(models.FieldLocalization(
        entity_type="nav", technical_name="nav.test_sa",
        hebrew_label="בדיקה", english_label="Test",
    ))
    db_session.commit()
    r = client.get("/api/localization", headers=superadmin_headers)
    assert r.status_code == 200
    rows = r.json()
    assert rows
    row = rows[0]
    r = client.put(
        f"/api/localization/{row['id']}",
        json={"english_label": "Edited by superadmin"},
        headers=superadmin_headers,
    )
    assert r.status_code == 200
    assert r.json()["english_label"] == "Edited by superadmin"
    meta = client.get("/api/metadata/localization").json()
    assert meta[row["technical_name"]]["en"] == "Edited by superadmin"


def test_org_admin_still_allowed_staff_refused(client, admin_headers, auth_headers):
    assert client.get("/api/localization", headers=admin_headers).status_code == 200
    assert client.get("/api/localization", headers=auth_headers).status_code == 403
