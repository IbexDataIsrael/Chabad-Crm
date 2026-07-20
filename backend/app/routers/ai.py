"""AI chat grounded in the organization's CRM data.

Every request injects a compact, org-scoped snapshot of the database (contacts
with their admin areas and statuses, areas/buildings/apartments counts, recent
visits, donation totals) into the system prompt, so the model answers from the
real data instead of inventing. Shliach users get only the contacts they may
see. Completion is done via OpenRouter with the model configured in settings.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, picklist_utils
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.routers.contacts import _contacts_query
from app.schemas import AiChatRequest, AiChatResponse

logger = logging.getLogger("app.ai")

router = APIRouter(prefix="/api/ai", tags=["ai"])

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# The client resends the whole conversation each turn; cap what we forward.
MAX_HISTORY_MESSAGES = 20
REQUEST_TIMEOUT_SECONDS = 60
# Free models are routinely rate-limited upstream (429); when the configured
# model is busy we fall through this list instead of failing the chat.
FALLBACK_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen3-next-80b-a3b-instruct:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-31b-it:free",
]
# Snapshot caps — keep the injected context well inside the model's window.
MAX_CONTACT_LINES = 300
MAX_VISIT_LINES = 20


def _count(db: Session, model, org_id: int) -> int:
    return (
        db.query(func.count(model.id))
        .filter(model.organization_id == org_id)
        .scalar()
        or 0
    )


def _contact_lines(db: Session, current_user: models.User) -> tuple[list[str], int]:
    """Compact one-per-contact lines, scoped exactly like the contacts list
    (shliach users only see their covered contacts)."""
    query = (
        _contacts_query(db, current_user, None, None, None)
        .outerjoin(
            models.ContactMekurav,
            models.ContactMekurav.contact_id == models.Contact.id,
        )
        .outerjoin(
            models.AdminArea,
            models.AdminArea.id == models.ContactMekurav.admin_area_id,
        )
        .add_columns(
            models.ContactMekurav.tzedaka_potential,
            models.AdminArea.name.label("admin_area_name"),
        )
        .order_by(models.Contact.name)
    )
    total = query.count()
    rows = list(query.limit(MAX_CONTACT_LINES))
    picklist_map = picklist_utils.get_values_bulk(
        db, current_user.organization_id, "contacts",
        [contact.id for contact, _, _ in rows], ["contact.pipeline_status"],
    )
    lines = []
    for contact, tzedaka, admin_area in rows:
        full_name = f"{contact.name} {contact.last_name or ''}".strip()
        parts = [full_name, contact.contact_type]
        if contact.phone:
            parts.append(contact.phone)
        pipeline_status = picklist_map.get(contact.id, {}).get("contact.pipeline_status")
        if pipeline_status:
            parts.append(f"סטטוס: {pipeline_status}")
        if admin_area:
            parts.append(f"אזור מנהל: {admin_area}")
        if tzedaka:
            parts.append(f"פוטנציאל צדקה: {tzedaka}")
        lines.append("- " + " | ".join(parts))
    return lines, total


def _org_snapshot(db: Session, current_user: models.User) -> str:
    """A compact textual snapshot of the organization's CRM data."""
    org_id = current_user.organization_id
    org = db.get(models.Organization, org_id)
    contact_lines, contact_total = _contact_lines(db, current_user)

    out = [f"ארגון: {org.name if org else org_id}"]

    # Shliach users get only their scoped contacts — no org-wide aggregates.
    if current_user.role != "shliach":
        mekurav = (
            db.query(func.count(models.Contact.id))
            .filter(
                models.Contact.organization_id == org_id,
                models.Contact.contact_type == "mekurav",
            )
            .scalar()
            or 0
        )
        donations_count, donations_sum = (
            db.query(func.count(models.Donation.id), func.sum(models.Donation.amount))
            .filter(models.Donation.organization_id == org_id)
            .one()
        )
        out.append(
            "סיכום: "
            f"אנשי קשר {contact_total} (מקורבים {mekurav}) | "
            f"אזורים {_count(db, models.Area, org_id)} | "
            f"בניינים {_count(db, models.Building, org_id)} | "
            f"דירות {_count(db, models.Apartment, org_id)} | "
            f"אזורי מנהל {_count(db, models.AdminArea, org_id)} | "
            f"ביקורים {_count(db, models.VisitHistory, org_id)} | "
            f"תרומות {donations_count or 0} בסך {donations_sum or 0}"
        )

        area_rows = (
            db.query(models.Area.area_name, func.count(models.Building.id))
            .outerjoin(models.Building, models.Building.area_id == models.Area.id)
            .filter(models.Area.organization_id == org_id)
            .group_by(models.Area.id)
            .order_by(models.Area.area_name)
            .all()
        )
        if area_rows:
            out.append(
                "אזורים (מספר בניינים): "
                + ", ".join(f"{name} ({n})" for name, n in area_rows)
            )

        admin_area_rows = (
            db.query(models.AdminArea.name, func.count(models.ContactMekurav.id))
            .outerjoin(
                models.ContactMekurav,
                models.ContactMekurav.admin_area_id == models.AdminArea.id,
            )
            .filter(models.AdminArea.organization_id == org_id)
            .group_by(models.AdminArea.id)
            .order_by(models.AdminArea.name)
            .all()
        )
        if admin_area_rows:
            out.append(
                "אזורי מנהל (מספר אנשי קשר): "
                + ", ".join(f"{name} ({n})" for name, n in admin_area_rows)
            )

        visit_rows = (
            db.query(models.VisitHistory, models.Contact.name)
            .outerjoin(models.Contact, models.Contact.id == models.VisitHistory.contact_id)
            .filter(models.VisitHistory.organization_id == org_id)
            .order_by(models.VisitHistory.visit_date.desc())
            .limit(MAX_VISIT_LINES)
            .all()
        )
        if visit_rows:
            out.append(f"ביקורים אחרונים (עד {MAX_VISIT_LINES}):")
            for visit, contact_name in visit_rows:
                note = (visit.notes or "").strip().replace("\n", " ")[:80]
                out.append(
                    f"- {visit.visit_date.date().isoformat()} | "
                    f"{contact_name or 'ללא איש קשר'}" + (f" | {note}" if note else "")
                )

    shown = min(contact_total, MAX_CONTACT_LINES)
    out.append(f"אנשי קשר ({shown} מתוך {contact_total}):")
    out.extend(contact_lines)
    if contact_total > MAX_CONTACT_LINES:
        out.append(f"(+{contact_total - MAX_CONTACT_LINES} אנשי קשר נוספים לא מוצגים)")
    return "\n".join(out)


def _system_prompt(db: Session, current_user: models.User) -> str:
    return (
        "You are the CRM assistant for this organization. Answer the user's "
        "questions using ONLY the live data snapshot below. Be concise and "
        "accurate: compute counts and sums from the snapshot when asked, prefer "
        "short bullet lists for listings, and if the answer is not in the "
        "snapshot say the data isn't available instead of inventing. Note the "
        "contact list may be truncated — say so when a total exceeds what is "
        "shown. Answer in the language the question was asked in (Hebrew or "
        "English).\n\n--- CRM DATA SNAPSHOT ---\n"
        + _org_snapshot(db, current_user)
    )


@router.post("/chat", response_model=AiChatResponse)
def chat(
    payload: AiChatRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if not settings.openrouter_api_key:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "AI chat is not configured (OPENROUTER_API_KEY is missing)",
        )
    history = [
        {"role": m.role, "content": m.content}
        for m in payload.messages[-MAX_HISTORY_MESSAGES:]
        if m.role in ("user", "assistant") and m.content.strip()
    ]
    if not history:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "No messages")

    messages = [
        {"role": "system", "content": _system_prompt(db, current_user)}
    ] + history

    # Try the configured model, then the free fallbacks — upstream rate limits
    # (429) and transient 5xx move on to the next candidate.
    candidates = list(dict.fromkeys([settings.openrouter_model, *FALLBACK_MODELS]))
    response = None
    for model in candidates:
        try:
            response = httpx.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": model, "messages": messages},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            logger.warning("OpenRouter request failed (%s): %s", model, exc)
            response = None
            continue
        if response.status_code == 200:
            break
        logger.warning(
            "OpenRouter error %s on %s: %s",
            response.status_code,
            model,
            response.text[:300],
        )
        if response.status_code not in (404, 429, 500, 502, 503):
            # Auth/request errors won't improve with a different model.
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"AI service returned an error ({response.status_code})",
            )
        response = None

    if response is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "שירות ה-AI עמוס כרגע — נסה שוב בעוד דקה",
        )

    data = response.json()
    try:
        reply = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        logger.warning("Unexpected OpenRouter response shape: %s", str(data)[:500])
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Unexpected AI response")
    return AiChatResponse(reply=reply or "")
