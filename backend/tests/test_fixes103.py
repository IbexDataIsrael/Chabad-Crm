"""fixes103: all email through the email-service microservice, Gmail fallback."""
import os

import httpx
import pytest
from pydantic import ValidationError

from app.config import Settings, settings
from app.core import email as mail
from app.core import email_service


@pytest.fixture
def gmail(monkeypatch):
    sent = []
    monkeypatch.setattr(mail, "send_via_gmail", lambda to, subject, body, *a, **k: sent.append((to, subject, body)))
    monkeypatch.setattr(mail, "_last_service_down_alert", 0.0)
    monkeypatch.setattr(settings, "superadmin_email", "boss@example.com")
    return sent


def _service(monkeypatch, fn):
    calls = []

    def fake(to, subject, **kw):
        calls.append((to, subject, kw))
        return fn(to)

    monkeypatch.setattr(mail, "send_via_service", fake)
    return calls


def test_real_email_through_local_service():
    """Sends a real email via the running service and prints its id.
    Recipient: EMAIL_SERVICE_TEST_TO, else Resend's test inbox (a real send
    that Resend accepts without mailing a person)."""
    to = os.environ.get("EMAIL_SERVICE_TEST_TO") or "delivered@resend.dev"
    try:
        httpx.get(f"{settings.email_service_url}/health", timeout=3)
    except httpx.HTTPError:
        pytest.skip(f"email-service not reachable at {settings.email_service_url}")
    email_id = email_service.send(
        to,
        "MiniCRM fixes103 test email",
        html="<p>Test email from the MiniCRM test suite (fixes103).</p>",
        text="Test email from the MiniCRM test suite (fixes103).",
    )
    print(f"email-service id: {email_id}")
    assert email_id


def test_service_success_skips_gmail(monkeypatch, gmail):
    calls = _service(monkeypatch, lambda to: "id-1")
    mail.send_email("a@example.com", "Hi", "body", html="<p>body</p>", reply_to="r@example.com")
    assert calls == [("a@example.com", "Hi", {"html": "<p>body</p>", "text": "body", "from_address": None, "reply_to": "r@example.com"})]
    assert gmail == []


def test_comma_separated_recipients_get_one_call_each(monkeypatch, gmail):
    calls = _service(monkeypatch, lambda to: "id")
    mail.send_email("a@example.com, b@example.com", "Hi", "body")
    assert [c[0] for c in calls] == ["a@example.com", "b@example.com"]


def test_org_name_as_sender_when_service_from_is_set(monkeypatch, gmail):
    calls = _service(monkeypatch, lambda to: "id")
    monkeypatch.setattr(settings, "email_service_from", "admin@jewishpoints.com")
    mail.send_email("a@example.com", "Hi", "body", from_name="My Org")
    assert calls[0][2]["from_address"] == "My Org <admin@jewishpoints.com>"


def test_service_failure_falls_back_to_gmail_and_alerts(monkeypatch, gmail):
    def boom(to):
        raise email_service.EmailServiceError("HTTP 500: down")

    _service(monkeypatch, boom)
    mail.send_email("a@example.com", "Welcome", "the body")
    assert gmail[0] == ("boss@example.com", "EMAIL-SERVICE DOWN", gmail[0][2])
    assert "HTTP 500: down" in gmail[0][2] and "Welcome" in gmail[0][2] and "a@example.com" in gmail[0][2]
    assert gmail[1] == ("a@example.com", "Welcome", "the body")


def test_only_failed_recipients_fall_back(monkeypatch, gmail):
    def some_fail(to):
        if to == "b@example.com":
            raise email_service.EmailServiceError("timeout")
        return "id"

    _service(monkeypatch, some_fail)
    mail.send_email("a@example.com,b@example.com", "S", "body")
    assert [g[0] for g in gmail] == ["boss@example.com", "b@example.com"]


def test_down_alert_is_throttled(monkeypatch, gmail):
    def boom(to):
        raise email_service.EmailServiceError("down")

    _service(monkeypatch, boom)
    mail.send_email("a@example.com", "S1", "b")
    mail.send_email("c@example.com", "S2", "b")
    subjects = [g[1] for g in gmail]
    assert subjects.count("EMAIL-SERVICE DOWN") == 1
    assert subjects.count("S1") == 1 and subjects.count("S2") == 1


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


def test_client_posts_the_contract(monkeypatch):
    seen = {}

    def fake_post(url, json, headers, timeout):
        seen.update(url=url, json=json, headers=headers, timeout=timeout)
        return _Resp(200, {"id": "abc", "status": "queued"})

    monkeypatch.setattr(email_service.httpx, "post", fake_post)
    assert email_service.send("a@example.com", "S", text="t") == "abc"
    assert seen["url"] == f"{settings.email_service_url}/send"
    assert seen["headers"] == {"X-Internal-Token": settings.email_service_token}
    assert seen["json"] == {"to": "a@example.com", "subject": "S", "text": "t", "project": "minicrm"}
    assert seen["timeout"] == 5


@pytest.mark.parametrize(
    "outcome",
    [_Resp(401, {"detail": "bad token"}), httpx.ConnectTimeout("timed out")],
)
def test_client_raises_on_non_200_and_errors(monkeypatch, outcome):
    def fake_post(*a, **k):
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(email_service.httpx, "post", fake_post)
    with pytest.raises(email_service.EmailServiceError):
        email_service.send("a@example.com", "S", text="t")


def test_settings_fail_fast_without_email_service(monkeypatch):
    monkeypatch.setenv("EMAIL_SERVICE_URL", "")
    monkeypatch.setenv("EMAIL_SERVICE_TOKEN", "")
    with pytest.raises(ValidationError, match="EMAIL_SERVICE_URL, EMAIL_SERVICE_TOKEN"):
        Settings()


def test_settings_strip_trailing_slash(monkeypatch):
    monkeypatch.setenv("EMAIL_SERVICE_URL", "http://svc:8000/")
    monkeypatch.setenv("EMAIL_SERVICE_TOKEN", "t")
    assert Settings().email_service_url == "http://svc:8000"
