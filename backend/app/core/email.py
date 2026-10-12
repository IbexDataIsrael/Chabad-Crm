"""Email sending with optional HTML templates.

When `SMTP_HOST` is unset (the dev default), emails are logged to the console
instead of sent — the link is printed so you can copy it. HTML templates live in
the `/HTML` directory (repo `backend/HTML`): one English (LTR) and one Hebrew
(RTL) branded layout; `{{placeholders}}` are substituted.
"""
import html as htmllib
import json
import logging
import re
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.core.email_templates import (  # noqa: F401 — re-exported for seed.py
    DEFAULT_EMAIL_TEMPLATES,
    LEGACY_BODY_FINGERPRINTS,
    button as email_button,
    fingerprint,
    notification_html,
)

logger = logging.getLogger("app.email")

# The superadmin-editable templates (platform-level). Seeded into the
# email_templates table on startup; these are the fallback defaults. Each has a
# Hebrew (RTL) and an English (LTR) full HTML document, both built from the
# branded layouts in /HTML — see app/core/email_templates.py. The sent email is
# the Hebrew document followed by the English one.
# Keys: aignummail1 (signup received), aignummail2 (org approved),
# shliach_welcome (new activist/user), tenant_verification (signup email
# confirmation), password_reset.

# Subjects that shipped earlier. seed_email_templates upgrades a stored row to
# the current default only while it still holds one of these exact old texts —
# a subject the superadmin edited is left alone.
LEGACY_EMAIL_SUBJECTS: dict[str, list[str]] = {
    "aignummail1": [
        "בקשתך התקבלה — מיני CRM",
        "בקשתך התקבלה / Request received — מיני CRM",
    ],
    "aignummail2": [
        "הארגון אושר — מיני CRM",
        "הארגון אושר / Organization approved — מיני CRM",
    ],
    # fixes90: the welcome title is now "Welcome to Jewish Points".
    "shliach_welcome": ["Welcome to the system"],
    "tenant_verification": ["אימות חשבון — מיני CRM"],
}

# fixes90: exact snippets of a shipped default body that a later default
# replaced. seed_email_templates swaps one only while a stored body still
# contains the old snippet verbatim — a body the superadmin edited (or that
# no longer has it) is left alone.
LEGACY_EMAIL_BODY_SNIPPETS: dict[str, list[tuple[str, str]]] = {
    "shliach_welcome": [
        (
            '<h1 style="margin:0 0 16px;font-size:22px;color:#1f2937;">Welcome to the system</h1>',
            '<h1 dir="rtl" style="margin:0 0 4px;font-size:22px;color:#1f2937;text-align:right;">'
            "ברוכים הבאים לנקודות יהודיות</h1>\n"
            '             <h1 style="margin:0 0 16px;font-size:22px;color:#1f2937;">'
            "Welcome to Jewish Points</h1>",
        ),
    ],
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
    text = re.sub(r"<(head|style|title)\b.*?</\1>", "", html_text, flags=re.I | re.S)
    text = re.sub(r"<br\s*/?>|</(p|h1|h2|tr|table|div)>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = htmllib.unescape(text)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


_FULL_DOC = re.compile(r"<html[\s>]|<!doctype", re.IGNORECASE)
_BODY = re.compile(r"<body[^>]*>(.*)</body>", re.IGNORECASE | re.DOTALL)


def _merge_documents(subject: str, docs: list[str]) -> str:
    """One email from several full HTML documents (Hebrew RTL first, then
    English LTR): each document's <body> content stacked in one shell."""
    inner = [m.group(1) if (m := _BODY.search(d)) else d for d in docs]
    return (
        '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
        '<meta name="color-scheme" content="light only" />\n'
        f"<title>{htmllib.escape(subject)}</title>\n"
        '<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;700'
        '&amp;display=swap" rel="stylesheet" />\n'
        '</head>\n<body style="margin:0;padding:0;background:#f5f6f9;">\n'
        + "\n".join(inner)
        + "\n</body>\n</html>\n"
    )


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

    The Hebrew (RTL) and English (LTR) bodies are each a full branded HTML
    document; the sent mail stacks the Hebrew one above the English one. A
    plain-text body is wrapped in the branded shell instead; other pasted HTML
    is sent as-is. `{{logo_url}}` defaults to the platform logo (callers pass the
    organization's logo for activist mail); `{{system_logo_url}}` is always it.
    fixes17 §1.3: `from_name`/`reply_to` brand the sender per organization.
    """
    vars.setdefault("logo_url", _logo_url())
    vars["system_logo_url"] = _logo_url()
    row = db.query(models.EmailTemplate).filter(models.EmailTemplate.key == key).first()
    default = DEFAULT_EMAIL_TEMPLATES.get(key, {})
    raw_subject = row.subject if row else default.get("subject", "")
    raw_he = row.body_hebrew if row else default.get("body_hebrew", "")
    raw_en = row.body if row else default.get("body", "")
    subject = _substitute(raw_subject, vars)

    if _looks_like_html(raw_he + raw_en):
        # Values land inside HTML — escape them (names, emails, URLs).
        esc = {k: htmllib.escape(v or "") for k, v in vars.items()}
        body_he, body_en = _substitute(raw_he, esc), _substitute(raw_en, esc)
        docs = [b for b in (body_he, body_en) if b.strip()]
        if len(docs) > 1 and all(_FULL_DOC.search(d) for d in docs):
            html_body = _merge_documents(subject, docs)
        else:
            html_body = "\n\n".join(docs)
        text_body = "\n\n".join(_strip_tags(d) for d in docs)
    else:
        # Plain-text template — brand it with the shared HTML shell.
        body_he, body_en = _substitute(raw_he, vars), _substitute(raw_en, vars)
        parts: list[str] = []
        if body_he:
            parts.append(
                f'<div dir="rtl" style="text-align:right;font-size:15px;line-height:1.7;">'
                f"{_text_to_html(body_he)}</div>"
            )
        if body_en:
            if parts:
                parts.append(
                    '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">'
                )
            parts.append(
                f'<div dir="ltr" style="font-size:15px;line-height:1.7;color:#334155;">'
                f"{_text_to_html(body_en)}</div>"
            )
        html_body = render_notification(subject, "".join(parts))
        text_body = "\n\n".join(p for p in (body_he, body_en) if p)

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


def _org_logo_url(logo_url: Optional[str]) -> str:
    """The organization's own logo for activist mail, else the platform logo."""
    return (logo_url or "").strip() or _logo_url()


def render_notification(subject: str, content_html: str) -> str:
    """The branded shell around code-built content (subject is escaped)."""
    return _substitute(
        notification_html(htmllib.escape(subject), content_html),
        {"logo_url": _logo_url(), "system_logo_url": _logo_url()},
    )


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
    DB template. A pending signup has no branding yet — platform logo. `user` is the pending admin User (has
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
    org_logo_url: Optional[str] = None,
    url_to_system: Optional[str] = None,
) -> None:
    """Send (or log) the access-link email to a newly-created shliach / user.

    fixes15 §2.1: goes through the superadmin-editable `shliach_welcome` DB
    template, so the WYSIWYG edits take effect. Activist mail: the header shows
    the organization's logo (platform logo when the org has none).
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
        # fixes98: self-registered activists get their org's page instead.
        url_to_system=url_to_system or settings.frontend_url,
        shliach_email=shliach_email,
        org_name=org_name,
        logo_url=_org_logo_url(org_logo_url),
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


# fixes81 §3 / fixes100: superadmin-configured recipient lists, each a JSON
# list of addresses in system_settings — who is emailed when a new
# organization signs up, and who gets every server-error alert.
PENDING_SIGNUP_EMAILS_KEY = "pending_signup_notify_emails"
ERROR_NOTIFY_EMAILS_KEY = "error_notify_emails"
NOTIFY_EMAIL_KEYS = (PENDING_SIGNUP_EMAILS_KEY, ERROR_NOTIFY_EMAILS_KEY)


def get_notify_emails(db: Session, key: str) -> list[str]:
    row = db.query(models.SystemSetting).filter(models.SystemSetting.key == key).first()
    if row is None or not row.value.strip():
        return []
    try:
        value = json.loads(row.value)
    except ValueError:
        return []
    return [e for e in value if isinstance(e, str) and e.strip()] if isinstance(value, list) else []


def set_notify_emails(db: Session, key: str, emails: list[str]) -> list[str]:
    """Store a lowercased, de-duplicated list (order kept). Caller commits."""
    clean: list[str] = []
    for e in emails:
        e = e.strip().lower()
        if e and e not in clean:
            clean.append(e)
    row = db.query(models.SystemSetting).filter(models.SystemSetting.key == key).first()
    if row is None:
        row = models.SystemSetting(key=key)
        db.add(row)
    row.value = json.dumps(clean)
    return clean


def platform_notify_recipients(db: Session, key: str) -> list[str]:
    """fixes100: the superadmin's configured list is the source of truth. Only
    while it is still empty do the env addresses (PLATFORM_ADMIN_EMAIL,
    SUPERADMIN_EMAIL) stand in, so a fresh install never mails nobody."""
    configured = get_notify_emails(db, key)
    if configured:
        return configured
    out: list[str] = []
    for addr in (settings.platform_admin_email, settings.superadmin_email):
        addr = (addr or "").strip().lower()
        if addr and addr not in out:
            out.append(addr)
    return out


def send_org_pending_admin(
    org_id: int,
    org_name: str,
    user_name: str,
    user_email: str,
    recipients: Iterable[str],
) -> None:
    """Notify the platform operators that a new org awaits approval, with a
    link that opens the system-admin page on that org's approve prompt (login
    first if needed — the ?redirect deep link keeps the query).
    fixes100: `recipients` = platform_notify_recipients(PENDING_SIGNUP_EMAILS_KEY)."""
    recipients = [r for r in recipients if r]
    if not recipients:
        logger.warning("no new-organization notify emails configured — skipping admin notification")
        return
    approve_url = f"{settings.frontend_url.rstrip('/')}/dashboard/admin?approve={org_id}"
    subject = f"ארגון חדש ממתין לאישור / New organization pending approval — {org_name}"
    body_he = (
        f'ארגון חדש "{org_name}" נרשם וממתין לאישור.\n'
        f"מנהל: {user_name} ({user_email}).\n"
        f"לאישור הארגון: {approve_url}"
    )
    body_en = (
        f'A new organization "{org_name}" has signed up and is pending approval.\n'
        f"Admin: {user_name} ({user_email}).\n"
        f"Approve it here: {approve_url}"
    )
    content_html = (
        f'<div dir="rtl" style="text-align:right;font-size:15px;line-height:1.7;">'
        f"{_text_to_html(body_he.rsplit(chr(10), 1)[0])}</div>"
        f"{email_button(htmllib.escape(approve_url), 'אישור הארגון / Approve organization')}"
        f'<div dir="ltr" style="font-size:15px;line-height:1.7;color:#334155;">'
        f"{_text_to_html(body_en.rsplit(chr(10), 1)[0])}</div>"
    )
    html_body = render_notification(subject, content_html)
    for to in recipients:
        send_email(to, subject, f"{body_he}\n\n{body_en}", html=html_body)


def send_password_reset(db: Session, user, reset_url: str, expire_minutes: int) -> None:
    """fixes75 §7: the forgot-password link, in the organization's name."""
    org = getattr(user, "organization", None)
    org_name = org.name if org else ""
    send_templated_email(
        db,
        "password_reset",
        user.email,
        from_name=org_name or None,
        logo_url=_org_logo_url(org.logo_url if org else None),
        user_name=user.full_name or user.username or "",
        org_name=org_name,
        reset_url=reset_url,
        expire_minutes=str(expire_minutes),
    )
