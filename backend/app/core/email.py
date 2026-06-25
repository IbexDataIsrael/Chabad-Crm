"""Minimal email sending.

When `SMTP_HOST` is unset (the dev default), emails are logged to the console
instead of sent — the verification link is printed so you can copy it.
"""
import logging
import smtplib
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger("app.email")


def send_email(to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        # Dev fallback: print to stdout so the link is visible in `docker compose logs`.
        print(
            f"\n===== [DEV EMAIL — not actually sent] =====\n"
            f"To: {to}\nSubject: {subject}\n\n{body}\n"
            f"===========================================\n",
            flush=True,
        )
        return

    msg = EmailMessage()
    msg["From"] = settings.email_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        if settings.smtp_user:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


def send_verification_email(to: str, token: str) -> str:
    """Send (or log) the verification link. Returns the link for testing/logging."""
    link = f"{settings.frontend_url}/verify?token={token}"
    body = (
        "ברוך הבא למיני CRM!\n\n"
        "לאימות כתובת האימייל והפעלת החשבון, לחץ על הקישור:\n"
        f"{link}\n\n"
        f"הקישור תקף ל-{settings.verification_token_expire_hours} שעות."
    )
    send_email(to, "אימות חשבון — מיני CRM", body)
    return link
