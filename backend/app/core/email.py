"""Email sending with optional HTML templates.

When `SMTP_HOST` is unset (the dev default), emails are logged to the console
instead of sent — the link is printed so you can copy it. HTML templates live in
the `/HTML` directory (repo `backend/HTML`); `{{placeholders}}` are substituted.
"""
import logging
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.config import settings

logger = logging.getLogger("app.email")

# Superadmin-editable email templates (platform-level). Seeded into the
# email_templates table on startup; these are the fallback defaults. The sent
# email is the Hebrew body followed by the English body; {{placeholders}} are
# substituted from the values passed at send time.
# Two superadmin-editable bilingual emails (keys the user chose). aignummail1 is
# sent to the user on signup; aignummail2 when the org is approved. Placeholders:
# {{user_name}}, {{org_name}}, and (aignummail2) {{login_link}}.
DEFAULT_EMAIL_TEMPLATES: dict[str, dict[str, str]] = {
    "aignummail1": {
        "subject": "בקשתך התקבלה — מיני CRM",
        "body_hebrew": (
            "שלום {{user_name}},\n\n"
            "בקשתך לפתיחת הארגון \"{{org_name}}\" נשלחה והיא נבחנת.\n"
            "אנו נחזור אליך בהקדם האפשרי."
        ),
        "body": (
            "Hello {{user_name}},\n\n"
            "Your request to open the organization \"{{org_name}}\" has been received "
            "and is under review.\nWe will get back to you as soon as possible."
        ),
    },
    "aignummail2": {
        "subject": "הארגון אושר — מיני CRM",
        "body_hebrew": (
            "שלום {{user_name}},\n\n"
            "הארגון \"{{org_name}}\" אושר!\n"
            "ניתן להתחבר למערכת בקישור הבא:\n{{login_link}}"
        ),
        "body": (
            "Hello {{user_name}},\n\n"
            "The organization \"{{org_name}}\" has been approved!\n"
            "You can now log in:\n{{login_link}}"
        ),
    },
}


def _substitute(text: str, vars: dict[str, str]) -> str:
    for key, value in vars.items():
        text = text.replace("{{" + key + "}}", value or "")
    return text


def send_templated_email(db: Session, key: str, to: str, **vars: str) -> None:
    """Load an editable template by key (DB, falling back to the default),
    substitute {{vars}}, and send the Hebrew + English bodies as one email."""
    row = db.query(models.EmailTemplate).filter(models.EmailTemplate.key == key).first()
    default = DEFAULT_EMAIL_TEMPLATES.get(key, {})
    subject = _substitute((row.subject if row else default.get("subject", "")), vars)
    body_he = _substitute((row.body_hebrew if row else default.get("body_hebrew", "")), vars)
    body_en = _substitute((row.body if row else default.get("body", "")), vars)
    body = body_he
    if body_en:
        body = f"{body_he}\n\n----------------------------------------\n\n{body_en}" if body_he else body_en
    send_email(to, subject, body)

# backend/HTML  (email.py = backend/app/core/email.py → parents[2] = backend)
HTML_DIR = Path(__file__).resolve().parents[2] / "HTML"


def _logo_url() -> str:
    """Public URL of the system logo (served by the frontend at /logo.png).

    Embedded in every HTML email. Resolves to the deployed frontend domain in
    production; in dev it points at localhost (fine — dev emails are logged).
    """
    return f"{settings.frontend_url.rstrip('/')}/logo.png"


def render_template(name: str, **vars: str) -> str:
    """Load an /HTML template and substitute `{{var}}` placeholders."""
    html = (HTML_DIR / name).read_text(encoding="utf-8")
    for key, value in vars.items():
        html = html.replace("{{" + key + "}}", value or "")
    return html


def send_email(to: str, subject: str, body: str, html: Optional[str] = None) -> None:
    logger.info(
        "send_email START to=%s subject=%r | host=%s port=%s user=%s from=%s pwd_set=%s pwd_len=%s",
        to,
        subject,
        settings.smtp_host,
        settings.smtp_port,
        settings.smtp_user,
        settings.email_from,
        bool(settings.smtp_password),
        len(settings.smtp_password or ""),
    )
    if not settings.smtp_host or not settings.smtp_password:
        # Dev fallback: print to stdout so links are visible in `docker compose logs`.
        # Triggers when no SMTP host OR no password (so a fresh dev without an
        # app password logs instead of erroring on an unauthenticated send).
        logger.warning(
            "send_email DEV-FALLBACK — NOT sending (smtp_host set=%s, smtp_password set=%s). "
            "On prod this means the SMTP_* env vars are missing on Render.",
            bool(settings.smtp_host),
            bool(settings.smtp_password),
        )
        print(
            f"\n===== [DEV EMAIL — not actually sent] =====\n"
            f"To: {to}\nSubject: {subject}\n\n{body}\n"
            f"{'[+ HTML alternative attached]' if html else ''}\n"
            f"===========================================\n",
            flush=True,
        )
        return

    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            refused = server.send_message(msg)
        logger.info(
            "send_email SUCCESS to=%s subject=%r (Gmail accepted; refused_recipients=%s)",
            to,
            subject,
            refused or {},
        )
    except Exception:
        logger.exception("send_email FAILED to=%s subject=%r", to, subject)
        raise


def send_verification_email(user, token: str) -> str:
    """Send (or log) the tenant verification link (HTML `hello_tenant.html`).

    `user` is the pending admin User (has email/first_name/last_name/phone/username
    and an `organization`). Returns the link for testing/logging.
    """
    link = f"{settings.frontend_url}/verify?token={token}"
    org_name = user.organization.name if getattr(user, "organization", None) else ""
    body = (
        "ברוך הבא למיני CRM!\n\n"
        "לאימות כתובת האימייל והפעלת החשבון, לחץ על הקישור:\n"
        f"{link}\n\n"
        f"הקישור תקף ל-{settings.verification_token_expire_hours} שעות."
    )
    html = render_template(
        "hello_tenant.html",
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        organization_name=org_name,
        email=user.email or "",
        phone=user.phone or "",
        username=user.username or "",
        verify_url=link,
        expire_hours=str(settings.verification_token_expire_hours),
        logo_url=_logo_url(),
    )
    send_email(user.email, "אימות חשבון — מיני CRM", body, html=html)
    return link


def send_shliach_welcome(
    to: str,
    first_name: str,
    last_name: str,
    shliach_email: str,
    org_name: str = "",
) -> None:
    """Send (or log) the access-link email to a newly-created shliach (`hello_shliach.html`)."""
    url = settings.frontend_url
    body = (
        f"Hello {first_name} {last_name}, here is your link to the system: {url}\n"
        f"Use your email {shliach_email} to sign in."
    )
    html = render_template(
        "hello_shliach.html",
        first_name=first_name,
        last_name=last_name,
        url_to_system=url,
        shliach_email=shliach_email,
        org_name=org_name,
        logo_url=_logo_url(),
    )
    send_email(to, "Welcome to the system", body, html=html)


# --- Signup approval workflow emails ---------------------------------------
def send_org_pending_user(db: Session, to: str, user_name: str, org_name: str) -> None:
    """aignummail1 — 'request received, under review' to the signer-up."""
    send_templated_email(db, "aignummail1", to, user_name=user_name, org_name=org_name)


def send_org_approved_user(
    db: Session, to: str, user_name: str, org_name: str
) -> None:
    """aignummail2 — 'org approved, here's the link' to the signer-up."""
    send_templated_email(
        db,
        "aignummail2",
        to,
        user_name=user_name,
        org_name=org_name,
        login_link=settings.frontend_url,
    )


def send_org_pending_admin(org_name: str, user_name: str, user_email: str) -> None:
    """Notify the platform operator that a new org awaits approval (not editable)."""
    if not settings.platform_admin_email:
        logger.warning("platform_admin_email not set — skipping admin notification")
        return
    subject = f"New organization pending approval — {org_name}"
    body = (
        f'A new organization "{org_name}" has signed up and is pending approval.\n'
        f"Admin: {user_name} ({user_email}).\n"
        "Review and approve it in the system admin dashboard."
    )
    send_email(settings.platform_admin_email, subject, body)
