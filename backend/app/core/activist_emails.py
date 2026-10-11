"""fixes98: emails to activists that aren't superadmin templates.

- Welcome after self-registration (org page / task QR): the standard
  `shliach_welcome` template, with the link pointing at the org's page.
- "A new task has been assigned to you": the org's own Hebrew + English text
  (edited in shliach-config, stored in shliach_view_config), plus per task the
  campaign and either the text-task instructions or the task's first address,
  and the same org-page link. Built on the branded email layouts.

Both run as background tasks after the response, with their own DB session;
a failure is logged and never reaches the request that triggered it.
"""
import html as htmllib
import logging
from typing import Iterable

from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.core import email as mail
from app.core.email_templates import FONT, SYSTEM_FOOTER, build, button, h1, p
from app import database

logger = logging.getLogger("app.email")

# shliach_view_config keys holding the org's task-email text (shliach-config).
TASK_EMAIL_TEXT_KEYS = {"he": "task_email_text_he", "en": "task_email_text_en"}
DEFAULT_TASK_EMAIL_TEXT = {
    "he": "שובצה לך משימה חדשה.",
    "en": "A new task has been assigned to you.",
}


def org_page_url(org: models.Organization) -> str:
    """The organization's public page (sign in / register) — the activist's
    way into the system; the plain system URL when the org has no slug."""
    base = settings.frontend_url.rstrip("/")
    return f"{base}/org/{org.slug}" if org.slug else base


def task_email_texts(org: models.Organization) -> dict[str, str]:
    cfg = org.shliach_view_config if isinstance(org.shliach_view_config, dict) else {}
    return {
        lang: (str(cfg.get(key) or "").strip() or DEFAULT_TASK_EMAIL_TEXT[lang])
        for lang, key in TASK_EMAIL_TEXT_KEYS.items()
    }


def task_first_address(db: Session, task: models.Task) -> str | None:
    """The address of the task's first building (by address, then id)."""
    row = (
        db.query(models.Building.building_address, models.Building.building_name)
        .join(models.Apartment, models.Apartment.building_id == models.Building.id)
        .join(
            models.TaskReportNumber,
            models.TaskReportNumber.report_number_id == models.Apartment.report_number_id,
        )
        .filter(
            models.TaskReportNumber.task_id == task.id,
            models.Apartment.is_display.is_(True),
            models.Apartment.organization_id == task.organization_id,
        )
        .order_by(models.Building.building_address, models.Building.id)
        .first()
    )
    if row is None:
        return None
    return row.building_address or row.building_name


def _task_block(lang: str, campaign: str, detail_label: str, detail: str) -> str:
    """One task's details: campaign + address/instructions, in a light box."""
    align = "right" if lang == "he" else "left"
    cell = f'padding:8px 14px;text-align:{align};font-family:{FONT};font-size:14px;'
    return (
        '                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" dir="{"rtl" if lang == "he" else "ltr"}" style="margin:0 0 12px;'
        'border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">\n'
        f'                  <tr><td style="{cell}color:#64748b;width:30%;">'
        f'{"קמפיין" if lang == "he" else "Campaign"}</td>'
        f'<td style="{cell}color:#0f172a;font-weight:500;">{htmllib.escape(campaign)}</td></tr>\n'
        f'                  <tr><td style="{cell}color:#64748b;border-top:1px solid #e2e8f0;">'
        f"{detail_label}</td>"
        f'<td style="{cell}color:#0f172a;font-weight:500;border-top:1px solid #e2e8f0;'
        f'white-space:pre-wrap;">{htmllib.escape(detail)}</td></tr>\n'
        "                </table>\n"
    )


def build_task_email(
    db: Session, org: models.Organization, user: models.User, tasks: list[models.Task]
) -> tuple[str, str, str]:
    """(subject, text body, html body) for the "new task" email."""
    texts = task_email_texts(org)
    link = org_page_url(org)
    name = user.full_name or user.username or ""
    docs: list[str] = []
    plain: list[str] = []
    for lang in ("he", "en"):
        he = lang == "he"
        blocks = ""
        lines: list[str] = []
        for task in tasks:
            campaign = task.campaign.name if task.campaign else ""
            # A text task shows its instructions; any other task its first address.
            if (task.task_text or "").strip():
                label, detail = ("המשימה" if he else "Task"), task.task_text.strip()
            else:
                label = "כתובת" if he else "Address"
                detail = task_first_address(db, task) or "—"
            blocks += _task_block(lang, campaign, label, detail)
            lines.append(f"{campaign}: {detail}")
        content = (
            h1(lang, "משימה חדשה" if he else "New task")
            + p(lang, ("שלום " if he else "Hello ") + htmllib.escape(name) + ",")
            + p(lang, mail._text_to_html(texts[lang]))
            + blocks
            + button(htmllib.escape(link), "כניסה למערכת" if he else "Open the system")
        )
        title = "משימה חדשה" if he else "New task"
        docs.append(build(lang, title, content, htmllib.escape(org.name or SYSTEM_FOOTER[lang])))
        plain.append(
            "\n".join([("שלום " if he else "Hello ") + name + ",", texts[lang], *lines, link])
        )
    subject = f"משימה חדשה / New task — {org.name}" if org.name else "משימה חדשה / New task"
    logo = mail._org_logo_url(org.logo_url)
    html_body = mail._substitute(
        mail._merge_documents(subject, docs),
        {"logo_url": htmllib.escape(logo), "system_logo_url": htmllib.escape(mail._logo_url())},
    )
    return subject, "\n\n".join(plain), html_body


def send_task_assigned(org_id: int, user_id: int, task_ids: Iterable[int]) -> None:
    """Background task: email the activist about newly assigned task(s)."""
    db = database.SessionLocal()  # looked up per call (tests patch it)
    try:
        user = db.get(models.User, user_id)
        org = db.get(models.Organization, org_id)
        tasks = (
            db.query(models.Task)
            .filter(models.Task.id.in_(list(task_ids)), models.Task.organization_id == org_id)
            .order_by(models.Task.id)
            .all()
        )
        if not user or not org or not tasks or not (user.email or "").strip():
            return
        subject, text, html_body = build_task_email(db, org, user, tasks)
        mail.send_email(user.email, subject, text, html=html_body, from_name=org.name or None)
    except Exception:  # noqa: BLE001 — an email must never break the assignment
        logger.exception("Failed to send task-assigned email to user %s", user_id)
    finally:
        db.close()


def send_registration_welcome(org_id: int, user_id: int) -> None:
    """Background task: the standard welcome email after an activist registers
    themselves (org page or task QR), linking to the org's page."""
    db = database.SessionLocal()  # looked up per call (tests patch it)
    try:
        user = db.get(models.User, user_id)
        org = db.get(models.Organization, org_id)
        if not user or not org or not (user.email or "").strip():
            return
        mail.send_shliach_welcome(
            db,
            to=user.email,
            first_name=user.first_name or user.full_name or "",
            last_name=user.last_name or "",
            shliach_email=user.email,
            org_name=org.name or "",
            org_logo_url=org.logo_url,
            url_to_system=org_page_url(org),
        )
    except Exception:  # noqa: BLE001 — an email must never break registration
        logger.exception("Failed to send registration welcome to user %s", user_id)
    finally:
        db.close()
