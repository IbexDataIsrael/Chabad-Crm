import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.deps import require_admin
from app.main import app

# Isolated in-memory SQLite shared across the test session via StaticPool.
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


# Test-only route to exercise the require_admin dependency (no admin-gated
# CRM routes exist until Phase 4b).
@app.get("/api/_test/admin-only")
def _admin_only(_user=Depends(require_admin)):
    return {"ok": True}


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    """Force send_email into its dev fallback (log, don't send). The container
    carries real SMTP_* env vars, so without this, tests that create shliach
    contacts or org users would send actual Gmail messages to @example.com."""
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "smtp_host", "")
    monkeypatch.setattr(app_settings, "smtp_password", "")


@pytest.fixture(autouse=True)
def _setup_db():
    Base.metadata.create_all(bind=engine)
    # Seed the roles table (users.role FK target) + editable email templates
    # so admin template tests + the signup emails have their rows (mirrors
    # seed_all on startup).
    from app.seed import seed_email_templates, seed_roles

    db = TestingSessionLocal()
    try:
        seed_roles(db)
        seed_email_templates(db)
    finally:
        db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    """A session against the same in-memory test DB the app uses."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def auth_headers(client):
    """Register + log in a staff user and return its Authorization header."""
    client.post(
        "/api/auth/register",
        json={
            "username": "staff1",
            "full_name": "צוות",
            "password": "pw12345",
            "role": "staff",
        },
    )
    token = client.post(
        "/api/auth/token",
        data={"username": "staff1", "password": "pw12345"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers(client):
    """Register + log in an admin user and return its Authorization header."""
    client.post(
        "/api/auth/register",
        json={
            "username": "boss",
            "full_name": "מנהל",
            "password": "pw12345",
            "role": "admin",
        },
    )
    token = client.post(
        "/api/auth/token",
        data={"username": "boss", "password": "pw12345"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
