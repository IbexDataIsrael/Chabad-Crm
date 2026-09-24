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
