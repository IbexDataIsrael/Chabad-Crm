"""fixes113: concurrent confirmation on real Postgres (row locks, unique
constraints) — SQLite serializes writers, so it can't show these races.

Runs only when FIXES113_PG_URL points at a THROWAWAY database (the tables are
created and dropped here), e.g.
    FIXES113_PG_URL=postgresql://crm_admin:...@host.docker.internal:5432/crm_fixes113_test
"""
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app import models
from app.core.security import create_access_token
from app.database import Base, get_db
from app.main import app
from app.routers import assistant

PG_URL = os.environ.get("FIXES113_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="FIXES113_PG_URL not set")

URL = "/api/assistant/proposals"
FIELDS = {"first_name": "משה", "last_name": "כהן", "phone": "0501234567"}


@pytest.fixture
def pg():
    assert "test" in PG_URL.rsplit("/", 1)[-1], "FIXES113_PG_URL must name a *test* database"
    engine = create_engine(PG_URL, pool_size=20)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    from app.seed import seed_roles

    db = Session()
    seed_roles(db)
    org = models.Organization(name="Assistant QA")
    db.add(org)
    db.commit()
    user = models.User(organization_id=org.id, username="qa", full_name="qa", role="staff", is_active=True)
    db.add(user)
    db.commit()
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(user.id), role='staff')}"}

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _get_db
    try:
        yield {"Session": Session, "db": db, "org": org.id, "headers": headers}
    finally:
        db.close()
        app.dependency_overrides[get_db] = previous
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture(autouse=True)
def _no_geocoding(monkeypatch):
    monkeypatch.setattr("app.routers.contacts.geocode_address", lambda address: None)


def _confirm_all(proposal, headers, n):
    results = [None] * n

    def run(i):
        results[i] = TestClient(app).post(
            f"{URL}/{proposal['proposal_id']}/confirm",
            json={"payload_hash": proposal["payload_hash"]},
            headers=headers,
        )

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    return results


@pytest.mark.parametrize("phone", ["0501234567", None])
def test_concurrent_confirms_create_exactly_one_contact(pg, monkeypatch, phone):
    """N requests pass every pre-check together (barrier right before the
    claim), then race; the winner holds its row lock a while."""
    n = 6
    proposal = TestClient(app).post(
        URL,
        json={"action": "create_contact_draft", "fields": {**FIELDS, "phone": phone}},
        headers=pg["headers"],
    ).json()
    barrier = threading.Barrier(n, timeout=20)
    original_claim, original_create = assistant._claim, assistant.create_draft_contact

    def claim(db, proposal_id):
        barrier.wait()
        return original_claim(db, proposal_id)

    def slow_create(*args, **kwargs):
        contact = original_create(*args, **kwargs)
        time.sleep(0.5)
        return contact

    monkeypatch.setattr(assistant, "_claim", claim)
    monkeypatch.setattr(assistant, "create_draft_contact", slow_create)
    results = _confirm_all(proposal, pg["headers"], n)

    codes = sorted(r.status_code for r in results)
    assert codes == [200] * (n - 1) + [201], [r.text for r in results]
    ids = {r.json()["contact_id"] for r in results}
    assert len(ids) == 1
    assert all(r.json()["contact"]["status"] == "draft" for r in results)
    db = pg["Session"]()
    try:
        assert db.query(models.Contact).count() == 1
        p = db.get(models.AssistantProposal, proposal["proposal_id"])
        assert (p.status, p.result_contact_id) == ("executed", ids.pop())
    finally:
        db.close()


def test_retry_after_failed_commit_is_safe(pg, monkeypatch):
    proposal = TestClient(app).post(
        URL, json={"action": "create_contact_draft", "fields": FIELDS}, headers=pg["headers"]
    ).json()
    original = assistant.create_draft_contact

    def boom(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("connection lost")

    monkeypatch.setattr(assistant, "create_draft_contact", boom)
    r = TestClient(app, raise_server_exceptions=False).post(
        f"{URL}/{proposal['proposal_id']}/confirm",
        json={"payload_hash": proposal["payload_hash"]},
        headers=pg["headers"],
    )
    assert r.status_code == 500
    monkeypatch.setattr(assistant, "create_draft_contact", original)
    results = _confirm_all(proposal, pg["headers"], 4)
    assert sorted(r.status_code for r in results) == [200, 200, 200, 201]
    db = pg["Session"]()
    try:
        assert db.query(models.Contact).count() == 1
    finally:
        db.close()


def test_two_proposals_racing_for_one_phone(pg, monkeypatch):
    """Different proposals, same phone: uq_contact_org_phone lets one win;
    the other gets a structured phone_taken and stays pending."""
    client = TestClient(app)
    a, b = (
        client.post(URL, json={"action": "create_contact_draft", "fields": FIELDS}, headers=pg["headers"]).json()
        for _ in range(2)
    )
    barrier = threading.Barrier(2, timeout=20)
    original_claim = assistant._claim

    def claim(db, proposal_id):
        barrier.wait()
        return original_claim(db, proposal_id)

    monkeypatch.setattr(assistant, "_claim", claim)
    results = [None, None]

    def run(i, p):
        results[i] = TestClient(app).post(
            f"{URL}/{p['proposal_id']}/confirm", json={"payload_hash": p["payload_hash"]}, headers=pg["headers"]
        )

    threads = [threading.Thread(target=run, args=(i, p)) for i, p in enumerate((a, b))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(r.status_code for r in results) == [201, 422], [r.text for r in results]
    loser = next(r for r in results if r.status_code == 422)
    assert loser.json()["detail"]["invalid_fields"] == [{"field": "phone", "code": "phone_taken"}]
    db = pg["Session"]()
    try:
        assert db.query(models.Contact).count() == 1
        statuses = sorted(p.status for p in db.query(models.AssistantProposal))
        assert statuses == ["executed", "pending"]
    finally:
        db.close()


def test_result_contact_id_is_unique(pg):
    db = pg["db"]
    import datetime

    for i in range(2):
        db.add(
            models.AssistantProposal(
                id=f"00000000-0000-0000-0000-00000000000{i}",
                organization_id=pg["org"],
                user_id=db.query(models.User).first().id,
                action="create_contact_draft",
                payload="{}",
                payload_hash="x",
                status="executed",
                expires_at=datetime.datetime.utcnow(),
                result_contact_id=42,
            )
        )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
