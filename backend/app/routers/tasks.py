"""Task CRUD (fixes58 §3.3/§3.4), org-scoped. Admin + Campaign Manager only,
same gate as Campaigns. A Task assigns a volunteer (a real login, `users.id`
— see `docs/plan58-plan.md` decision #2) to one or more report numbers under
a Campaign; `_shliach_apartment_ids` (`routers/apartments.py`) grants
apartment access while the Task is ACTIVE under an active Campaign.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.deps import require_admin_or_campaign_manager
from app.schemas import TaskCreate, TaskOut, TaskPageOut, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _get_or_404(task_id: int, org_id: int, db: Session) -> models.Task:
    task = (
        db.query(models.Task)
        .filter(models.Task.id == task_id, models.Task.organization_id == org_id)
        .first()
    )
    if not task:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    return task


def _report_numbers_by_task(db: Session, task_ids: list[int]) -> dict[int, list[tuple[int, str]]]:
    result: dict[int, list[tuple[int, str]]] = {tid: [] for tid in task_ids}
    if not task_ids:
        return result
    rows = (
        db.query(
            models.TaskReportNumber.task_id,
            models.ReportNumber.id,
            models.ReportNumber.name,
        )
        .join(
            models.ReportNumber,
            models.ReportNumber.id == models.TaskReportNumber.report_number_id,
        )
        .filter(models.TaskReportNumber.task_id.in_(task_ids))
        .all()
    )
    for task_id, rn_id, rn_name in rows:
        result[task_id].append((rn_id, rn_name))
    return result


def _to_out(task: models.Task, report_numbers: list[tuple[int, str]]) -> TaskOut:
    return TaskOut(
        id=task.id,
        guid=task.guid,
        campaign_id=task.campaign_id,
        campaign_name=task.campaign.name if task.campaign else "",
        volunteer_user_id=task.volunteer_user_id,
        volunteer_name=task.volunteer.full_name if task.volunteer else "",
        custom_date_value_id=task.custom_date_value_id,
        custom_date_value=task.custom_date_value.value if task.custom_date_value else None,
        report_number_ids=[rn_id for rn_id, _ in report_numbers],
        report_number_names=[name for _, name in report_numbers],
        status=task.status,
        volunteer_report_summary=task.volunteer_report_summary,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _validate_report_numbers(db: Session, org_id: int, ids: list[int]) -> None:
    if not ids:
        return
    found = (
        db.query(func.count(models.ReportNumber.id))
        .filter(models.ReportNumber.id.in_(ids), models.ReportNumber.organization_id == org_id)
        .scalar()
        or 0
    )
    if found != len(set(ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "report_number_id does not exist")


@router.get("/list", response_model=TaskPageOut)
def list_tasks(
    status_filter: Optional[list[str]] = Query(None, alias="status"),
    campaign_id: Optional[list[int]] = Query(None),
    q: Optional[str] = None,
    sort: Literal["volunteer_name", "created_at", "report_number"] = "created_at",
    dir: Literal["asc", "desc"] = "desc",
    page: int = Query(1, ge=1),
    page_size: int = Query(20),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    if page_size not in (20, 50, 100):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "page_size must be 20, 50 or 100"
        )
    org_id = current_user.organization_id
    query = (
        db.query(models.Task)
        .join(models.Campaign, models.Campaign.id == models.Task.campaign_id)
        .join(models.User, models.User.id == models.Task.volunteer_user_id)
        .filter(models.Task.organization_id == org_id)
    )
    if status_filter:
        query = query.filter(models.Task.status.in_(status_filter))
    if campaign_id:
        query = query.filter(models.Task.campaign_id.in_(campaign_id))
    if q and q.strip():
        term = f"%{q.strip()}%"
        rn_match = (
            db.query(models.TaskReportNumber.task_id)
            .join(
                models.ReportNumber,
                models.ReportNumber.id == models.TaskReportNumber.report_number_id,
            )
            .filter(models.ReportNumber.name.ilike(term))
        )
        query = query.filter(
            or_(
                models.User.full_name.ilike(term),
                models.Campaign.name.ilike(term),
                models.Task.id.in_(rn_match),
            )
        )

    total = query.count()

    if sort == "volunteer_name":
        order_col = models.User.full_name
    elif sort == "report_number":
        # Lexicographic, not natural-numeric, sort — report numbers are
        # numeric strings ("10" before "2" is a known, cosmetic limitation
        # here; the Report Numbers page's own list does natural sort
        # client-side because it's small/unpaginated, which a server-side
        # paginated ORDER BY can't replicate without a dedicated collation).
        min_rn_subq = (
            db.query(
                models.TaskReportNumber.task_id.label("task_id"),
                func.min(models.ReportNumber.name).label("min_name"),
            )
            .join(
                models.ReportNumber,
                models.ReportNumber.id == models.TaskReportNumber.report_number_id,
            )
            .group_by(models.TaskReportNumber.task_id)
            .subquery()
        )
        query = query.outerjoin(min_rn_subq, min_rn_subq.c.task_id == models.Task.id)
        order_col = min_rn_subq.c.min_name
    else:
        order_col = models.Task.created_at

    query = query.order_by(order_col.desc() if dir == "desc" else order_col.asc())
    rows = query.offset((page - 1) * page_size).limit(page_size).all()

    rn_by_task = _report_numbers_by_task(db, [t.id for t in rows])
    return TaskPageOut(
        items=[_to_out(t, rn_by_task.get(t.id, [])) for t in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    org_id = current_user.organization_id
    campaign = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.id == payload.campaign_id,
            models.Campaign.organization_id == org_id,
            models.Campaign.deleted_at.is_(None),
        )
        .first()
    )
    if not campaign:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "campaign_id does not exist")
    volunteer = (
        db.query(models.User)
        .filter(models.User.id == payload.volunteer_user_id, models.User.organization_id == org_id)
        .first()
    )
    if not volunteer:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "volunteer_user_id does not exist")
    if payload.custom_date_value_id is not None:
        cdv = (
            db.query(models.PicklistValue)
            .filter(
                models.PicklistValue.id == payload.custom_date_value_id,
                models.PicklistValue.organization_id == org_id,
                models.PicklistValue.field_key == "task.custom_date",
            )
            .first()
        )
        if not cdv:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "custom_date_value_id does not exist")
    _validate_report_numbers(db, org_id, payload.report_number_ids)

    task = models.Task(
        organization_id=org_id,
        campaign_id=payload.campaign_id,
        volunteer_user_id=payload.volunteer_user_id,
        custom_date_value_id=payload.custom_date_value_id,
        status=payload.status,
        volunteer_report_summary=payload.volunteer_report_summary,
    )
    db.add(task)
    db.flush()
    for rn_id in payload.report_number_ids:
        db.add(
            models.TaskReportNumber(
                organization_id=org_id, task_id=task.id, report_number_id=rn_id
            )
        )
    db.commit()
    db.refresh(task)
    rn_by_task = _report_numbers_by_task(db, [task.id])
    return _to_out(task, rn_by_task.get(task.id, []))


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    org_id = current_user.organization_id
    task = _get_or_404(task_id, org_id, db)
    data = payload.model_dump(exclude_unset=True)

    if "campaign_id" in data:
        campaign = (
            db.query(models.Campaign)
            .filter(
                models.Campaign.id == data["campaign_id"],
                models.Campaign.organization_id == org_id,
                models.Campaign.deleted_at.is_(None),
            )
            .first()
        )
        if not campaign:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "campaign_id does not exist")
        task.campaign_id = data["campaign_id"]
    if "custom_date_value_id" in data:
        if data["custom_date_value_id"] is not None:
            cdv = (
                db.query(models.PicklistValue)
                .filter(
                    models.PicklistValue.id == data["custom_date_value_id"],
                    models.PicklistValue.organization_id == org_id,
                    models.PicklistValue.field_key == "task.custom_date",
                )
                .first()
            )
            if not cdv:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, "custom_date_value_id does not exist"
                )
        task.custom_date_value_id = data["custom_date_value_id"]
    if "status" in data:
        task.status = data["status"]
    if "volunteer_report_summary" in data:
        task.volunteer_report_summary = data["volunteer_report_summary"]
    if "report_number_ids" in data and data["report_number_ids"] is not None:
        _validate_report_numbers(db, org_id, data["report_number_ids"])
        db.query(models.TaskReportNumber).filter(
            models.TaskReportNumber.task_id == task.id
        ).delete(synchronize_session=False)
        for rn_id in data["report_number_ids"]:
            db.add(
                models.TaskReportNumber(
                    organization_id=org_id, task_id=task.id, report_number_id=rn_id
                )
            )

    db.commit()
    db.refresh(task)
    rn_by_task = _report_numbers_by_task(db, [task.id])
    return _to_out(task, rn_by_task.get(task.id, []))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    task = _get_or_404(task_id, current_user.organization_id, db)
    db.delete(task)
    db.commit()
