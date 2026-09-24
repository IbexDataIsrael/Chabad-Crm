"""docs/system_api.md: Instinct test API (shared-key auth, create contact)."""
import pytest

from app import models

KEY = {"X-Instinct-Key": "test-instinct-key"}


@pytest.fixture
def org_id(client, admin_headers, monkeypatch):
    oid = client.get("/api/auth/me", headers=admin_headers).json()["organization_id"]
    monkeypatch.setenv("INSTINCT_API_KEY", KEY["X-Instinct-Key"])
    monkeypatch.setenv("INSTINCT_ORG_ID", str(oid))
    return oid


def test_ping_requires_key(client, org_id):
    assert client.get("/api/instinct/ping").status_code == 422
    assert client.get("/api/instinct/ping", headers={"X-Instinct-Key": "nope"}).status_code == 401
    r = client.get("/api/instinct/ping", headers=KEY)
    assert r.status_code == 200 and r.json() == {"ok": True}


def test_unset_key_never_matches(client, monkeypatch):
    monkeypatch.delenv("INSTINCT_API_KEY", raising=False)
    assert client.get("/api/instinct/ping", headers={"X-Instinct-Key": ""}).status_code == 401


def test_create_contact(client, org_id, db_session):
    r = client.post(
        "/api/instinct/contacts",
        headers=KEY,
        json={"first_name": "John", "last_name": "Doe", "phone": "+1 718 555 0100"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] and body["first_name"] == "John" and body["last_name"] == "Doe"

    c = db_session.get(models.Contact, body["id"])
    assert c.organization_id == org_id and c.contact_type == "mekurav"
    assert c.mekurav is not None

    dup = client.post(
        "/api/instinct/contacts",
        headers=KEY,
        json={"first_name": "Jane", "last_name": "Doe", "phone": "+1 718 555 0100"},
    )
    assert dup.status_code == 400


def test_create_contact_with_email(client, org_id, db_session):
    r = client.post(
        "/api/instinct/contacts",
        headers=KEY,
        json={"first_name": "John", "last_name": "Doe", "email": "  John.Doe@Example.com "},
    )
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "john.doe@example.com"
    assert db_session.get(models.Contact, r.json()["id"]).email == "john.doe@example.com"

    bad = client.post(
        "/api/instinct/contacts",
        headers=KEY,
        json={"first_name": "Jane", "last_name": "Doe", "email": "not-an-email"},
    )
    assert bad.status_code == 422


def _list_ids(client, headers, **params):
    r = client.get("/api/contacts/list", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return [c["id"] for c in r.json()["items"]]


def test_api_contact_lands_as_draft(client, org_id, admin_headers, db_session):
    # source/status in the body are ignored — the server always sets them.
    r = client.post(
        "/api/instinct/contacts",
        headers=KEY,
        json={"first_name": "Draft", "last_name": "Doe", "source": "crm", "status": "active"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["source"] == "instinct" and body["status"] == "draft"
    c = db_session.get(models.Contact, body["id"])
    assert (c.source, c.status) == ("instinct", "draft")

    # Kept out of the regular list, shown only in the draft list.
    assert body["id"] not in _list_ids(client, admin_headers)
    assert body["id"] in _list_ids(client, admin_headers, status="draft")


def test_ui_contact_stays_active_crm(client, admin_headers):
    r = client.post(
        "/api/contacts",
        headers=admin_headers,
        json={"name": "Regular", "phone": "0501234599", "source": "instinct", "status": "draft"},
    )
    assert r.status_code in (200, 201), r.text
    assert (r.json()["source"], r.json()["status"]) == ("crm", "active")
    assert r.json()["id"] in _list_ids(client, admin_headers)


def test_approve_flips_draft_to_active(client, org_id, admin_headers):
    cid = client.post(
        "/api/instinct/contacts", headers=KEY, json={"first_name": "Pending", "last_name": "Doe"}
    ).json()["id"]

    r = client.post(f"/api/contacts/{cid}/approve", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "active" and r.json()["source"] == "instinct"

    assert cid in _list_ids(client, admin_headers)
    assert cid not in _list_ids(client, admin_headers, status="draft")
    # Idempotent.
    assert client.post(f"/api/contacts/{cid}/approve", headers=admin_headers).status_code == 200
