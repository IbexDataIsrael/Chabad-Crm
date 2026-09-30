"""Email sending with optional HTML templates.

When `SMTP_HOST` is unset (the dev default), emails are logged to the console
instead of sent — the link is printed so you can copy it. HTML templates live in
the `/HTML` directory (repo `backend/HTML`); `{{placeholders}}` are substituted.
"""
import html as htmllib
import logging
import re
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.config import settings

logger = logging.getLogger("app.email")

# backend/HTML  (email.py = backend/app/core/email.py → parents[2] = backend)
HTML_DIR = Path(__file__).resolve().parents[2] / "HTML"


def _load_html(name: str) -> str:
    """The raw text of an /HTML template file ('' if missing)."""
    try:
        return (HTML_DIR / name).read_text(encoding="utf-8")
    except OSError:  # pragma: no cover — template files ship with the repo
        return ""


# Superadmin-editable email templates (platform-level). Seeded into the
# email_templates table on startup; these are the fallback defaults. The sent
# email is the Hebrew body followed by the English body; {{placeholders}} are
# substituted from the values passed at send time.
# Two superadmin-editable bilingual emails (keys the user chose). aignummail1 is
# sent to the user on signup; aignummail2 when the org is approved. Placeholders:
# {{user_name}}, {{org_name}}, and (aignummail2) {{login_link}}.
# fixes15 §2.1 adds `shliach_welcome` — the new-shliach/new-user welcome mail,
# seeded with the exact HTML shell of backend/HTML/hello_shliach.html so the
# superadmin can restyle it in the WYSIWYG editor. Placeholders:
# {{first_name}}, {{last_name}}, {{url_to_system}}, {{shliach_email}},
# {{org_name}}, {{logo_url}}.
DEFAULT_EMAIL_TEMPLATES: dict[str, dict[str, str]] = {
    "shliach_welcome": {
        "subject": "Welcome to the system",
        "body_hebrew": "",
        "body": _load_html("hello_shliach.html"),
    },
    # fixes17 §1.3: the signup/registration verification mail, seeded with the
    # exact hello_tenant.html so the superadmin can restyle it. Placeholders:
    # {{first_name}}, {{last_name}}, {{organization_name}}, {{email}},
    # {{phone}}, {{username}}, {{verify_url}}, {{expire_hours}}, {{logo_url}}.
    "tenant_verification": {
        "subject": "אימות חשבון — מיני CRM",
        "body_hebrew": "",
        "body": _load_html("hello_tenant.html"),
    },
    # fixes75 §7: the forgot-password link. Placeholders: {{user_name}},
    # {{org_name}}, {{reset_url}}, {{expire_minutes}}.
    "password_reset": {
        "subject": "איפוס סיסמה / Password reset",
        "body_hebrew": (
            "שלום {{user_name}},\n\n"
            "התקבלה בקשה לאיפוס הסיסמה שלך בארגון \"{{org_name}}\".\n"
            "לבחירת סיסמה חדשה יש להיכנס לקישור הבא (בתוקף {{expire_minutes}} דקות):\n"
            "{{reset_url}}\n\n"
            "אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו."
        ),
        "body": (
            "Hello {{user_name}},\n\n"
            "We received a request to reset your password for \"{{org_name}}\".\n"
            "To choose a new password, open this link (valid for {{expire_minutes}} minutes):\n"
            "{{reset_url}}\n\n"
            "If you didn't ask for this, you can ignore this email."
        ),
    },
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


def _looks_like_html(text: str) -> bool:
    """Heuristic: did the template author paste real HTML (a tag) vs plain text?"""
    return bool(re.search(r"<[a-zA-Z!/][^>]*>", text))


def _text_to_html(text: str) -> str:
    """Escape plain text and turn newlines into <br> for the branded HTML shell."""
    return htmllib.escape(text).replace("\n", "<br>")


def _strip_tags(html_text: str) -> str:
    """Best-effort plain-text fallback from an HTML body."""
    text = re.sub(r"<br\s*/?>", "\n", html_text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return htmllib.unescape(text).strip()


def send_templated_email(
    db: Session,
    key: str,
    to: str,
    from_name: Optional[str] = None,
    reply_to: Optional[str] = None,
    **vars: str,
) -> None:
    """Load an editable template by key (DB, falling back to the default),
    substitute {{vars}}, and send it as an HTML email (with a plain-text fallback).

    If the template body is plain text it's wrapped in the branded shell; if the
    author pasted their own HTML into the box, that HTML is sent verbatim.
    fixes17 §1.3: `from_name`/`reply_to` brand the sender per organization.
    """
    row = db.query(models.EmailTemplate).filter(models.EmailTemplate.key == key).first()
    default = DEFAULT_EMAIL_TEMPLATES.get(key, {})
    subject = _substitute((row.subject if row else default.get("subject", "")), vars)
    body_he = _substitute((row.body_hebrew if row else default.get("body_hebrew", "")), vars)
    body_en = _substitute((row.body if row else default.get("body", "")), vars)

    combined = "\n\n".join(p for p in (body_he, body_en) if p)
    if _looks_like_html(combined):
        # Author-provided HTML — send exactly as pasted in the template box.
        html_body = combined
        text_body = _strip_tags(combined)
    else:
        # Plain-text template — brand it with the shared HTML shell.
        parts: list[str] = []
        if body_he:
            parts.append(
                f'<div dir="rtl" style="text-align:right;font-size:15px;line-height:1.7;">'
                f"{_text_to_html(body_he)}</div>"
            )
        if body_en:
            if parts:
                parts.append(
                    '<hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0;">'
                )
            parts.append(
                f'<div dir="ltr" style="font-size:15px;line-height:1.7;color:#374151;">'
                f"{_text_to_html(body_en)}</div>"
            )
        html_body = render_template(
            "notification.html",
            subject=htmllib.escape(subject),
            content_html="".join(parts),
            logo_url=_logo_url(),
        )
        text_body = combined

    send_email(
        to, subject, text_body, html=html_body,
        from_name=from_name, reply_to=reply_to,
    )


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


def send_email(
    to: str,
    subject: str,
    body: str,
    html: Optional[str] = None,
    from_name: Optional[str] = None,
    reply_to: Optional[str] = None,
) -> None:
    """Send (or dev-log) one email. fixes17 §1.3: `from_name` shows the
    organization's name as the sender (the address itself must stay the
    authenticated SMTP account — Gmail rewrites spoofed senders); `reply_to`
    points replies at the organization's address."""
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
    if from_name:
        # Keep the real (authenticated) address; brand only the display name.
        msg["From"] = formataddr((from_name, parseaddr(settings.email_from)[1]))
    else:
        msg["From"] = settings.email_from
    if reply_to:
        msg["Reply-To"] = reply_to
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


def send_verification_email(db: Session, user, token: str) -> str:
    """Send (or log) the tenant verification link.

    fixes17 §1.3: goes through the superadmin-editable `tenant_verification`
    DB template (seeded with the exact hello_tenant.html; the file remains the
    fallback default). `user` is the pending admin User (has
    email/first_name/last_name/phone/username and an `organization`).
    Returns the link for testing/logging.
    """
    link = f"{settings.frontend_url}/verify?token={token}"
    org_name = user.organization.name if getattr(user, "organization", None) else ""
    send_templated_email(
        db,
        "tenant_verification",
        user.email,
        from_name=org_name or None,
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
    return link


def send_shliach_welcome(
    db: Session,
    to: str,
    first_name: str,
    last_name: str,
    shliach_email: str,
    org_name: str = "",
    reply_to: Optional[str] = None,
) -> None:
    """Send (or log) the access-link email to a newly-created shliach / user.

    fixes15 §2.1: goes through the superadmin-editable `shliach_welcome` DB
    template (seeded with the exact hello_shliach.html), so the WYSIWYG edits
    take effect; the file stays only as the seed/fallback default.
    fixes17 §1.3: sent in the organization's name, with replies routed to the
    admin who created the account."""
    send_templated_email(
        db,
        "shliach_welcome",
        to,
        from_name=org_name or None,
        reply_to=reply_to,
        first_name=first_name,
        last_name=last_name,
        url_to_system=settings.frontend_url,
        shliach_email=shliach_email,
        org_name=org_name,
        logo_url=_logo_url(),
    )


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


def send_password_reset(db: Session, user, reset_url: str, expire_minutes: int) -> None:
    """fixes75 §7: the forgot-password link, in the organization's name."""
    org_name = user.organization.name if getattr(user, "organization", None) else ""
    send_templated_email(
        db,
        "password_reset",
        user.email,
        from_name=org_name or None,
        user_name=user.full_name or user.username or "",
        org_name=org_name,
        reset_url=reset_url,
        expire_minutes=str(expire_minutes),
    )
