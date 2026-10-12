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
def _enable_legacy_register(monkeypatch):
    """The test suite's auth_headers/admin_headers fixtures (and many tests
    directly) use POST /api/auth/register as a fast way to create users —
    that route is gated off by default in real deployments (security
    hardening: it's an unauthenticated way to mint an active admin), so
    tests must opt back in explicitly."""
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "enable_legacy_register", True)


@pytest.fixture(autouse=True)
def _no_real_email(monkeypatch):
    """Force send_email into its dev fallback (log, don't send). The container
    carries real SMTP_* env vars, so without this, tests that create shliach
    contacts or org users would send actual Gmail messages to @example.com."""
    from app.config import settings as app_settings

    monkeypatch.setattr(app_settings, "smtp_host", "")
    monkeypatch.setattr(app_settings, "smtp_password", "")


@pytest.fixture(autouse=True)
def _background_sessions_use_test_db(monkeypatch):
    """Background tasks (fixes98 activist emails) open their own session via
    app.database.SessionLocal — point it at the in-memory test DB."""
    import app.database as database

    monkeypatch.setattr(database, "SessionLocal", TestingSessionLocal)


@pytest.fixture(autouse=True)
def _no_logged_error_capture(monkeypatch):
    """fixes101: the logging handler that stores every logger.exception in
    error_logs is off by default here (tests log expected failures on
    purpose); test_fixes101 turns it back on."""
    from app.core import error_log

    monkeypatch.setattr(error_log, "capture_background_errors", False)


@pytest.fixture(autouse=True)
def _setup_db():
    Base.metadata.create_all(bind=engine)
    # Seed the roles table (users.role FK target), the building_type table
    # (buildings.building_type_id FK target) + editable email templates so
    # admin template tests + the signup emails have their rows (mirrors
    # seed_all on startup).
    from app.seed import seed_building_types, seed_email_templates, seed_roles

    db = TestingSessionLocal()
    try:
        seed_roles(db)
        seed_building_types(db)
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


@pytest.fixture
def grant_task_access(db_session):
    """fixes58: apartment visibility via a report number now requires an
    ACTIVE Task under an active Campaign (replaces the old direct
    `ReportNumberContactShliach` grant) — shared factory fixture for every
    pre-fixes58 test that used to rely on that direct assignment alone.
    Usage: `grant_task_access(org_id, user_id, report_number_id)`."""
    from app import models

    def _grant(organization_id, user_id, report_number_id, *, status="ACTIVE", campaign_active=True):
        campaign = models.Campaign(
            organization_id=organization_id, name="Test Campaign", is_active=campaign_active,
        )
        db_session.add(campaign)
        db_session.flush()
        task = models.Task(
            organization_id=organization_id,
            campaign_id=campaign.id,
            volunteer_user_id=user_id,
            status=status,
        )
        db_session.add(task)
        db_session.flush()
        db_session.add(
            models.TaskReportNumber(
                organization_id=organization_id, task_id=task.id, report_number_id=report_number_id,
            )
        )
        db_session.commit()
        return task

    return _grant
