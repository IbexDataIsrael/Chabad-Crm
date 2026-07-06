"""Digital-twin AI chat endpoint (/api/ai/chat): config gating + OpenRouter call."""
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
    # prompt (digital-twin persona), and the full user/assistant history.
    assert captured["url"] == ai_router.OPENROUTER_URL
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["json"]["model"] == settings.openrouter_model
    sent = captured["json"]["messages"]
    assert sent[0]["role"] == "system"
    assert [m["role"] for m in sent[1:]] == ["user", "assistant", "user"]


def test_chat_502_on_upstream_error(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")

    def fake_post(url, **kwargs):
        return httpx.Response(
            429, json={"error": "rate limited"}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(ai_router.httpx, "post", fake_post)
    r = _chat(client, auth_headers, [{"role": "user", "content": "hi"}])
    assert r.status_code == 502


def test_default_model_is_gpt_oss_free():
    assert settings.openrouter_model == "openai/gpt-oss-120b:free"
