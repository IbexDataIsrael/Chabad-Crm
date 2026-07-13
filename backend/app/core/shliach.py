"""Resolve the shliach ContactShliach record for a logged-in shliach user.

A shliach contact is normally bound to its login user via
`ContactShliach.user_id` (set when the login is provisioned). But that link can
be missing: imported shliach contacts get no login user (the data import
provisions none), and a login created separately afterwards is never wired to
the contact. When the link is absent, resolving the shliach by `user_id` alone
returns nothing, so the shliach sees **zero** apartments/areas even when a
report number (or area) is assigned to their contact — fixes21 §1.

Fall back to matching the shliach contact by the login user's email within the
same organization, which covers those unlinked cases.
"""
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models


def resolve_shliach(
    db: Session, user: models.User
) -> Optional[models.ContactShliach]:
    """The shliach contact for `user`: by the user_id link, else by email."""
    shliach = (
        db.query(models.ContactShliach)
        .filter(
            models.ContactShliach.user_id == user.id,
            models.ContactShliach.organization_id == user.organization_id,
        )
        .first()
    )
    if shliach:
        return shliach
    if user.email:
        shliach = (
            db.query(models.ContactShliach)
            .join(
                models.Contact,
                models.Contact.id == models.ContactShliach.contact_id,
            )
            .filter(
                models.ContactShliach.organization_id == user.organization_id,
                func.lower(models.Contact.email) == user.email.strip().lower(),
            )
            .first()
        )
    return shliach
