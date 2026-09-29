"""fixes74 §12: an activist's street2 work log, and the admin's read-only
view of it.

- `POST /api/street-activity/sync` — the activist's street2 uploads the
  events it recorded (mark / unmark / building_complete, each with the
  device time it happened). An empty upload is a heartbeat. Either way the
  activist's `street_synced_at` moves to now — the admin's "last sync".
- `GET /api/street-activity/{user_id}` — admin / campaign manager: that
  activist's last sync time and their log, newest first.

This is a sync log, not a live GPS tracker: nothing about location is sent
or stored.
"""
import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app import models
from app.core.display import building_display_name
from app.database import get_db
from app.deps import get_current_user, require_admin_or_campaign_manager
from app.schemas import StreetActivityOut, StreetActivitySync, StreetActivityEventOut

router = APIRouter(prefix="/api/street-activity", tags=["street-activity"])

# Events older than this (by device clock) are refused — protects the log
# from a device whose clock is wildly off.
_MAX_EVENT_AGE = datetime.timedelta(days=30)


def _naive_utc(dt: datetime.datetime) -> datetime.datetime:
    """Device timestamps arrive as ISO strings with an offset; the DB stores
    naive UTC like every other timestamp here."""
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def viewed_activist(db: Session, admin: models.User, user_id: int) -> models.User:
    """The activist an admin / campaign manager is viewing as — same org,
    role shliach — or 404."""
    user = (
        db.query(models.User)
        .filter(
            models.User.id == user_id,
            models.User.organization_id == admin.organization_id,
            models.User.role == "shliach",
        )
        .first()
    )
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Activist not found")
    return user


@router.post("/sync", status_code=status.HTTP_204_NO_CONTENT)
def sync_street_activity(
    payload: StreetActivitySync,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != "shliach":
        # Admins viewing an activist never write into anyone's log.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an activist's own app syncs")
    now = datetime.datetime.utcnow()
    org_id = current_user.organization_id
    building_ids = {e.building_id for e in payload.events if e.building_id is not None}
    buildings = {
        b.id: b
        for b in db.query(models.Building).filter(
            models.Building.id.in_(building_ids), models.Building.organization_id == org_id
        )
    } if building_ids else {}
    seen: set[str] = set()
    for e in payload.events:
        # The device retries an upload until it gets a 2xx, so the same event
        # can arrive twice; its client id makes the insert idempotent.
        if e.client_id in seen:
            continue
        seen.add(e.client_id)
        if (
            db.query(models.StreetActivityEvent.id)
            .filter(models.StreetActivityEvent.guid == e.client_id)
            .first()
        ):
            continue
        occurred = _naive_utc(e.occurred_at)
        if occurred > now + datetime.timedelta(minutes=5) or occurred < now - _MAX_EVENT_AGE:
            occurred = now
        building = buildings.get(e.building_id) if e.building_id is not None else None
        db.add(
            models.StreetActivityEvent(
                guid=e.client_id,
                organization_id=org_id,
                user_id=current_user.id,
                event_type=e.event_type,
                apartment_id=e.apartment_id,
                building_id=building.id if building else None,
                label=(e.label or "")[:300] or None,
                occurred_at=occurred,
                synced_at=now,
            )
        )
    current_user.street_synced_at = now
    db.commit()


@router.get("/{user_id}", response_model=StreetActivityOut)
def get_street_activity(
    user_id: int,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    activist = viewed_activist(db, current_user, user_id)
    rows = (
        db.query(models.StreetActivityEvent, models.Building)
        .outerjoin(models.Building, models.Building.id == models.StreetActivityEvent.building_id)
        .filter(models.StreetActivityEvent.user_id == activist.id)
        .order_by(
            models.StreetActivityEvent.occurred_at.desc(), models.StreetActivityEvent.id.desc()
        )
        .limit(limit)
        .all()
    )
    return StreetActivityOut(
        user_id=activist.id,
        full_name=activist.full_name,
        last_sync_at=activist.street_synced_at,
        events=[
            StreetActivityEventOut(
                id=e.id,
                event_type=e.event_type,
                apartment_id=e.apartment_id,
                building_id=e.building_id,
                building_label=building_display_name(b) if b else None,
                label=e.label,
                occurred_at=e.occurred_at,
                synced_at=e.synced_at,
            )
            for e, b in rows
        ],
    )
