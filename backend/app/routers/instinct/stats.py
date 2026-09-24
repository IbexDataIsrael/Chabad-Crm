"""Instinct read queries for WhatsApp answers (docs/system_api_part2.md §6).

- `GET /stats/registrations?date=`  — §6a contacts created that day, by source.
- `GET /stats/daily?date=`          — §6c that day's visits + tefillin tally,
  plus every still-open visit follow-up in the org.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

from .common import check_key, day_bounds, full_name, org_id, parse_date

router = APIRouter(dependencies=[Depends(check_key)])

_OPEN_FOLLOWUPS_LIMIT = 50


@router.get("/stats/registrations")
def registrations(date: Optional[str] = None, db: Session = Depends(get_db)):
    day = parse_date(date)
    start, end = day_bounds(day)
    C = models.Contact
    rows = (
        db.query(C.source, func.count(C.id))
        .filter(C.organization_id == org_id(), C.created_at >= start, C.created_at < end)
        .group_by(C.source)
        .all()
    )
    by_source = {"crm": 0, "instinct": 0, **{source: count for source, count in rows}}
    return {"date": day.isoformat(), "total": sum(by_source.values()), "by_source": by_source}


def _tefillin_by_visit(db: Session, org: int, visit_ids: list[int]) -> dict[int, int]:
    """Pairs of tefillin per visit, from the entity_type='visit' custom fields:
    a number 'tefillin_count' (when the org defines one and it is > 0) wins,
    otherwise a checked boolean 'tefillin' counts as one pair."""
    if not visit_ids:
        return {}
    rows = (
        db.query(
            models.CustomFieldValue.entity_id,
            models.CustomFieldDefinition.field_key,
            models.CustomFieldValue.checked,
            models.CustomFieldValue.value,
        )
        .join(
            models.CustomFieldDefinition,
            models.CustomFieldDefinition.id == models.CustomFieldValue.definition_id,
        )
        .filter(
            models.CustomFieldDefinition.organization_id == org,
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_key.in_(["tefillin", "tefillin_count"]),
            models.CustomFieldValue.entity_table == "visit_history",
            models.CustomFieldValue.entity_id.in_(visit_ids),
        )
        .all()
    )
    checked: set[int] = set()
    counts: dict[int, int] = {}
    for visit_id, field_key, is_checked, value in rows:
        if field_key == "tefillin" and is_checked:
            checked.add(visit_id)
        elif field_key == "tefillin_count" and value:
            try:
                counts[visit_id] = int(float(value))
            except ValueError:
                pass
    pairs = {}
    for visit_id in visit_ids:
        n = counts.get(visit_id, 0)
        pairs[visit_id] = n if n > 0 else (1 if visit_id in checked else 0)
    return pairs


@router.get("/stats/daily")
def daily(date: Optional[str] = None, db: Session = Depends(get_db)):
    org = org_id()
    day = parse_date(date)
    start, end = day_bounds(day)
    V, C = models.VisitHistory, models.Contact
    visits = (
        db.query(V, C.name, C.last_name)
        .outerjoin(C, C.id == V.contact_id)
        .filter(V.organization_id == org, V.visit_date >= start, V.visit_date < end)
        .order_by(V.visit_date, V.id)
        .all()
    )
    pairs = _tefillin_by_visit(db, org, [v.id for v, *_ in visits])

    open_rows = (
        db.query(V.followup_task, C.name, C.last_name)
        .outerjoin(C, C.id == V.contact_id)
        .filter(
            V.organization_id == org,
            V.followup_task.isnot(None),
            V.followup_done.is_(False),
        )
        .order_by(V.visit_date.desc(), V.id.desc())
        .limit(_OPEN_FOLLOWUPS_LIMIT)
        .all()
    )
    open_followups = []
    for task, name, last_name in open_rows:
        who = full_name(name, last_name)
        open_followups.append(f"{task} ({who})" if who else task)

    return {
        "date": day.isoformat(),
        "visits_count": len(visits),
        "visits": [
            {
                "id": v.id,
                "contact_id": v.contact_id,
                "contact_name": full_name(name, last_name) or None,
                "apartment_id": v.apartment_id,
                "time": v.visit_date.strftime("%H:%M"),
                "followup_task": v.followup_task,
                "followup_done": v.followup_done,
            }
            for v, name, last_name in visits
        ],
        "tefillin": {
            "visits_with_tefillin": sum(1 for n in pairs.values() if n > 0),
            "total_pairs": sum(pairs.values()),
        },
        "open_followups": open_followups,
    }
