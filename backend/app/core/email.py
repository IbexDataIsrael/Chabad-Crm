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

from app.config import settings

logger = logging.getLogger("app.email")

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
    if not settings.smtp_host:
        # Dev fallback: print to stdout so links are visible in `docker compose logs`.
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
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_user:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


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
