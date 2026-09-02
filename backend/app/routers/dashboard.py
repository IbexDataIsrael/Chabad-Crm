"""Admin dashboard summary — the new admin-role home page (chat-originated,
no fixesN spec). Aggregates recent activity across contacts, apartments,
activist (shliach) edits, and Jewish-status changes on apartments. Admin/
staff-only (blocked for shliach — see require_staff_or_admin), org-scoped,
read-only — no new persisted state.

Apartments/ContactShliach are versioned (fixesN §versioning): an edit retires
the current row (is_display=False, stamped with last_edit/editor_id) and
inserts a new active row carrying the same `created_at` forward. That means:
- `Apartment.created_at` genuinely reflects the lineage's original creation
  date (never bumped by an edit), so counting `is_display=True` rows by
  `created_at` gives real "new apartments" counts, not edit noise.
- "Who/when was this apartment last touched" is `editor_id`/`last_edit` on
  the row that got RETIRED by that edit (it's stamped at retirement time).
- Detecting a Jewish-status CHANGE requires comparing the retired row's
  picklist_links value against its immediate successor's — see
  `_jewish_status_changes` below.
"""
import datetime
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models, picklist_utils
from app.core.jewish_status import JEWISH_STATUS_FIELD_KEY
from app.database import get_db
from app.deps import require_staff_or_admin
from app.schemas import (
    DashboardActivistActivity,
    DashboardJewishStatusBreakdownItem,
    DashboardJewishStatusChange,
    DashboardStat,
    DashboardSummaryOut,
    DashboardTrendPoint,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _apartment_label(a: models.Apartment) -> str:
    label = f"{a.apartment_name or ''}{a.floor or ''}".strip()
    return label or a.name or f"#{a.id}"


def _jewish_status_changes(
    db: Session, org_id: int, window_start: datetime.datetime, now: datetime.datetime
):
    """Every apartment edit retired in [window_start, now) whose Jewish-status
    value differs from what it was carrying — i.e. an edit that actually
    changed the field, not just any edit. Returns (retired_row, old_value,
    new_value) triples, newest first."""
    retired = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.organization_id == org_id,
            models.Apartment.is_display.is_(False),
            models.Apartment.last_edit >= window_start,
            models.Apartment.last_edit < now,
        )
        .all()
    )
    if not retired:
        return []

    # Pull every row (both display states) in each lineage touched, so the
    # immediate successor of each retired row can be found without N+1
    # queries — bounded by the (recency-filtered) retired set, not the full
    # apartments table.
    roots = {r.root_id or r.id for r in retired}
    lineage_rows = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.organization_id == org_id,
            or_(models.Apartment.root_id.in_(roots), models.Apartment.id.in_(roots)),
        )
        .all()
    )
    by_lineage: dict[int, list[models.Apartment]] = defaultdict(list)
    for row in lineage_rows:
        by_lineage[row.root_id or row.id].append(row)
    for rows in by_lineage.values():
        rows.sort(key=lambda r: r.id)

    pairs: list[tuple[models.Apartment, models.Apartment]] = []
    for r in retired:
        lineage = by_lineage[r.root_id or r.id]
        successor = next((row for row in lineage if row.id > r.id), None)
        if successor is not None:
            pairs.append((r, successor))

    all_ids = [rid for pair in pairs for rid in (pair[0].id, pair[1].id)]
    values = picklist_utils.get_values_bulk(
        db, org_id, "apartments", all_ids, [JEWISH_STATUS_FIELD_KEY]
    )

    changes = []
    for old_row, new_row in pairs:
        old_value = values.get(old_row.id, {}).get(JEWISH_STATUS_FIELD_KEY)
        new_value = values.get(new_row.id, {}).get(JEWISH_STATUS_FIELD_KEY)
        if old_value != new_value:
            changes.append((old_row, old_value, new_value))
    changes.sort(key=lambda c: c[0].last_edit or c[0].id, reverse=True)
    return changes


@router.get("/summary", response_model=DashboardSummaryOut)
def dashboard_summary(
    days: int = 30,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_staff_or_admin),
):
    org_id = admin.organization_id
    now = datetime.datetime.utcnow()
    start = now - datetime.timedelta(days=days)
    prev_start = start - datetime.timedelta(days=days)

    def _count_contacts(range_start, range_end) -> int:
        return (
            db.query(func.count(models.Contact.id))
            .filter(
                models.Contact.organization_id == org_id,
                models.Contact.created_at >= range_start,
                models.Contact.created_at < range_end,
            )
            .scalar()
            or 0
        )

    def _count_apartments(range_start, range_end) -> int:
        return (
            db.query(func.count(models.Apartment.id))
            .filter(
                models.Apartment.organization_id == org_id,
                models.Apartment.is_display.is_(True),
                models.Apartment.created_at >= range_start,
                models.Apartment.created_at < range_end,
            )
            .scalar()
            or 0
        )

    def _count_activist_edits(range_start, range_end) -> int:
        return (
            db.query(func.count(models.Apartment.id))
            .join(models.User, models.User.id == models.Apartment.editor_id)
            .filter(
                models.Apartment.organization_id == org_id,
                models.Apartment.is_display.is_(False),
                models.Apartment.last_edit >= range_start,
                models.Apartment.last_edit < range_end,
                models.User.role == "shliach",
            )
            .scalar()
            or 0
        )

    new_contacts = DashboardStat(
        value=_count_contacts(start, now),
        previous_value=_count_contacts(prev_start, start),
    )
    new_apartments = DashboardStat(
        value=_count_apartments(start, now),
        previous_value=_count_apartments(prev_start, start),
    )
    activist_edits = DashboardStat(
        value=_count_activist_edits(start, now),
        previous_value=_count_activist_edits(prev_start, start),
    )

    # --- daily trend: contacts + apartments created per day, last `days` ---
    contact_rows = (
        db.query(func.date(models.Contact.created_at), func.count(models.Contact.id))
        .filter(
            models.Contact.organization_id == org_id,
            models.Contact.created_at >= start,
        )
        .group_by(func.date(models.Contact.created_at))
        .all()
    )
    apartment_rows = (
        db.query(func.date(models.Apartment.created_at), func.count(models.Apartment.id))
        .filter(
            models.Apartment.organization_id == org_id,
            models.Apartment.is_display.is_(True),
            models.Apartment.created_at >= start,
        )
        .group_by(func.date(models.Apartment.created_at))
        .all()
    )
    contact_by_day = {str(d): c for d, c in contact_rows}
    apartment_by_day = {str(d): c for d, c in apartment_rows}
    trend = []
    for i in range(days):
        day_key = str((start + datetime.timedelta(days=i)).date())
        trend.append(
            DashboardTrendPoint(
                date=day_key,
                contacts=contact_by_day.get(day_key, 0),
                apartments=apartment_by_day.get(day_key, 0),
            )
        )

    # --- top activists by apartment edits in the window ---
    top_rows = (
        db.query(models.User.id, models.User.full_name, func.count(models.Apartment.id))
        .join(models.Apartment, models.Apartment.editor_id == models.User.id)
        .filter(
            models.Apartment.organization_id == org_id,
            models.Apartment.is_display.is_(False),
            models.Apartment.last_edit >= start,
            models.Apartment.last_edit < now,
            models.User.role == "shliach",
        )
        .group_by(models.User.id, models.User.full_name)
        .order_by(func.count(models.Apartment.id).desc())
        .limit(6)
        .all()
    )
    top_activists = [
        DashboardActivistActivity(user_id=uid, name=name, edits=edits)
        for uid, name, edits in top_rows
    ]

    # --- Jewish-status changes: current window + previous window (for the delta) ---
    current_changes = _jewish_status_changes(db, org_id, start, now)
    previous_changes = _jewish_status_changes(db, org_id, prev_start, start)
    jewish_status_changes = DashboardStat(
        value=len(current_changes), previous_value=len(previous_changes)
    )

    breakdown_counts: dict[str | None, int] = defaultdict(int)
    for _row, _old, new_value in current_changes:
        breakdown_counts[new_value] += 1
    jewish_status_breakdown = [
        DashboardJewishStatusBreakdownItem(value=value, count=count)
        for value, count in sorted(breakdown_counts.items(), key=lambda kv: -kv[1])
    ]

    building_ids = {row.building_id for row, _o, _n in current_changes[:10]}
    buildings = {
        b.id: b
        for b in db.query(models.Building).filter(models.Building.id.in_(building_ids)).all()
    } if building_ids else {}
    recent_jewish_changes = [
        DashboardJewishStatusChange(
            apartment_id=row.id,
            label=_apartment_label(row),
            building_address=(buildings.get(row.building_id).building_address if buildings.get(row.building_id) else None),
            old_value=old_value,
            new_value=new_value,
            changed_at=row.last_edit,
            editor_name=row.editor.full_name if row.editor else None,
        )
        for row, old_value, new_value in current_changes[:10]
    ]

    return DashboardSummaryOut(
        range_days=days,
        new_contacts=new_contacts,
        new_apartments=new_apartments,
        activist_edits=activist_edits,
        jewish_status_changes=jewish_status_changes,
        trend=trend,
        top_activists=top_activists,
        jewish_status_breakdown=jewish_status_breakdown,
        recent_jewish_changes=recent_jewish_changes,
    )
