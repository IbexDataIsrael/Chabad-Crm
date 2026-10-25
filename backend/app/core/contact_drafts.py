"""fixes113: the one place a draft (mekurav) contact is created, shared by the
Instinct API (POST /api/instinct/contacts) and the assistant's confirmed
proposals (POST /api/assistant/proposals/{id}/confirm).

Drafts stay out of the regular contacts lists until approved
(POST /api/contacts/{id}/approve)."""
from typing import Optional

from sqlalchemy.orm import Session

from app import models
from app.routers.contacts import _check_phone_unique, _geocode_fallback

# Column limits on contacts (models.Contact) for the fields a draft takes.
DRAFT_FIELD_MAX_LENGTH = {"name": 150, "last_name": 100, "phone": 50, "email": 255}


def create_draft_contact(
    db: Session,
    org_id: int,
    data: dict,
    *,
    source: str,
    assigned_user_id: Optional[str] = None,
) -> models.Contact:
    """Insert a draft mekurav contact + its ContactMekurav row (flush, no
    commit — the caller owns the transaction). `data` holds the already
    normalized name / last_name / phone / address / email. Same rules as a
    regular create: phone unique per org, server-side geocode fallback."""
    data = dict(data)
    if data.get("phone"):
        _check_phone_unique(db, org_id, data["phone"])
    _geocode_fallback(data)

    contact = models.Contact(
        **data,
        organization_id=org_id,
        contact_type="mekurav",
        source=source,
        status="draft",
        assigned_user_id=assigned_user_id,
    )
    db.add(contact)
    db.flush()
    db.add(models.ContactMekurav(organization_id=org_id, contact_id=contact.id))
    db.flush()
    return contact
