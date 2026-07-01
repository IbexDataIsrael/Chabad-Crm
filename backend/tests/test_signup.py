import pytest

from app import models
from app.config import settings
from app.core.security import create_email_token


@pytest.fixture(autouse=True)
def _require_email_verification():
    """This file exercises the email-verification signup flow, which is now
    opt-in (default is immediate activation). Force it on for these tests."""
    previous = settings.require_email_verification
    settings.require_email_verification = True
    yield
    settings.require_email_verification = previous


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


def test_signup_creates_pending_admin_and_blocks_login(client, db_session):
    r = _signup(client)
    assert r.status_code == 201
    assert r.json()["status"] == "pending_verification"

    user = db_session.query(models.User).filter_by(email="founder@x.com").first()
    assert user is not None
    assert user.role == "admin"
    assert user.is_active is False
    assert user.email_verified is False
    assert user.full_name == "פלוני אלמוני"

    # Login blocked until verified.
    login = client.post(
        "/api/auth/token", data={"username": "founder", "password": "pw12345"}
    )
    assert login.status_code == 403


def test_verify_activates_provisions_and_enables_login(client, db_session):
    _signup(client, username="ver", email="ver@x.com")
    user = db_session.query(models.User).filter_by(email="ver@x.com").first()
    org_id = user.organization_id

    token = create_email_token(user.id)
    res = client.get(f"/api/auth/verify-email?token={token}")
    assert res.status_code == 200
    assert res.json()["status"] == "verified"

    db_session.refresh(user)
    assert user.email_verified is True and user.is_active is True

    # Org picklists were provisioned.
    count = (
        db_session.query(models.PicklistValue)
        .filter_by(organization_id=org_id)
        .count()
    )
    assert count > 0

    # Login now works.
    login = client.post(
        "/api/auth/token", data={"username": "ver", "password": "pw12345"}
    )
    assert login.status_code == 200


def test_verify_invalid_token(client):
    assert client.get("/api/auth/verify-email?token=not-a-token").status_code == 400


def test_signup_duplicate_email_rejected(client):
    assert _signup(client, username="a", email="dup@x.com", org="A").status_code == 201
    assert _signup(client, username="b", email="dup@x.com", org="B").status_code == 400


def test_resend_verification_always_ok(client):
    _signup(client, username="re", email="re@x.com")
    assert (
        client.post("/api/auth/resend-verification", json={"email": "re@x.com"}).status_code
        == 200
    )
    # Unknown email still 200 (no enumeration).
    assert (
        client.post(
            "/api/auth/resend-verification", json={"email": "ghost@x.com"}
        ).status_code
        == 200
    )


def test_verify_is_idempotent(client, db_session):
    _signup(client, username="idem", email="idem@x.com")
    user = db_session.query(models.User).filter_by(email="idem@x.com").first()
    token = create_email_token(user.id)
    assert client.get(f"/api/auth/verify-email?token={token}").status_code == 200
    assert client.get(f"/api/auth/verify-email?token={token}").status_code == 200
