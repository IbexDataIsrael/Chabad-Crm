"""Signup = register an organization for superadmin approval (no login until approved)."""
from app import models


def _signup(client, username="founder", email="founder@x.com", org="Acme"):
    return client.post(
        "/api/auth/signup",
        json={
            "organization_name": org,
            "first_name": "פלוני",
            "last_name": "אלמוני",
            "email": email,
            "phone": "050-1234567",
            "username": username,
            "password": "pw12345",
        },
    )


def test_signup_creates_pending_org_and_blocks_login(client, db_session):
    r = _signup(client)
    assert r.status_code == 201
    assert r.json()["status"] == "pending_approval"

    org = db_session.query(models.Organization).filter_by(name="Acme").first()
    assert org is not None
    assert org.is_active is False
    assert org.approval_status == "pending"

    user = db_session.query(models.User).filter_by(email="founder@x.com").first()
    assert user is not None and user.role == "admin"
    assert user.full_name == "פלוני אלמוני"

    # The owner cannot log in until a superadmin approves the org.
    login = client.post(
        "/api/auth/token", data={"username": "founder", "password": "pw12345"}
    )
    assert login.status_code == 403


def test_signup_duplicate_email_rejected(client):
    assert _signup(client, username="a", email="dup@x.com", org="A").status_code == 201
    assert _signup(client, username="b", email="dup@x.com", org="B").status_code == 400


def test_verify_invalid_token(client):
    # The legacy verify-email endpoint still rejects a bad token.
    assert client.get("/api/auth/verify-email?token=not-a-token").status_code == 400
