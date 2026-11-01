"""fixes117: one free-text search for the chat helper (`GET /api/assistant/search`).

People and apartments only — no buildings, areas, streets or users. JWT only:
user and organization come from the token.

- People: the same matching as the global search (routers/search.py — name,
  last name, phone, email). Only the roles that may open contacts get them:
  admin and staff, org-wide. An activist (shliach) and a campaign manager get
  apartments only — the helper's rule, stricter than the global search, which
  shows an activist their own contacts under the org's mekurav opt-in.
  Drafts are included (as in the global search) and say so: `status` plus a
  `status_label` in the user's language (fixes118), null for an active contact.
- Apartments: the visibility and the object shape of
  GET /api/assistant/apartments/search (active versions only, no Instinct
  drafts, an activist sees only assigned apartments; each result carries its
  `editable_fields`). Matching is the global search's fields (number, notes,
  resident name, phone) plus the building address the apartment search
  already matches.
- `can_add_person`: today's create-contact permission, the same rule the
  proposals endpoint enforces (`forbid_campaign_manager`). It reports the
  permission only; whether the helper offers to add someone is its decision.

Strictly per organization: the platform superadmin is refused (403).
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.core.user_locale import pick, user_locale
from app.deps import require_org_user
from app.routers.assistant_apartments import SEARCH_LIMIT, _views, _visible_query

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

MIN_QUERY_LEN = 2
# Roles that may see contacts through the helper.
PEOPLE_ROLES = ("admin", "staff")
DRAFT_LABEL_KEY = "contacts.draft_badge"  # the contacts page's own draft badge


def _draft_label(db: Session, user: models.User) -> str:
    row = (
        db.query(models.FieldLocalization)
        .filter(models.FieldLocalization.technical_name == DRAFT_LABEL_KEY)
        .first()
    )
    he, en = (row.hebrew_label, row.english_label) if row else ("טיוטה", "Draft")
    return pick(user_locale(db, user), he, en)


def _people(db: Session, user: models.User, q: str) -> tuple[list[dict], bool]:
    if user.role not in PEOPLE_ROLES:
        return [], False
    C = models.Contact
    rows = (
        db.query(C)
        .filter(
            C.organization_id == user.organization_id,
            or_(
                C.name.icontains(q, autoescape=True),
                C.last_name.icontains(q, autoescape=True),
                C.phone.icontains(q, autoescape=True),
                C.email.icontains(q, autoescape=True),
            ),
        )
        .order_by(C.name, C.last_name, C.id)
        .limit(SEARCH_LIMIT + 1)
        .all()
    )
    draft = _draft_label(db, user)
    people = [
        {
            "id": c.id,
            "name": c.name,
            "last_name": c.last_name,
            "phone": c.phone,
            "address": c.address,
            "status": c.status,
            "status_label": draft if c.status == "draft" else None,
        }
        for c in rows[:SEARCH_LIMIT]
    ]
    return people, len(rows) > SEARCH_LIMIT


def _apartments(db: Session, user: models.User, q: str) -> tuple[list[dict], bool]:
    query = _visible_query(db, user)
    if query is None:
        return [], False
    A, B = models.Apartment, models.Building
    rows = (
        query.join(B, B.id == A.building_id)
        .filter(
            or_(
                B.building_address.icontains(q, autoescape=True),
                A.apartment_name.icontains(q, autoescape=True),
                A.apartment_notes.icontains(q, autoescape=True),
                A.name.icontains(q, autoescape=True),
                A.phone.icontains(q, autoescape=True),
            )
        )
        .order_by(B.building_address, A.apartment_name, A.id)
        .limit(SEARCH_LIMIT + 1)
        .all()
    )
    return _views(db, user, rows[:SEARCH_LIMIT]), len(rows) > SEARCH_LIMIT


@router.get("/search")
def assistant_search(
    q: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_org_user),
):
    term = q.strip()
    if len(term) < MIN_QUERY_LEN:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Search needs at least 2 characters")
    people, people_truncated = _people(db, current_user, term)
    apartments, apartments_truncated = _apartments(db, current_user, term)
    return {
        "people": people,
        "apartments": apartments,
        "people_truncated": people_truncated,
        "apartments_truncated": apartments_truncated,
        "can_add_person": current_user.role != "campaign_manager",
    }
