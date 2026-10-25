"""fixes113: assistant contact-draft proposals — confirm-before-write,
user/org binding, idempotent confirmation. In-memory SQLite (conftest); the
real-concurrency cases run on Postgres in test_fixes113_postgres.py."""
import datetime

import pytest
from fastapi.testclient import TestClient

from app import models
from app.core.security import create_access_token
from app.main import app
from app.routers import assistant

URL = "/api/assistant/proposals"

FIELDS = {
    "first_name": " משה ",
    "last_name": "כהן",
    "phone": "+972 50-123-4567",
    "email": " Moshe@Example.COM ",
    "address": "רחוב הרצל 1, תל אביב",
}


@pytest.fixture(autouse=True)
def _no_geocoding(monkeypatch):
    """The dev container carries a real GEOCODING_API_KEY — never call Google."""
    monkeypatch.setattr("app.routers.contacts.geocode_address", lambda address: None)


def _org(db, name):
    org = models.Organization(name=name)
    db.add(org)
    db.commit()
    return org


def _user(db, org, role, username):
    user = models.User(
        organization_id=org.id, username=username, full_name=username, role=role, is_active=True
    )
    db.add(user)
    db.commit()
    token = create_access_token(subject=str(user.id), role=role)
    return user, {"Authorization": f"Bearer {token}"}


@pytest.fixture
def env(db_session):
    org_a = _org(db_session, "Org A")
    org_b = _org(db_session, "Org B")
    staff, staff_h = _user(db_session, org_a, "staff", "staff_a")
    staff2, staff2_h = _user(db_session, org_a, "staff", "staff_a2")
    admin, admin_h = _user(db_session, org_a, "admin", "admin_a")
    admin_b, admin_b_h = _user(db_session, org_b, "admin", "admin_b")
    return {
        "db": db_session,
        "org_a": org_a.id,
        "org_b": org_b.id,
        "staff": staff,
        "staff_h": staff_h,
        "staff2_h": staff2_h,
        "admin_h": admin_h,
        "admin_b": admin_b,
        "admin_b_h": admin_b_h,
    }


def _counts(db):
    db.expire_all()
    return db.query(models.Contact).count(), db.query(models.AssistantProposal).count()


def _propose(client, headers, fields=FIELDS):
    return client.post(URL, json={"action": "create_contact_draft", "fields": fields}, headers=headers)


def _confirm(client, headers, proposal, **extra):
    body = {"payload_hash": proposal["payload_hash"], **extra}
    return client.post(f"{URL}/{proposal['proposal_id']}/confirm", json=body, headers=headers)


# --- proposal ----------------------------------------------------------------

def test_missing_fields_returns_needs_information_and_writes_nothing(client, env):
    r = _propose(client, env["staff_h"], {"first_name": "משה", "last_name": "   "})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "needs_information"
    assert body["missing_fields"] == ["last_name"]
    assert "proposal_id" not in body

    r = _propose(client, env["staff_h"], {"phone": "123"})
    body = r.json()
    assert body["missing_fields"] == ["first_name", "last_name"]
    # invalid fields are reported together with the missing ones
    assert body["invalid_fields"] == [{"field": "phone", "code": "invalid_phone"}]
    assert _counts(env["db"]) == (0, 0)


def test_proposal_returns_exact_draft_and_creates_no_contact(client, env):
    r = _propose(client, env["staff_h"])
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "proposal"
    assert body["draft"] == {
        "contact_type": "mekurav",
        "status": "draft",
        "source": "assistant",
        "assigned_user_id": env["staff"].guid,
        "first_name": "משה",
        "last_name": "כהן",
        "phone": "0501234567",
        "email": "moshe@example.com",
        "address": "רחוב הרצל 1, תל אביב",
    }
    assert len(body["payload_hash"]) == 64
    assert _counts(env["db"]) == (0, 1)

    p = env["db"].get(models.AssistantProposal, body["proposal_id"])
    assert (p.organization_id, p.user_id, p.status) == (env["org_a"], env["staff"].id, "pending")
    ttl = p.expires_at - p.created_at
    assert datetime.timedelta(minutes=14) < ttl <= datetime.timedelta(minutes=15, seconds=1)


@pytest.mark.parametrize(
    "fields, expected",
    [
        ({"phone": "02-1234567"}, {"field": "phone", "code": "invalid_phone"}),
        ({"email": "not-an-email"}, {"field": "email", "code": "invalid_email"}),
        ({"first_name": "א" * 151}, {"field": "first_name", "code": "too_long", "max_length": 150}),
        ({"last_name": "ב" * 101}, {"field": "last_name", "code": "too_long", "max_length": 100}),
    ],
)
def test_validation_failures(client, env, fields, expected):
    r = _propose(client, env["staff_h"], {**FIELDS, **fields})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["status"] == "invalid"
    assert detail["invalid_fields"] == [expected]
    assert _counts(env["db"]) == (0, 0)


def test_phone_taken_in_org_is_refused_but_other_org_is_not(client, env):
    db = env["db"]
    db.add(models.Contact(organization_id=env["org_b"], name="x", phone="0501234567"))
    db.commit()
    assert _propose(client, env["staff_h"]).status_code == 201  # org B's phone: fine

    db.add(models.Contact(organization_id=env["org_a"], name="y", phone="0501234567"))
    db.commit()
    r = _propose(client, env["staff_h"])
    assert r.status_code == 422
    assert r.json()["detail"]["invalid_fields"] == [{"field": "phone", "code": "phone_taken"}]


@pytest.mark.parametrize(
    "body",
    [
        {"action": "create_contact_draft", "fields": {**FIELDS, "organization_id": 2}},
        {"action": "create_contact_draft", "fields": FIELDS, "organization_id": 2},
        {"action": "create_contact_draft", "fields": FIELDS, "user_id": 1},
        {"action": "create_contact_draft", "fields": {**FIELDS, "assigned_user_id": "x"}},
        {"action": "delete_everything", "fields": FIELDS},
    ],
)
def test_caller_supplied_org_user_or_unknown_action_is_rejected(client, env, body):
    r = client.post(URL, json=body, headers=env["admin_b_h"])
    assert r.status_code == 422
    assert _counts(env["db"]) == (0, 0)


def test_auth_and_role_required(client, env, db_session):
    assert _propose(client, {}).status_code == 401
    org = db_session.get(models.Organization, env["org_a"])
    _, cm_h = _user(db_session, org, "campaign_manager", "cm")
    assert _propose(client, cm_h).status_code == 403
    assert _counts(env["db"]) == (0, 0)


# --- confirm -----------------------------------------------------------------

def test_confirm_creates_draft_and_reads_it_back(client, env):
    proposal = _propose(client, env["staff_h"]).json()
    r = _confirm(client, env["staff_h"], proposal)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "created" and body["replayed"] is False
    contact = body["contact"]
    assert contact["id"] == body["contact_id"]
    assert contact["status"] == "draft"
    assert (contact["contact_type"], contact["source"]) == ("mekurav", "assistant")
    assert contact["assigned_user_id"] == env["staff"].guid
    assert (contact["first_name"], contact["phone"], contact["email"]) == (
        "משה", "0501234567", "moshe@example.com",
    )

    db = env["db"]
    db.expire_all()
    saved = db.get(models.Contact, body["contact_id"])
    assert saved.organization_id == env["org_a"]
    assert saved.mekurav is not None
    p = db.get(models.AssistantProposal, proposal["proposal_id"])
    assert (p.status, p.result_contact_id) == ("executed", saved.id)

    # A draft stays out of the regular contacts list until approved.
    listed = client.get("/api/contacts", headers=env["admin_h"]).json()
    assert saved.id not in [c["id"] for c in listed]
    # ...and the existing approve flow takes it from there.
    assert client.post(f"/api/contacts/{saved.id}/approve", headers=env["admin_h"]).status_code == 200
    listed = client.get("/api/contacts", headers=env["admin_h"]).json()
    assert saved.id in [c["id"] for c in listed]


def test_retry_after_lost_response_replays_the_original_result(client, env):
    proposal = _propose(client, env["staff_h"]).json()
    first = _confirm(client, env["staff_h"], proposal).json()
    for _ in range(3):
        r = _confirm(client, env["staff_h"], proposal)
        assert r.status_code == 200
        assert r.json()["replayed"] is True
        assert r.json()["contact_id"] == first["contact_id"]
        assert r.json()["contact"]["status"] == "draft"
    assert _counts(env["db"]) == (1, 1)


def test_failure_inside_confirm_rolls_back_and_a_retry_creates_one(client, env, monkeypatch):
    proposal = _propose(client, env["staff_h"]).json()
    original = assistant.create_draft_contact

    def boom(*args, **kwargs):
        original(*args, **kwargs)  # the contact row is flushed...
        raise RuntimeError("connection lost")  # ...then the request dies

    monkeypatch.setattr(assistant, "create_draft_contact", boom)
    r = TestClient(app, raise_server_exceptions=False).post(
        f"{URL}/{proposal['proposal_id']}/confirm",
        json={"payload_hash": proposal["payload_hash"]},
        headers=env["staff_h"],
    )
    assert r.status_code == 500
    db = env["db"]
    assert _counts(db) == (0, 1)
    assert db.get(models.AssistantProposal, proposal["proposal_id"]).status == "pending"

    monkeypatch.setattr(assistant, "create_draft_contact", original)
    assert _confirm(client, env["staff_h"], proposal).status_code == 201
    assert _confirm(client, env["staff_h"], proposal).json()["replayed"] is True
    assert _counts(db) == (1, 1)


def test_changed_payload_is_rejected(client, env):
    proposal = _propose(client, env["staff_h"]).json()
    bad = {**proposal, "payload_hash": "0" * 64}
    assert _confirm(client, env["staff_h"], bad).status_code == 409
    changed = {**FIELDS, "last_name": "לוי"}
    assert _confirm(client, env["staff_h"], proposal, fields=changed).status_code == 409
    assert _counts(env["db"]) == (0, 1)

    # The same details in another spelling normalize to the same payload.
    same = {**FIELDS, "phone": "050-1234567", "email": "moshe@example.com"}
    assert _confirm(client, env["staff_h"], proposal, fields=same).status_code == 201
    # A replay with a changed payload is still refused.
    assert _confirm(client, env["staff_h"], proposal, fields=changed).status_code == 409
    assert _counts(env["db"]) == (1, 1)


def test_expired_proposal_is_refused_but_executed_one_still_replays(client, env):
    db = env["db"]
    stale = _propose(client, env["staff_h"]).json()
    p = db.get(models.AssistantProposal, stale["proposal_id"])
    p.expires_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
    db.commit()
    assert _confirm(client, env["staff_h"], stale).status_code == 410
    assert _counts(db) == (0, 1)

    done = _propose(client, env["staff_h"], {**FIELDS, "phone": "0529999999"}).json()
    created = _confirm(client, env["staff_h"], done).json()
    p = db.get(models.AssistantProposal, done["proposal_id"])
    p.expires_at = datetime.datetime.utcnow() - datetime.timedelta(days=1)
    db.commit()
    r = _confirm(client, env["staff_h"], done)
    assert r.status_code == 200 and r.json()["contact_id"] == created["contact_id"]


def test_permission_changes_are_rechecked_at_confirm(client, env):
    db = env["db"]
    proposal = _propose(client, env["staff_h"]).json()
    staff = db.get(models.User, env["staff"].id)

    staff.role = "campaign_manager"
    db.commit()
    assert _confirm(client, env["staff_h"], proposal).status_code == 403

    staff.role = "staff"
    staff.is_active = False
    db.commit()
    assert _confirm(client, env["staff_h"], proposal).status_code == 401

    org = db.get(models.Organization, env["org_a"])
    staff.is_active = True
    org.is_active = False
    db.commit()
    assert _confirm(client, env["staff_h"], proposal).status_code == 401
    assert _counts(db) == (0, 1)

    org.is_active = True
    db.commit()
    assert _confirm(client, env["staff_h"], proposal).status_code == 201


def test_other_users_and_orgs_cannot_see_or_confirm(client, env):
    proposal = _propose(client, env["staff_h"]).json()
    for headers in (env["staff2_h"], env["admin_h"], env["admin_b_h"]):
        r = _confirm(client, headers, proposal)
        assert r.status_code == 404
        assert r.json()["detail"] == "Proposal not found"
    assert _counts(env["db"]) == (0, 1)

    # Same after it was executed: no replay leaks to anyone else.
    assert _confirm(client, env["staff_h"], proposal).status_code == 201
    for headers in (env["staff2_h"], env["admin_h"], env["admin_b_h"]):
        assert _confirm(client, headers, proposal).status_code == 404

    unknown = {"proposal_id": "00000000-0000-0000-0000-000000000000", "payload_hash": "x"}
    assert _confirm(client, env["staff_h"], unknown).status_code == 404


def test_proposal_made_in_org_a_creates_nothing_in_org_b(client, env):
    """A user moved to another org (organization_id changed) loses the proposal."""
    db = env["db"]
    proposal = _propose(client, env["staff_h"]).json()
    staff = db.get(models.User, env["staff"].id)
    staff.organization_id = env["org_b"]
    db.commit()
    assert _confirm(client, env["staff_h"], proposal).status_code == 404
    assert db.query(models.Contact).filter_by(organization_id=env["org_b"]).count() == 0


def test_validation_is_rechecked_at_confirm(client, env):
    db = env["db"]
    proposal = _propose(client, env["staff_h"]).json()
    db.add(models.Contact(organization_id=env["org_a"], name="other", phone="0501234567"))
    db.commit()
    r = _confirm(client, env["staff_h"], proposal)
    assert r.status_code == 422
    assert r.json()["detail"]["invalid_fields"] == [{"field": "phone", "code": "phone_taken"}]
    assert db.get(models.AssistantProposal, proposal["proposal_id"]).status == "pending"
    assert _counts(db) == (1, 1)


def test_lost_claim_returns_the_winner_result(client, env, monkeypatch):
    """The path a concurrent loser takes: the claim UPDATE matches no row
    because another request executed the proposal in between."""
    proposal = _propose(client, env["staff_h"]).json()
    original = assistant._claim

    def claim_after_someone_else(db, proposal_id):
        # Simulate the other request winning (separate session, committed).
        from tests.conftest import TestingSessionLocal

        other = TestingSessionLocal()
        try:
            assert original(other, proposal_id)
            other.add(models.Contact(organization_id=env["org_a"], name="winner", status="draft"))
            other.flush()
            winner = other.query(models.Contact).filter_by(name="winner").one()
            other.query(models.AssistantProposal).filter_by(id=proposal_id).update(
                {"result_contact_id": winner.id}
            )
            other.commit()
        finally:
            other.close()
        return original(db, proposal_id)

    monkeypatch.setattr(assistant, "_claim", claim_after_someone_else)
    r = _confirm(client, env["staff_h"], proposal)
    assert r.status_code == 200
    assert r.json()["replayed"] is True
    assert r.json()["contact"]["first_name"] == "winner"
    assert _counts(env["db"]) == (1, 1)


def test_shliach_draft_is_owned_by_the_shliach(client, env, db_session):
    org = db_session.get(models.Organization, env["org_a"])
    shliach, shliach_h = _user(db_session, org, "shliach", "sh1")
    proposal = _propose(client, shliach_h).json()
    assert proposal["draft"]["assigned_user_id"] == shliach.guid
    contact = _confirm(client, shliach_h, proposal).json()["contact"]
    assert contact["assigned_user_id"] == shliach.guid
    assert contact["contact_type"] == "mekurav"


def test_user_and_org_delete_clear_proposals(client, env):
    from app.core.user_delete import clear_user_references
    from app.routers.admin import _delete_organization_cascade

    db = env["db"]
    _propose(client, env["staff_h"])
    _propose(client, env["admin_b_h"])
    staff = db.get(models.User, env["staff"].id)
    clear_user_references(db, staff, staff)
    db.commit()
    assert db.query(models.AssistantProposal).filter_by(organization_id=env["org_a"]).count() == 0

    _delete_organization_cascade(db, env["org_b"])
    assert db.query(models.AssistantProposal).count() == 0
