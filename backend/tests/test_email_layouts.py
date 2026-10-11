"""Branded Hebrew (RTL) + English (LTR) email layouts for the superadmin
email templates: defaults, upgrade of old shipped rows, send-time merge, logos."""
from app import models


def _capture(monkeypatch):
    sent = []

    def fake_send(to, subject, body, html=None, from_name=None, reply_to=None):
        sent.append({"to": to, "subject": subject, "text": body, "html": html})

    monkeypatch.setattr("app.core.email.send_email", fake_send)
    return sent


def test_every_default_has_rtl_hebrew_and_ltr_english_document():
    from app.core.email import DEFAULT_EMAIL_TEMPLATES

    assert set(DEFAULT_EMAIL_TEMPLATES) == {
        "shliach_welcome", "tenant_verification", "password_reset",
        "aignummail1", "aignummail2",
    }
    for key, tpl in DEFAULT_EMAIL_TEMPLATES.items():
        assert '<html lang="he" dir="rtl">' in tpl["body_hebrew"], key
        assert '<html lang="en" dir="ltr">' in tpl["body"], key
        for body in (tpl["body_hebrew"], tpl["body"]):
            assert "[[" not in body, key  # layout tokens all filled
            assert "{{logo_url}}" in body and "{{system_logo_url}}" in body, key


def test_seed_upgrades_old_default_bodies_but_keeps_edited(db_session):
    from app.core.email import DEFAULT_EMAIL_TEMPLATES
    from app.seed import seed_email_templates

    old_he = (
        "שלום {{user_name}},\n\n"
        "בקשתך לפתיחת הארגון \"{{org_name}}\" נשלחה והיא נבחנת.\n"
        "אנו נחזור אליך בהקדם האפשרי."
    )
    rows = {r.key: r for r in db_session.query(models.EmailTemplate).all()}
    # CRLF / re-indented copy of the old default still counts as untouched.
    rows["aignummail1"].body_hebrew = old_he.replace("\n", "\r\n") + "  "
    rows["aignummail1"].body = "<p>my own English</p>"
    db_session.commit()

    seed_email_templates(db_session)
    db_session.refresh(rows["aignummail1"])
    assert rows["aignummail1"].body_hebrew == DEFAULT_EMAIL_TEMPLATES["aignummail1"]["body_hebrew"]
    assert rows["aignummail1"].body == "<p>my own English</p>"


def test_welcome_mail_stacks_hebrew_then_english_with_org_logo(db_session, monkeypatch):
    from app.core.email import send_shliach_welcome

    sent = _capture(monkeypatch)
    send_shliach_welcome(
        db_session, to="a@x.com", first_name="<b>דנה</b>", last_name="כהן",
        shliach_email="a@x.com", org_name="בית חב\"ד",
        org_logo_url="https://res.cloudinary.com/demo/org-logo.png",
    )
    html = sent[0]["html"]
    assert html.count("<html") == 1 and html.count("<body") == 1
    he, en = html.index("ברוכים הבאים לנקודות יהודיות"), html.index("Welcome to Jewish Points")
    assert he < en
    assert 'src="https://res.cloudinary.com/demo/org-logo.png"' in html
    assert "/logo.png" in html  # platform logo stays in the footer
    assert "&lt;b&gt;דנה&lt;/b&gt;" in html and "<b>דנה</b>" not in html
    assert "{{" not in html
    assert "Welcome to Jewish Points" in sent[0]["text"] and "<td" not in sent[0]["text"]


def test_welcome_mail_without_org_logo_falls_back_to_platform(db_session, monkeypatch):
    from app.core.email import send_shliach_welcome

    sent = _capture(monkeypatch)
    send_shliach_welcome(
        db_session, to="a@x.com", first_name="A", last_name="B",
        shliach_email="a@x.com", org_name="Org",
    )
    assert 'src="http' in sent[0]["html"] and "{{logo_url}}" not in sent[0]["html"]
    assert "res.cloudinary.com" not in sent[0]["html"]


def test_general_mail_uses_platform_logo(db_session, monkeypatch):
    from app.config import settings
    from app.core.email import send_org_pending_user

    sent = _capture(monkeypatch)
    send_org_pending_user(db_session, "u@x.com", "User", "Org")
    html = sent[0]["html"]
    logo = f"{settings.frontend_url.rstrip('/')}/logo.png"
    assert html.count(f'src="{logo}"') == 4  # header + footer, in both languages
    assert "ממתין לאישור" in html and "Pending approval" in html
