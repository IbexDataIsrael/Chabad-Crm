"""fixes98: "messages for activists" + the per-org numbers they quote.

`ensure_stats` is the "calculate once" rule: the first time an organization
needs its stats row (admin config or the activist app loading), the numbers
are computed from live data and stored — and the org's first two messages
(Hebrew + English) are seeded with it. After that the row only changes when
an admin edits it or presses "recalculate".
"""
import datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, picklist_utils
from app.core.jewish_status import JEWISH_STATUS_FIELD_KEY, JEWS_STATUSES

# Placeholders a message may use; replaced on the activist's device.
PLACEHOLDERS = ("organization_name", "number_of_apartments", "number_of_jews")

SEED_MESSAGES = (
    (
        "he",
        "הידעת שבמערכת {organization_name} רשומים כבר {number_of_apartments} אלף דירות "
        "ומתוכם {number_of_jews} יהודים",
    ),
    (
        "en",
        "Did you know? {organization_name} already has {number_of_apartments} thousand "
        "apartments registered, {number_of_jews} of them Jewish",
    ),
)


def compute_stats(db: Session, org: models.Organization) -> dict:
    """Live numbers: active apartments, and those with any Jewish status
    (same definition as the report-number/area "Number of Jews")."""
    base = db.query(models.Apartment.id).filter(
        models.Apartment.organization_id == org.id,
        models.Apartment.is_display.is_(True),
    )
    jews_ids = picklist_utils.matching_entity_ids(
        "apartments", JEWISH_STATUS_FIELD_KEY, JEWS_STATUSES
    )
    return {
        "organization_name": org.name or "",
        "number_of_apartments": base.count(),
        "number_of_jews": base.filter(models.Apartment.id.in_(jews_ids)).count(),
    }


def apply_computed(db: Session, row: models.OrgActivistStats, org: models.Organization) -> None:
    for key, value in compute_stats(db, org).items():
        setattr(row, key, value)
    row.calculated_at = datetime.datetime.utcnow()


def ensure_stats(db: Session, org_id: int) -> models.OrgActivistStats:
    """The org's stats row, created (computed + messages seeded) on first
    use. Commits when it creates the row."""
    row = (
        db.query(models.OrgActivistStats)
        .filter(models.OrgActivistStats.organization_id == org_id)
        .first()
    )
    if row is not None:
        return row
    org = db.get(models.Organization, org_id)
    row = models.OrgActivistStats(organization_id=org_id)
    apply_computed(db, row, org)
    db.add(row)
    has_messages = (
        db.query(models.ActivistMessage.id)
        .filter(models.ActivistMessage.organization_id == org_id)
        .first()
    )
    if not has_messages:
        for language, text in SEED_MESSAGES:
            db.add(models.ActivistMessage(organization_id=org_id, language=language, text=text))
    try:
        db.commit()
    except IntegrityError:  # a concurrent first load created it — use theirs
        db.rollback()
        return (
            db.query(models.OrgActivistStats)
            .filter(models.OrgActivistStats.organization_id == org_id)
            .one()
        )
    db.refresh(row)
    return row
