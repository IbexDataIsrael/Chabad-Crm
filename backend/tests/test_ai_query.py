"""AI query endpoint (/api/ai/query): the LLM never returns SQL — only a
validated, allowlisted intent (app.crm_manifest) that becomes a scoped
SQLAlchemy query. Coverage: config gating, filter/table/operator validation,
tenant + shliach + role scoping (must match the real REST endpoints exactly),
row cap, and the response-parsing contract (`response.content[0].text`)."""
import json

import pytest

from app import models
from app.config import settings
from app.core.security import hash_password
from app.routers import ai_query as ai_query_router


def _query(client, headers, prompt):
    return client.post("/api/ai/query", json={"prompt": prompt}, headers=headers)


def _me(client, headers):
    return client.get("/api/auth/me", headers=headers).json()


def _fake_anthropic(monkeypatch, text_or_fn, capture=None):
    """Monkeypatch anthropic.Anthropic so the router's `client.messages.create()`
    returns a response whose only readable shape is `.content[0].text` — the
    correct SDK shape (`.content` is a list of blocks). If the router code were
    changed back to the doc's incorrect `.content.text`, every test using this
    fake would fail with AttributeError."""

    class FakeContent:
        def __init__(self, text):
            self.text = text

    class FakeResponse:
        def __init__(self, text):
            self.content = [FakeContent(text)]

    class FakeMessages:
        def create(self, **kwargs):
            if capture is not None:
                capture.update(kwargs)
            text = text_or_fn(kwargs) if callable(text_or_fn) else text_or_fn
            return FakeResponse(text)

    class FakeClient:
        def __init__(self, api_key=None):
            self.messages = FakeMessages()

    monkeypatch.setattr(ai_query_router.anthropic, "Anthropic", FakeClient)


def _ok(table, filters=None, title="Report"):
    return json.dumps(
        {"ok": True, "table": table, "title": title, "filters": filters or []}
    )


# --- apartment/shliach builders (mirrors test_fixes20.py's proven pattern) --
def _mk_area(client, headers, name="אזור שאילתה"):
    r = client.post("/api/areas", json={"area_name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _mk_building(client, headers, area_id, address="1 Query Ave"):
    r = client.post(
        "/api/buildings",
        json={"area_id": area_id, "building_address": address, "floors": ["1"]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_apartment(client, headers, building_id, **kw):
    r = client.post(
        "/api/apartments", json={"building_id": building_id, **kw}, headers=headers
    )
    assert r.status_code == 201, r.text
    return r.json()


def _mk_report_number(client, headers, name="דוח שאילתה"):
    r = client.post("/api/report-numbers", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


_seq = iter(range(5000, 9999))


def _mk_shliach_contact(client, headers, email, **shliach):
    shliach.setdefault("password", "pw12345")
    r = client.post(
        "/api/contacts",
        json={
            "name": "שליח שאילתה",
            "phone": f"0548{next(_seq):06d}",
            "contact_type": "shliach",
            "email": email,
            "shliach": shliach,
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _shliach_contact_login(client, email):
    token = client.post(
        "/api/auth/token", data={"username": email, "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def shliach_headers(client, db_session, admin_headers):
    """An active shliach login (fixes10-style), opted into contact visibility."""
    org_id = _me(client, admin_headers)["organization_id"]
    db_session.query(models.Organization).filter(
        models.Organization.id == org_id
    ).update({"shliach_can_view_contacts": True})
    db_session.add(
        models.User(
            organization_id=org_id,
            username="shliachq",
            full_name="שליח שאילתה",
            email="shliachq@example.com",
            password_hash=hash_password("pw12345"),
            role="shliach",
            is_active=True,
            email_verified=True,
        )
    )
    db_session.commit()
    token = client.post(
        "/api/auth/token", data={"username": "shliachq", "password": "pw12345"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# --- tests -------------------------------------------------------------------

def test_query_requires_auth(client):
    r = client.post("/api/ai/query", json={"prompt": "hi"})
    assert r.status_code == 401


def test_query_503_when_key_missing(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    r = _query(client, auth_headers, "show contacts")
    assert r.status_code == 503
    assert "ANTHROPIC_API_KEY" in r.json()["detail"]


def test_query_happy_path_contacts(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    client.post(
        "/api/contacts",
        json={"name": "ברוקלין", "phone": "050-7010012", "address": "12 Brooklyn Ave"},
        headers=admin_headers,
    )
    captured = {}
    _fake_anthropic(
        monkeypatch,
        _ok("contacts", [{"column": "address", "op": "contains", "value": "Brooklyn"}], "אנשי קשר בברוקלין"),
        capture=captured,
    )

    r = _query(client, admin_headers, "contacts in Brooklyn")
    assert r.status_code == 200
    body = r.json()
    assert body["table_title"] == "אנשי קשר בברוקלין"
    assert [c["key"] for c in body["columns"]] == [
        "name", "last_name", "phone", "contact_type", "address",
        "pipeline_status", "admin_area_name",
    ]
    assert body["row_count"] == 1
    assert body["rows"][0]["name"] == "ברוקלין"
    assert body["truncated"] is False
    # Sanity: the model call actually used the configured model + our prompt.
    assert captured["model"] == settings.anthropic_model
    assert captured["messages"][0]["content"] == "contacts in Brooklyn"


def test_query_rejects_unknown_table(client, admin_headers, monkeypatch):
    # "users" isn't a manifest key at all — crm_manifest.run_query rejects it
    # before building any query (TABLES.get() returns None immediately).
    assert "users" not in ai_query_router.crm_manifest.TABLES
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, _ok("users"))

    r = _query(client, admin_headers, "show me the users table")
    assert r.status_code == 403


def test_query_rejects_unknown_column(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(
        monkeypatch,
        _ok("contacts", [{"column": "secret_column", "op": "eq", "value": "x"}]),
    )
    r = _query(client, admin_headers, "show something odd")
    assert r.status_code == 422


def test_query_rejects_unsupported_operator(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(
        monkeypatch,
        _ok("donations", [{"column": "amount", "op": "contains", "value": "5"}]),
    )
    r = _query(client, admin_headers, "donations containing 5")
    assert r.status_code == 422


def test_query_donations_forbidden_for_staff(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    captured = {}
    _fake_anthropic(monkeypatch, _ok("donations"), capture=captured)
    r = _query(client, auth_headers, "show donations")
    assert r.status_code == 403
    assert "donations" not in captured["system"]


def test_query_donations_allowed_for_admin(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    client.post(
        "/api/donations", json={"donation_date": "2026-01-15", "amount": 100}, headers=admin_headers
    )
    _fake_anthropic(monkeypatch, _ok("donations"))
    r = _query(client, admin_headers, "show donations")
    assert r.status_code == 200


def test_query_tenant_scoping_enforced(client, admin_headers, monkeypatch):
    client.post(
        "/api/auth/register",
        json={"username": "other_admin_q", "full_name": "אחר", "password": "pw12345", "role": "admin"},
    )
    other_token = client.post(
        "/api/auth/token", data={"username": "other_admin_q", "password": "pw12345"}
    ).json()["access_token"]
    other_headers = {"Authorization": f"Bearer {other_token}"}

    client.post("/api/contacts", json={"name": "MineOrg", "phone": "050-7110011"}, headers=admin_headers)
    client.post("/api/contacts", json={"name": "OtherOrg", "phone": "050-7110022"}, headers=other_headers)

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, _ok("contacts"))

    r = _query(client, admin_headers, "show all contacts")
    assert r.status_code == 200
    names = [row["name"] for row in r.json()["rows"]]
    assert "MineOrg" in names
    assert "OtherOrg" not in names


def test_query_shliach_scoping_contacts(client, admin_headers, shliach_headers, monkeypatch):
    client.post("/api/contacts", json={"name": "NotMine", "phone": "050-7220011"}, headers=admin_headers)
    client.post("/api/contacts", json={"name": "MineShliach", "phone": "050-7220022"}, headers=shliach_headers)

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, _ok("contacts"))

    r = _query(client, shliach_headers, "show my contacts")
    assert r.status_code == 200
    names = [row["name"] for row in r.json()["rows"]]
    assert "MineShliach" in names
    assert "NotMine" not in names


def test_query_shliach_scoping_apartments(client, admin_headers, monkeypatch):
    area = _mk_area(client, admin_headers)
    building = _mk_building(client, admin_headers, area["id"])
    rn = _mk_report_number(client, admin_headers)
    _mk_apartment(client, admin_headers, building["id"], apartment_name="COVERED", report_number_id=rn["id"])
    _mk_apartment(client, admin_headers, building["id"], apartment_name="HIDDEN")

    _mk_shliach_contact(client, admin_headers, "aiquery.shliach@example.com", report_number_ids=[rn["id"]])
    shliach_headers = _shliach_contact_login(client, "aiquery.shliach@example.com")

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, _ok("apartments"))

    r = _query(client, shliach_headers, "show apartments")
    assert r.status_code == 200
    names = [row["apartment_name"] for row in r.json()["rows"]]
    assert names == ["COVERED"]


def test_query_row_cap_enforced(client, admin_headers, db_session, monkeypatch):
    org_id = _me(client, admin_headers)["organization_id"]
    for i in range(205):
        db_session.add(
            models.Contact(
                organization_id=org_id,
                name=f"Cap{i}",
                phone=f"050-77{i:05d}",
                contact_type="mekurav",
            )
        )
    db_session.commit()

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, _ok("contacts"))

    r = _query(client, admin_headers, "all contacts")
    assert r.status_code == 200
    body = r.json()
    assert body["row_count"] == 200
    assert len(body["rows"]) == 200
    assert body["truncated"] is True


def test_query_502_on_unparseable_json(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, "not json at all")
    r = _query(client, admin_headers, "??")
    assert r.status_code == 502


def test_query_tolerates_markdown_fenced_json(client, admin_headers, monkeypatch):
    """Models sometimes wrap structured output in ```json ...``` despite being
    told not to — the parser should strip that instead of 502ing."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    fenced = "```json\n" + _ok("buildings") + "\n```"
    _fake_anthropic(monkeypatch, fenced)
    r = _query(client, admin_headers, "show buildings")
    assert r.status_code == 200


def test_query_tolerates_leading_prose_before_json(client, admin_headers, monkeypatch):
    prefixed = "Sure, here you go:\n" + _ok("buildings")
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, prefixed)
    r = _query(client, admin_headers, "show buildings")
    assert r.status_code == 200


def test_query_unsupported_request_returns_ok_false_style_502_or_422(client, admin_headers, monkeypatch):
    """A request with no allowlisted mapping (e.g. mivtzoim checklist status,
    which isn't in any table's column registry) should surface as a clean
    422 from the model's own ok:false, not a raw parsing failure — this test
    guards the parsing side only (ok:false is covered by
    test_query_ok_false_from_llm_surfaces_as_422)."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(
        monkeypatch,
        json.dumps({"ok": False, "message": "No table tracks mivtzoim/checklist status."}),
    )
    r = _query(client, admin_headers, "all contacts with mivtzoim")
    assert r.status_code == 422


def test_query_ok_false_from_llm_surfaces_as_422(client, admin_headers, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(
        monkeypatch, json.dumps({"ok": False, "message": "אין דוח כזה"})
    )
    r = _query(client, admin_headers, "show me birthdays")
    assert r.status_code == 422
    assert r.json()["detail"] == "אין דוח כזה"


def test_query_content0_text_parsing(client, admin_headers, monkeypatch):
    """Regression guard: the fake response here only implements
    `.content[0].text` (a list of blocks), matching the real Anthropic SDK.
    If the router read `.content.text` instead this would fail with
    AttributeError."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _fake_anthropic(monkeypatch, _ok("buildings"))
    r = _query(client, admin_headers, "show buildings")
    assert r.status_code == 200
