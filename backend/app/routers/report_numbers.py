"""Report-number CRUD (מספר דוח, fixes19), org-scoped.

Reads: any authenticated user (the apartment forms' searchable dropdown needs
the list, and apartment editing is open beyond admins). Mutations: admins only.
Deleting a report number detaches it from apartments (FK nulled); shliach
links cascade with the bridge rows.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.core.jewish_status import apartment_jewish_counts_by
from app.core.natural_sort import natural_sort_key
from app.core.shliach import activist_names_by_contact
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    JewishCounts,
    ReportNumberAreaOut,
    ReportNumberCreate,
    ReportNumberOut,
    ReportNumberUpdate,
    ShliachSummary,
    TaskStatusWithId,
)

router = APIRouter(prefix="/api/report-numbers", tags=["report-numbers"])


def _get_or_404(report_number_id: int, org_id: int, db: Session) -> models.ReportNumber:
    rn = (
        db.query(models.ReportNumber)
        .filter(
            models.ReportNumber.id == report_number_id,
            models.ReportNumber.organization_id == org_id,
        )
        .first()
    )
    if not rn:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report number not found")
    return rn


@router.get("", response_model=list[ReportNumberOut])
def list_report_numbers(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # fixes52 §6: natural sort — report numbers are literally numeric
    # strings, the textbook "10 sorts before 2" bug. This list is never
    # paginated, so sorting in Python (correctly handling a number embedded
    # mid-string too, e.g. an admin-named "RN 10") is safe.
    rows = (
        db.query(models.ReportNumber)
        .filter(models.ReportNumber.organization_id == current_user.organization_id)
        .all()
    )
    return sorted(rows, key=lambda r: natural_sort_key(r.name or ""))


@router.get("/shliach-assignments", response_model=dict[int, list[ShliachSummary]])
def report_number_shliach_assignments(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes43 §4.3: every report number's currently-covering shliach(im),
    keyed by report_number_id — powers the reassignment conflict warning on
    the shliach edit form (a single query instead of one round trip per
    report number)."""
    rows = (
        db.query(
            models.ReportNumberContactShliach.report_number_id,
            models.Contact.id,
            models.Contact.name,
            models.Contact.last_name,
        )
        .join(
            models.ContactShliach,
            models.ContactShliach.id
            == models.ReportNumberContactShliach.contact_shliach_id,
        )
        .join(models.Contact, models.Contact.id == models.ContactShliach.contact_id)
        .filter(
            models.Contact.organization_id == current_user.organization_id,
            # fixes45: a retired version's copied-forward report-number link
            # must not resurrect a since-removed coverage assignment.
            models.ContactShliach.is_display.is_(True),
        )
        .all()
    )
    # fixes75 §1: a bound activist's name comes from the users table.
    names = activist_names_by_contact(db, [r[1] for r in rows])
    result: dict[int, list[ShliachSummary]] = {}
    for report_number_id, contact_id, name, last_name in rows:
        if contact_id in names:
            name, last_name = names[contact_id], None
        result.setdefault(report_number_id, []).append(
            ShliachSummary(id=contact_id, name=name, last_name=last_name)
        )
    return result


@router.get("/campaign-task-status", response_model=dict[int, dict[int, TaskStatusWithId]])
def report_number_campaign_task_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes58 §3.5: for each report number, its Task status under each
    currently-active campaign — `{report_number_id: {campaign_id: {status,
    task_id}}}`. Powers the Report Numbers page's one-badge-column-per-
    active-campaign display; fixes60 §2 added `task_id` so that badge can
    become an inline PUT-able status toggle. Nested by campaign_id (not a
    single flat value) because a report number can carry tasks under more
    than one active campaign at once, and each gets its own column. If a
    report number has 2+ tasks under the *same* campaign, the last one
    iterated wins here (pre-existing behavior, unchanged by fixes60)."""
    rows = (
        db.query(
            models.TaskReportNumber.report_number_id,
            models.Task.campaign_id,
            models.Task.status,
            models.Task.id,
        )
        .join(models.Task, models.Task.id == models.TaskReportNumber.task_id)
        .join(models.Campaign, models.Campaign.id == models.Task.campaign_id)
        .filter(
            models.Task.organization_id == current_user.organization_id,
            models.Campaign.is_active.is_(True),
            models.Campaign.deleted_at.is_(None),
        )
        .all()
    )
    result: dict[int, dict[int, TaskStatusWithId]] = {}
    for report_number_id, campaign_id, task_status, task_id in rows:
        result.setdefault(report_number_id, {})[campaign_id] = TaskStatusWithId(
            status=task_status, task_id=task_id
        )
    return result


@router.get("/jewish-counts", response_model=dict[int, JewishCounts])
def report_number_jewish_counts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """fixes53 §3: "Number of Jews" / "Number of Engaged Jews" calculated
    columns for the Report Numbers grid, keyed by report_number_id. Missing
    keys (no matching apartment) are 0/0 — the frontend fills those in."""
    return apartment_jewish_counts_by(
        db, current_user.organization_id, models.Apartment.report_number_id
    )


@router.get("/areas", response_model=dict[int, list[ReportNumberAreaOut]])
def report_number_areas(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes68: for each report number, the area(s) its active apartments'
    buildings sit in — keyed by report_number_id, most-buildings-first.
    Declared before `/{report_number_id}` so that route doesn't swallow this
    path first."""
    building_count = func.count(func.distinct(models.Building.id))
    rows = (
        db.query(
            models.Apartment.report_number_id,
            models.Area.id,
            models.Area.area_name,
            building_count,
        )
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .join(models.Area, models.Area.id == models.Building.area_id)
        .filter(
            models.Apartment.organization_id == admin.organization_id,
            models.Apartment.is_display.is_(True),
            models.Apartment.report_number_id.isnot(None),
        )
        .group_by(models.Apartment.report_number_id, models.Area.id, models.Area.area_name)
        .order_by(models.Apartment.report_number_id, building_count.desc())
        .all()
    )
    result: dict[int, list[ReportNumberAreaOut]] = {}
    for report_number_id, area_id, area_name, _count in rows:
        result.setdefault(report_number_id, []).append(
            ReportNumberAreaOut(id=area_id, area_name=area_name)
        )
    return result


@router.post("", response_model=ReportNumberOut, status_code=status.HTTP_201_CREATED)
def create_report_number(
    payload: ReportNumberCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rn = models.ReportNumber(
        **payload.model_dump(), organization_id=admin.organization_id
    )
    db.add(rn)
    db.commit()
    db.refresh(rn)
    return rn


@router.get("/{report_number_id}", response_model=ReportNumberOut)
def get_report_number(
    report_number_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return _get_or_404(report_number_id, current_user.organization_id, db)


@router.put("/{report_number_id}", response_model=ReportNumberOut)
def update_report_number(
    report_number_id: int,
    payload: ReportNumberUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rn = _get_or_404(report_number_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rn, field, value)
    db.commit()
    db.refresh(rn)
    return rn


@router.delete("/{report_number_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report_number(
    report_number_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rn = _get_or_404(report_number_id, admin.organization_id, db)
    # Detach referencing apartments instead of blocking the delete; shliach
    # bridge rows are removed by the relationship cascade.
    db.query(models.Apartment).filter(
        models.Apartment.report_number_id == rn.id
    ).update({models.Apartment.report_number_id: None}, synchronize_session=False)
    db.delete(rn)
    db.commit()
