"""Signup = register an organization for superadmin approval (no login until approved)."""
from app import models


def _signup(client, username="founder", email="founder@x.com", org="Acme"):
    return client.post(
        "/api/auth/signup",
        json={
            "organization_name": org,
            "first_name": "פלוני",
            "last_name": "אלמוני",
            "email": email,
            "phone": "050-1234567",
            "username": username,
            "password": "pw12345",
        },
    )


def test_signup_creates_pending_org_and_blocks_login(client, db_session):
    r = _signup(client)
    assert r.status_code == 201
    assert r.json()["status"] == "pending_approval"

    org = db_session.query(models.Organization).filter_by(name="Acme").first()
    assert org is not None
    assert org.is_active is False
    assert org.approval_status == "pending"

    user = db_session.query(models.User).filter_by(email="founder@x.com").first()
    assert user is not None and user.role == "admin"
    assert user.full_name == "פלוני אלמוני"

    # The owner cannot log in until a superadmin approves the org.
    login = client.post(
        "/api/auth/token", data={"username": "founder", "password": "pw12345"}
    )
    assert login.status_code == 403


def test_signup_same_email_may_open_second_org(client):
    # fixes14: email is unique per organization — signing up a second org with
    # the same email is the supported multi-org scenario (login then offers an
    # organization selection).
    assert _signup(client, username="a", email="dup@x.com", org="A").status_code == 201
    assert _signup(client, username="b", email="dup@x.com", org="B").status_code == 201


def test_signup_notice_is_hebrew_and_english_in_one_mail(client, monkeypatch):
    sent = []
    monkeypatch.setattr(
        "app.core.email.send_email",
        lambda to, subject, body, **kw: sent.append((to, subject, body, kw.get("html"))),
    )
    assert _signup(client, email="bi@x.com", org="Bilingual").status_code == 201

    mails = [m for m in sent if m[0] == "bi@x.com"]
    assert len(mails) == 1
    _, subject, body, html = mails[0]
    assert "בקשתך התקבלה" in subject and "Request received" in subject
    for text in (body, html):
        assert "בקשתך לפתיחת הארגון" in text and "נבחנת" in text
        assert "open the organization" in text and "under review" in text
        assert "Bilingual" in text


def test_signup_emails_superadmin_an_approve_link(client, db_session, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "platform_admin_email", "ops@x.com")
    monkeypatch.setattr(settings, "superadmin_email", "OPS@x.com")  # deduped
    sent = []
    monkeypatch.setattr(
        "app.core.email.send_email",
        lambda to, subject, body, **kw: sent.append((to, subject, body, kw.get("html"))),
    )
    assert _signup(client, email="new@x.com", org="NewOrg").status_code == 201
    org = db_session.query(models.Organization).filter_by(name="NewOrg").first()

    admin_mails = [m for m in sent if m[0] != "new@x.com"]
    assert [m[0] for m in admin_mails] == ["ops@x.com"]
    _, subject, body, html = admin_mails[0]
    link = f"/dashboard/admin?approve={org.id}"
    assert link in body and link in html
    assert "ממתין לאישור" in subject and "pending approval" in subject


def test_seed_upgrades_legacy_subject_but_keeps_edited_one(db_session):
    from app.core.email import DEFAULT_EMAIL_TEMPLATES, LEGACY_EMAIL_SUBJECTS
    from app.seed import seed_email_templates

    seed_email_templates(db_session)
    rows = {r.key: r for r in db_session.query(models.EmailTemplate).all()}
    rows["aignummail1"].subject = LEGACY_EMAIL_SUBJECTS["aignummail1"]
    rows["aignummail2"].subject = "My custom subject"
    db_session.commit()

    seed_email_templates(db_session)
    db_session.expire_all()
    assert rows["aignummail1"].subject == DEFAULT_EMAIL_TEMPLATES["aignummail1"]["subject"]
    assert rows["aignummail2"].subject == "My custom subject"


def test_verify_invalid_token(client):
    # The legacy verify-email endpoint still rejects a bad token.
    assert client.get("/api/auth/verify-email?token=not-a-token").status_code == 400


def test_seed_upgrades_welcome_title_but_keeps_edited_one(db_session):
    """fixes90: the welcome title becomes "Welcome to Jewish Points" /
    "ברוכים הבאים לנקודות יהודיות" — only on a row still holding the old default."""
    from app.core.email import LEGACY_EMAIL_BODY_SNIPPETS
    from app.seed import seed_email_templates

    old_h1, _ = LEGACY_EMAIL_BODY_SNIPPETS["shliach_welcome"][0]
    db_session.query(models.EmailTemplate).filter_by(key="shliach_welcome").delete()
    db_session.add(models.EmailTemplate(
        key="shliach_welcome", subject="Welcome to the system",
        body=f"<html>{old_h1}<p>x</p></html>", body_hebrew="",
    ))
    db_session.commit()
    seed_email_templates(db_session)
    row = db_session.query(models.EmailTemplate).filter_by(key="shliach_welcome").one()
    assert row.subject == "ברוכים הבאים לנקודות יהודיות / Welcome to Jewish Points"
    assert "Welcome to Jewish Points" in row.body and "ברוכים הבאים לנקודות יהודיות" in row.body
    assert "Welcome to the system" not in row.body

    # An edited subject/body is never touched.
    row.subject = "My own subject"
    row.body = "<p>my own body</p>"
    db_session.commit()
    seed_email_templates(db_session)
    db_session.refresh(row)
    assert (row.subject, row.body) == ("My own subject", "<p>my own body</p>")
