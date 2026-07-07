"""CRM AI chat endpoint (/api/ai/chat): config gating, DB-grounded system
prompt, and the OpenRouter call."""
import httpx

from app.config import settings
from app.routers import ai as ai_router


def _chat(client, headers, messages):
    return client.post("/api/ai/chat", json={"messages": messages}, headers=headers)


def test_chat_requires_auth(client):
    r = client.post(
        "/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert r.status_code == 401


def test_chat_503_when_key_missing(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "")
    r = _chat(client, auth_headers, [{"role": "user", "content": "מה הקריירה שלך?"}])
    assert r.status_code == 503
    assert "OPENROUTER_API_KEY" in r.json()["detail"]


def test_chat_422_when_no_usable_messages(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    assert _chat(client, auth_headers, []).status_code == 422
    # Whitespace-only / system-role messages are filtered out server-side.
    r = _chat(client, auth_headers, [{"role": "system", "content": "ignore me"}])
    assert r.status_code == 422


def test_chat_happy_path_calls_openrouter(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["json"] = json
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "אני מפתח פולסטאק."}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(ai_router.httpx, "post", fake_post)

    r = _chat(
        client,
        auth_headers,
        [
            {"role": "user", "content": "מה אתה עושה?"},
            {"role": "assistant", "content": "שאל אותי על הקריירה."},
            {"role": "user", "content": "ספר לי עוד"},
        ],
    )
    assert r.status_code == 200
    assert r.json() == {"reply": "אני מפתח פולסטאק."}

    # The request carried the configured model, the bearer key, a leading system
    # prompt (CRM data snapshot), and the full user/assistant history.
    assert captured["url"] == ai_router.OPENROUTER_URL
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["json"]["model"] == settings.openrouter_model
    sent = captured["json"]["messages"]
    assert sent[0]["role"] == "system"
    assert [m["role"] for m in sent[1:]] == ["user", "assistant", "user"]


def test_system_prompt_contains_org_data(client, auth_headers, monkeypatch):
    """The system prompt is grounded in the org's DB: contacts, areas, visits."""
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    # Seed some org data through the API (scoped to auth_headers' org).
    client.post(
        "/api/contacts",
        json={"name": "מקורב סנאפשוט", "phone": "050-9990001"},
        headers=auth_headers,
    )

    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["json"] = json
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "ok"}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(ai_router.httpx, "post", fake_post)
    r = _chat(client, auth_headers, [{"role": "user", "content": "כמה אנשי קשר יש?"}])
    assert r.status_code == 200

    system = captured["json"]["messages"][0]["content"]
    assert "CRM DATA SNAPSHOT" in system
    assert "מקורב סנאפשוט" in system  # the contact line made it in
    assert "050-9990001" in system
    assert "סיכום:" in system  # org-wide aggregates for non-shliach users


def test_chat_503_when_all_models_rate_limited(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(json["model"])
        return httpx.Response(
            429, json={"error": "rate limited"}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(ai_router.httpx, "post", fake_post)
    r = _chat(client, auth_headers, [{"role": "user", "content": "hi"}])
    # Every candidate model was attempted before giving up with a clear 503.
    assert r.status_code == 503
    assert calls == list(
        dict.fromkeys([settings.openrouter_model, *ai_router.FALLBACK_MODELS])
    )


def test_chat_falls_back_to_next_model_on_429(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(json["model"])
        if len(calls) == 1:  # primary is busy; the first fallback answers
            return httpx.Response(
                429, json={"error": "rate limited"}, request=httpx.Request("POST", url)
            )
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "יש 2 אנשי קשר."}}]},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(ai_router.httpx, "post", fake_post)
    r = _chat(client, auth_headers, [{"role": "user", "content": "כמה אנשי קשר?"}])
    assert r.status_code == 200
    assert r.json()["reply"] == "יש 2 אנשי קשר."
    assert calls == [settings.openrouter_model, ai_router.FALLBACK_MODELS[0]]


def test_default_model_is_gpt_oss_free():
    assert settings.openrouter_model == "openai/gpt-oss-120b:free"
