"""Task CRUD (fixes58 §3.3/§3.4), org-scoped. Admin + Campaign Manager only,
same gate as Campaigns. A Task assigns a volunteer (a real login, `users.id`
— see `docs/plan58-plan.md` decision #2) to one or more report numbers under
a Campaign; `_shliach_apartment_ids` (`routers/apartments.py`) grants
apartment access while the Task is ACTIVE under an active Campaign.
"""
import datetime
import re
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import Float, case, cast, func, or_, select
from sqlalchemy.orm import Session, aliased

from app import custom_field_utils, models, picklist_utils
from app.routers.apartments import EMPTY_FIELD_SENTINEL
from app.core.activist_emails import send_task_assigned
from app.core.claim_token import make_claim_token
from app.core.task_claim import (
    assign,
    claim,
    claim_link_enabled,
    is_orphan,
    release,
    task_from_token,
)
from app.database import get_db
from app.deps import get_current_user, require_admin_or_campaign_manager
from app.schemas import (
    ClaimResultOut,
    PaperEntryCreate,
    PaperEntryOut,
    TaskBulkCreate,
    TaskBulkCreateOut,
    TaskBulkNumber,
    TaskBulkPreviewOut,
    TaskBulkPreviewRequest,
    TaskCreate,
    TaskOut,
    TaskPageOut,
    TaskPrintApartment,
    TaskPrintOut,
    TaskUpdate,
)
from app.core.errors import api_error

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


def _latest_reports_by_task(
    db: Session, tasks: list[models.Task]
) -> dict[int, tuple[str, Optional[str]]]:
    """fixes74 §11: each task's own most recent report — a
    ShliachReportCompletion linked to that task and sent AFTER the task was
    assigned (a report from a previous assignee doesn't count). Replaces
    fixes60's "the volunteer's latest report, whatever task it was about",
    which let a newer report show up on an older task. Old reports have no
    task link and are deliberately ignored — nothing guesses their task.
    One query for the whole page."""
    result: dict[int, tuple[str, Optional[str]]] = {}
    assigned_at = {t.id: t.assigned_at for t in tasks if t.volunteer_user_id is not None}
    if not assigned_at:
        return result
    rows = (
        db.query(
            models.ShliachReportCompletion.task_id,
            models.ShliachReportCompletion.status,
            models.ShliachReportCompletion.comments,
            models.ShliachReportCompletion.created_at,
        )
        .filter(models.ShliachReportCompletion.task_id.in_(list(assigned_at)))
        .order_by(
            models.ShliachReportCompletion.created_at.desc(),
            models.ShliachReportCompletion.id.desc(),
        )
        .all()
    )
    for task_id, report_status, comments, created_at in rows:
        since = assigned_at[task_id]
        if task_id in result or (since is not None and created_at < since):
            continue
        result[task_id] = (report_status, comments)
    return result


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


def _apartment_counts_by_task(db: Session, task_ids: list[int]) -> dict[int, int]:
    """fixes65 §3: how many (active) apartments each task covers through its
    report numbers — a zero-apartment task can't be printed."""
    if not task_ids:
        return {}
    rows = (
        db.query(models.TaskReportNumber.task_id, func.count(models.Apartment.id))
        .join(
            models.Apartment,
            models.Apartment.report_number_id == models.TaskReportNumber.report_number_id,
        )
        .filter(
            models.TaskReportNumber.task_id.in_(task_ids),
            models.Apartment.is_display.is_(True),
        )
        .group_by(models.TaskReportNumber.task_id)
        .all()
    )
    return {task_id: count for task_id, count in rows}


def _custom_values_by_task(
    db: Session, org_id: int, task_ids: list[int]
) -> tuple[dict[int, dict], dict[int, dict]]:
    """fixes104 §2: each task's task-picklist values and non-select custom
    field values. `task.custom_date` is a real FK column, not a link, so it
    never shows up here."""
    return (
        picklist_utils.get_values_bulk(db, org_id, "tasks", task_ids),
        custom_field_utils.get_values_bulk(db, org_id, "task", task_ids),
    )


def _apply_custom_values(
    db: Session, org_id: int, task_id: int, picklist_values: dict, custom_field_values: dict
) -> None:
    """fixes104 §2: write task picklist / custom field values. Only picklists
    that belong to tasks are accepted, so no other entity's list can be
    attached to a task by naming it in the payload."""
    if picklist_values:
        task_keys = {
            name
            for (name,) in db.query(models.PicklistDefinition.system_name).filter(
                models.PicklistDefinition.organization_id == org_id,
                models.PicklistDefinition.entity_type == "task",
            )
        }
        for field_key, value in picklist_values.items():
            if field_key not in task_keys or field_key == "task.custom_date":
                raise api_error(
                    status.HTTP_400_BAD_REQUEST, "error.unknown_picklist",
                    "unknown picklist '{field}'", field=field_key,
                )
            picklist_utils.set_value(db, org_id, "tasks", task_id, field_key, value)
    for field_key, value in (custom_field_values or {}).items():
        custom_field_utils.set_value(db, org_id, "task", task_id, field_key, value)


def _task_picklist_filter(query, field_key: str, values: list[str]):
    """fixes104 §2: same semantics as the apartments list's picklist filter,
    including the "empty" sentinel."""
    real_values = [v for v in values if v != EMPTY_FIELD_SENTINEL]
    conditions = []
    if real_values:
        conditions.append(
            models.Task.id.in_(picklist_utils.matching_entity_ids("tasks", field_key, real_values))
        )
    if len(real_values) != len(values):
        conditions.append(
            models.Task.id.notin_(picklist_utils.unassigned_entity_ids("tasks", field_key))
        )
    return query.filter(or_(*conditions)) if conditions else query


def _task_custom_field_filter(query, db: Session, org_id: int, field_key: str, text: str):
    """fixes104 §2: same semantics as the apartments list's custom-field
    filter (boolean = true/false, else "contains", or the empty sentinel)."""
    definition = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "task",
            models.CustomFieldDefinition.field_key == field_key,
        )
        .first()
    )
    if definition is None:
        return query
    if text == EMPTY_FIELD_SENTINEL and definition.field_type != "boolean":
        has_value = select(models.CustomFieldValue.entity_id).where(
            models.CustomFieldValue.entity_table == "tasks",
            models.CustomFieldValue.definition_id == definition.id,
            models.CustomFieldValue.value.isnot(None),
            models.CustomFieldValue.value != "",
        )
        return query.filter(models.Task.id.notin_(has_value))
    sub = select(models.CustomFieldValue.entity_id).where(
        models.CustomFieldValue.entity_table == "tasks",
        models.CustomFieldValue.definition_id == definition.id,
    )
    if definition.field_type == "boolean":
        sub = sub.where(models.CustomFieldValue.checked.is_(text.strip().lower() == "true"))
    else:
        sub = sub.where(models.CustomFieldValue.value.ilike(f"%{text.strip()}%"))
    return query.filter(models.Task.id.in_(sub))


def _to_out(
    task: models.Task,
    report_numbers: list[tuple[int, str]],
    latest_report: Optional[tuple[str, Optional[str]]] = None,
    apartment_count: int = 0,
    picklist_values: Optional[dict] = None,
    custom_field_values: Optional[dict] = None,
) -> TaskOut:
    return TaskOut(
        id=task.id,
        guid=task.guid,
        campaign_id=task.campaign_id,
        campaign_name=task.campaign.name if task.campaign else "",
        volunteer_user_id=task.volunteer_user_id,
        volunteer_name=task.volunteer.full_name if task.volunteer else "",
        custom_date_value_id=task.custom_date_value_id,
        custom_date_value=task.custom_date_value.value if task.custom_date_value else None,
        scheduled_at=task.scheduled_at,
        report_number_ids=[rn_id for rn_id, _ in report_numbers],
        report_number_names=[name for _, name in report_numbers],
        task_text=task.task_text,
        status=task.status,
        volunteer_report_summary=task.volunteer_report_summary,
        latest_report_status=latest_report[0] if latest_report else None,
        latest_report_notes=latest_report[1] if latest_report else None,
        claimed_at=task.claimed_at,
        claimed_via=task.claimed_via,
        assigned_at=task.assigned_at,
        is_orphan=is_orphan(task),
        apartment_count=apartment_count,
        claim_token=make_claim_token(task.guid) if claim_link_enabled(task) else None,
        picklist_values=picklist_values or {},
        custom_field_values=custom_field_values or {},
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _single_out(db: Session, org_id: int, task: models.Task) -> TaskOut:
    rn_by_task = _report_numbers_by_task(db, [task.id])
    reports = _latest_reports_by_task(db, [task])
    pl_map, cf_map = _custom_values_by_task(db, org_id, [task.id])
    return _to_out(
        task,
        rn_by_task.get(task.id, []),
        reports.get(task.id),
        _apartment_counts_by_task(db, [task.id]).get(task.id, 0),
        pl_map.get(task.id),
        cf_map.get(task.id),
    )


def _validate_volunteer(db: Session, org_id: int, user_id: int) -> models.User:
    volunteer = (
        db.query(models.User)
        .filter(models.User.id == user_id, models.User.organization_id == org_id)
        .first()
    )
    if not volunteer:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "volunteer_user_id does not exist")
    return volunteer


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


# fixes109: status sorts in its workflow order, not alphabetically.
_STATUS_SORT_ORDER = {"AVAILABLE": 0, "ACTIVE": 1, "COMPLETED": 2, "PAUSED": 3}


def _latest_report_sort_col(column):
    """fixes109: `column` of the task's own latest report, as a correlated
    subquery — the same rule as _latest_reports_by_task (linked to the task,
    sent after it was assigned, only while it has an activist)."""
    src = models.ShliachReportCompletion
    return (
        select(column)
        .where(
            src.task_id == models.Task.id,
            models.Task.volunteer_user_id.isnot(None),
            or_(models.Task.assigned_at.is_(None), src.created_at >= models.Task.assigned_at),
        )
        .order_by(src.created_at.desc(), src.id.desc())
        .limit(1)
        .correlate(models.Task)
        .scalar_subquery()
    )


def _picklist_sort_col(field_key: str, column):
    """fixes109: `column` of the task's value for picklist `field_key`."""
    return (
        select(func.min(column))
        .select_from(models.PicklistLink)
        .join(
            models.PicklistDefinition,
            models.PicklistDefinition.id == models.PicklistLink.picklist_definition_id,
        )
        .join(models.PicklistValue, models.PicklistValue.id == models.PicklistLink.picklist_value_id)
        .where(
            models.PicklistLink.entity_table == "tasks",
            models.PicklistLink.entity_id == models.Task.id,
            models.PicklistDefinition.system_name == field_key,
        )
        .correlate(models.Task)
        .scalar_subquery()
    )


def _apply_task_sort(query, db: Session, org_id: int, sort: str, direction: str):
    """fixes109: ORDER BY for every column the tasks grid shows — the fixed
    columns plus `pl:<field_key>` / `cf:<field_key>` custom task fields.
    Blank values sort last either way; Task.id breaks ties so pagination is
    stable. An unknown key (e.g. a saved sort on a since-deleted field)
    falls back to the creation date."""
    cols: list = []
    if sort == "id":
        cols = [models.Task.id]
    elif sort == "volunteer_name":
        cols = [models.User.full_name]
    elif sort == "campaign":
        cols = [models.Campaign.name]
    elif sort == "status":
        cols = [case(_STATUS_SORT_ORDER, value=models.Task.status, else_=len(_STATUS_SORT_ORDER))]
    elif sort == "report_status":
        cols = [_latest_report_sort_col(models.ShliachReportCompletion.status)]
    elif sort == "report_notes":
        cols = [_latest_report_sort_col(models.ShliachReportCompletion.comments)]
    elif sort == "custom_date":
        cd = aliased(models.PicklistValue)
        query = query.outerjoin(cd, cd.id == models.Task.custom_date_value_id)
        cols = [cd.sort_order, cd.value]
    elif sort == "apartment_count":
        cols = [
            select(func.count(models.Apartment.id))
            .select_from(models.TaskReportNumber)
            .join(
                models.Apartment,
                models.Apartment.report_number_id == models.TaskReportNumber.report_number_id,
            )
            .where(
                models.TaskReportNumber.task_id == models.Task.id,
                models.Apartment.is_display.is_(True),
            )
            .correlate(models.Task)
            .scalar_subquery()
        ]
    elif sort == "scheduled_at":
        cols = [models.Task.scheduled_at]
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
        cols = [min_rn_subq.c.min_name]
    elif sort.startswith("pl:"):
        field_key = sort[3:]
        cols = [
            _picklist_sort_col(field_key, models.PicklistValue.sort_order),
            _picklist_sort_col(field_key, models.PicklistValue.value),
        ]
    elif sort.startswith("cf:"):
        definition = (
            db.query(models.CustomFieldDefinition)
            .filter(
                models.CustomFieldDefinition.organization_id == org_id,
                models.CustomFieldDefinition.entity_type == "task",
                models.CustomFieldDefinition.field_key == sort[3:],
                models.CustomFieldDefinition.field_type != "select",
            )
            .first()
        )
        if definition is not None:
            cfv = models.CustomFieldValue
            value_col = {
                "boolean": cfv.checked,
                "number": cast(cfv.value, Float),
            }.get(definition.field_type, cfv.value)
            cols = [
                select(value_col)
                .where(
                    cfv.entity_table == custom_field_utils.storage_table("task"),
                    cfv.entity_id == models.Task.id,
                    cfv.definition_id == definition.id,
                )
                .limit(1)
                .correlate(models.Task)
                .scalar_subquery()
            ]
    if not cols:
        cols = [models.Task.created_at]
    desc = direction == "desc"
    order = [(c.desc() if desc else c.asc()).nulls_last() for c in cols]
    order.append(models.Task.id.desc() if desc else models.Task.id.asc())
    return query.order_by(*order)


@router.get("/list", response_model=TaskPageOut)
def list_tasks(
    status_filter: Optional[list[str]] = Query(None, alias="status"),
    campaign_id: Optional[list[int]] = Query(None),
    # fixes65 §8: "orphan" = the unassigned pool (printed, unclaimed).
    assignment: Optional[Literal["orphan", "assigned"]] = None,
    q: Optional[str] = None,
    # fixes104 §2: "field_key:value" pairs, same format as the apartments list.
    picklist: Optional[list[str]] = Query(None),
    custom_field_filter: Optional[list[str]] = Query(None),
    # fixes109: any displayed column — see _apply_task_sort.
    sort: str = "created_at",
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
        # fixes65 §2: outer — an orphan task has no volunteer.
        .outerjoin(models.User, models.User.id == models.Task.volunteer_user_id)
        .filter(models.Task.organization_id == org_id)
    )
    if status_filter:
        query = query.filter(models.Task.status.in_(status_filter))
    orphan_cond = models.Task.volunteer_user_id.is_(None) & or_(
        models.Task.claimed_via.is_(None), models.Task.claimed_via != "paper"
    )
    if assignment == "orphan":
        query = query.filter(orphan_cond)
    elif assignment == "assigned":
        query = query.filter(~orphan_cond)
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
    picklist_filters: dict[str, list[str]] = {}
    for entry in picklist or []:
        key, sep, value = entry.partition(":")
        if sep:
            picklist_filters.setdefault(key, []).append(value)
    for field_key, values in picklist_filters.items():
        query = _task_picklist_filter(query, field_key, values)
    for entry in custom_field_filter or []:
        key, sep, value = entry.partition(":")
        if sep and value != "":
            query = _task_custom_field_filter(query, db, org_id, key, value)

    total = query.count()

    query = _apply_task_sort(query, db, org_id, sort, dir)
    rows = query.offset((page - 1) * page_size).limit(page_size).all()

    rn_by_task = _report_numbers_by_task(db, [t.id for t in rows])
    reports_by_task = _latest_reports_by_task(db, rows)
    apt_counts = _apartment_counts_by_task(db, [t.id for t in rows])
    pl_map, cf_map = _custom_values_by_task(db, org_id, [t.id for t in rows])
    return TaskPageOut(
        items=[
            _to_out(
                t,
                rn_by_task.get(t.id, []),
                reports_by_task.get(t.id),
                apt_counts.get(t.id, 0),
                pl_map.get(t.id),
                cf_map.get(t.id),
            )
            for t in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/map")
def task_map(
    task_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict:
    """fixes96: buildings to show on a Google map + the polygons of their areas.

    - no task_id (activist): every building the activist can work in — the
      SAME apartments street2 shows (active tasks under an active campaign,
      plus area coverage: apartments._shliach_apartment_ids) — each with the
      task numbers that cover it;
    - task_id (admin / campaign manager, or that task's own activist): the
      buildings of that one task.
    Defined before the /{task_id} routes so "map" isn't read as a task id."""
    from app.routers.apartments import _shliach_apartment_ids

    org_id = current_user.organization_id
    A, T, TRN = models.Apartment, models.Task, models.TaskReportNumber
    if task_id is not None:
        task = db.query(T).filter(T.id == task_id, T.organization_id == org_id).first()
        if task is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
        if current_user.role not in ("admin", "campaign_manager") and task.volunteer_user_id != current_user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not one of your tasks")
        tasks = [task]
        apt_ids = [
            aid for (aid,) in db.query(A.id)
            .join(TRN, TRN.report_number_id == A.report_number_id)
            .filter(TRN.task_id == task.id, A.organization_id == org_id, A.is_display.is_(True))
        ]
    elif current_user.role == "shliach":
        apt_ids = _shliach_apartment_ids(db, current_user)
        tasks = (
            db.query(T)
            .join(models.Campaign, models.Campaign.id == T.campaign_id)
            .filter(
                T.organization_id == org_id,
                T.volunteer_user_id == current_user.id,
                T.status == "ACTIVE",
                models.Campaign.is_active.is_(True),
                models.Campaign.deleted_at.is_(None),
            )
            .all()
        )
    else:
        return {"buildings": [], "areas": [], "task_count": 0}

    rns_by_task: dict[int, set[int]] = {}
    for tid, rn in db.query(TRN.task_id, TRN.report_number_id).filter(
        TRN.task_id.in_([t.id for t in tasks] or [0])
    ):
        rns_by_task.setdefault(tid, set()).add(rn)

    apartments_by_building: dict[int, int] = {}
    tasks_by_building: dict[int, set[int]] = {}
    for bid, rn in db.query(A.building_id, A.report_number_id).filter(
        A.id.in_(apt_ids or [0]), A.is_display.is_(True)
    ):
        if bid is None:
            continue
        apartments_by_building[bid] = apartments_by_building.get(bid, 0) + 1
        for tid, rns in rns_by_task.items():
            if rn in rns:
                tasks_by_building.setdefault(bid, set()).add(tid)

    buildings = (
        db.query(models.Building)
        .filter(models.Building.id.in_(apartments_by_building.keys() or [0]))
        .all()
    )
    area_ids = {b.area_id for b in buildings if b.area_id is not None}
    areas = (
        db.query(models.Area)
        .filter(models.Area.id.in_(area_ids or [0]), models.Area.area_polygon.isnot(None))
        .all()
    )
    return {
        "task_count": len(tasks),
        "buildings": [
            {
                "id": b.id,
                "building_name": b.building_name,
                "building_address": b.building_address,
                "latitude": b.latitude,
                "longitude": b.longitude,
                "is_town_house": bool(b.is_town_house),
                "area_id": b.area_id,
                "apartment_count": apartments_by_building.get(b.id, 0),
                "task_ids": sorted(tasks_by_building.get(b.id, ())),
            }
            for b in buildings
        ],
        "areas": [
            {"id": a.id, "area_name": a.area_name, "area_polygon": a.area_polygon}
            for a in areas
        ],
    }


def _clean_task_text(text: Optional[str]) -> Optional[str]:
    return (text or "").strip() or None


def _check_text_task(task_text: Optional[str], report_number_ids: list[int]) -> None:
    """fixes98: a text task has instructions *instead of* report numbers."""
    if task_text and report_number_ids:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A text task needs text and no report numbers"
        )


def _email_assignment(
    background: BackgroundTasks, org_id: int, user_id: Optional[int], task_ids: list[int]
) -> None:
    """fixes98: "a new task has been assigned to you", after the response."""
    if user_id is not None and task_ids:
        background.add_task(send_task_assigned, org_id, user_id, task_ids)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    background: BackgroundTasks,
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
    if payload.volunteer_user_id is not None:
        _validate_volunteer(db, org_id, payload.volunteer_user_id)
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
    task_text = _clean_task_text(payload.task_text)
    _check_text_task(task_text, payload.report_number_ids)

    task = _new_task(
        db,
        org_id,
        payload.campaign_id,
        payload.volunteer_user_id,
        payload.custom_date_value_id,
        payload.status,
        payload.volunteer_report_summary,
        payload.report_number_ids,
        task_text=task_text,
        scheduled_at=payload.scheduled_at,
    )
    _apply_custom_values(
        db, org_id, task.id, payload.picklist_values or {}, payload.custom_field_values or {},
    )
    db.commit()
    db.refresh(task)
    _email_assignment(background, org_id, task.volunteer_user_id, [task.id])
    return _single_out(db, org_id, task)


def _new_task(
    db: Session,
    org_id: int,
    campaign_id: int,
    volunteer_user_id: Optional[int],
    custom_date_value_id: Optional[int],
    task_status: str,
    summary: Optional[str],
    report_number_ids: list[int],
    task_text: Optional[str] = None,
    scheduled_at: Optional[datetime.datetime] = None,
) -> models.Task:
    """Add one task + its report numbers (no commit). fixes74 §2: without an
    activist a new task is AVAILABLE, never ACTIVE ("taken"); picking one at
    creation is a manual assignment (§4)."""
    if volunteer_user_id is None and task_status == "ACTIVE":
        task_status = "AVAILABLE"
    task = models.Task(
        organization_id=org_id,
        campaign_id=campaign_id,
        custom_date_value_id=custom_date_value_id,
        status=task_status,
        volunteer_report_summary=summary,
        task_text=task_text,
        scheduled_at=scheduled_at,
    )
    if volunteer_user_id is not None:
        assign(task, volunteer_user_id, "manual")
        if task_status in ("COMPLETED", "PAUSED"):
            task.status = task_status
    db.add(task)
    db.flush()
    for rn_id in report_number_ids:
        db.add(
            models.TaskReportNumber(
                organization_id=org_id, task_id=task.id, report_number_id=rn_id
            )
        )
    return task


# --- fixes74 §3: one task per report number ---------------------------------

_MAX_BULK_NUMBERS = 1000


def _parse_range_text(text: str) -> list[int]:
    """ "10-40, 55 60-62" -> [10..40, 55, 60, 61, 62] (order kept, deduped)."""
    numbers: list[int] = []
    # Normalize "10 - 40" to "10-40" before splitting on separators.
    text = re.sub(r"\s*[-–]\s*", "-", text.strip())
    for part in re.split(r"[,\s;]+", text):
        if not part:
            continue
        m = re.fullmatch(r"(\d+)-(\d+)|(\d+)", part)
        if not m:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "error.cannot_read_range",
                "Can't read '{part}' — use numbers and ranges like 10-40", part=part,
            )
        if m.group(3) is not None:
            lo = hi = int(m.group(3))
        else:
            lo, hi = sorted((int(m.group(1)), int(m.group(2))))
        if hi - lo + 1 > _MAX_BULK_NUMBERS:
            raise api_error(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "error.range_too_big",
                "A range can cover at most {max} numbers", max=_MAX_BULK_NUMBERS,
            )
        numbers.extend(range(lo, hi + 1))
    return list(dict.fromkeys(numbers))


def _natural_key(name: str):
    return [
        (0, int(p), "") if p.isdigit() else (1, 0, p)
        for p in re.split(r"(\d+)", name or "")
        if p
    ]


def _conflicting_tasks(
    db: Session, campaign_id: int, rn_ids: list[int]
) -> dict[int, list[int]]:
    """report_number_id -> ids of the tasks in this campaign already covering it."""
    result: dict[int, list[int]] = {}
    if not rn_ids:
        return result
    rows = (
        db.query(models.TaskReportNumber.report_number_id, models.Task.id)
        .join(models.Task, models.Task.id == models.TaskReportNumber.task_id)
        .filter(
            models.Task.campaign_id == campaign_id,
            models.TaskReportNumber.report_number_id.in_(rn_ids),
        )
        .order_by(models.Task.id)
        .all()
    )
    for rn_id, task_id in rows:
        result.setdefault(rn_id, []).append(task_id)
    return result


def _campaign_or_400(db: Session, org_id: int, campaign_id: int) -> models.Campaign:
    campaign = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.id == campaign_id,
            models.Campaign.organization_id == org_id,
            models.Campaign.deleted_at.is_(None),
        )
        .first()
    )
    if not campaign:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "campaign_id does not exist")
    return campaign


@router.post("/bulk/preview", response_model=TaskBulkPreviewOut)
def preview_bulk_tasks(
    payload: TaskBulkPreviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """fixes74 §3: the numbers a bulk create would use — eligible, already in
    a task of this campaign (conflicts), and range numbers that aren't report
    numbers at all (skipped). Range numbers match report numbers by name, so
    "10-40" finds "10".."40"."""
    org_id = current_user.organization_id
    _campaign_or_400(db, org_id, payload.campaign_id)
    _validate_report_numbers(db, org_id, payload.report_number_ids)
    org_rns = (
        db.query(models.ReportNumber.id, models.ReportNumber.name)
        .filter(models.ReportNumber.organization_id == org_id)
        .all()
    )
    name_by_id = {rn_id: name for rn_id, name in org_rns}
    id_by_number: dict[int, int] = {}
    for rn_id, name in org_rns:
        stripped = (name or "").strip()
        if stripped.isdigit():
            id_by_number.setdefault(int(stripped), rn_id)

    wanted: list[int] = list(dict.fromkeys(payload.report_number_ids))
    missing: list[str] = []
    for n in _parse_range_text(payload.range_text or ""):
        rn_id = id_by_number.get(n)
        if rn_id is None:
            missing.append(str(n))
        elif rn_id not in wanted:
            wanted.append(rn_id)
    if len(wanted) > _MAX_BULK_NUMBERS:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "error.too_many_report_numbers",
            "At most {max} report numbers at once", max=_MAX_BULK_NUMBERS,
        )

    conflicts = _conflicting_tasks(db, payload.campaign_id, wanted)
    ordered = sorted(wanted, key=lambda i: _natural_key(name_by_id[i]))
    return TaskBulkPreviewOut(
        eligible=[
            TaskBulkNumber(id=i, name=name_by_id[i]) for i in ordered if i not in conflicts
        ],
        conflicts=[
            TaskBulkNumber(id=i, name=name_by_id[i], task_ids=conflicts[i])
            for i in ordered
            if i in conflicts
        ],
        missing=missing,
    )


@router.post("/bulk", response_model=TaskBulkCreateOut, status_code=status.HTTP_201_CREATED)
def create_bulk_tasks(
    payload: TaskBulkCreate,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """fixes74 §3: one separate task per report number, in one transaction.
    Conflicts are re-checked here (not trusted from the preview): without
    `skip_conflicts` any conflict refuses the whole batch."""
    org_id = current_user.organization_id
    _campaign_or_400(db, org_id, payload.campaign_id)
    ids = list(dict.fromkeys(payload.report_number_ids))
    if not ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No report numbers selected")
    if len(ids) > _MAX_BULK_NUMBERS:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "error.too_many_report_numbers",
            "At most {max} report numbers at once", max=_MAX_BULK_NUMBERS,
        )
    _validate_report_numbers(db, org_id, ids)
    if payload.volunteer_user_id is not None:
        _validate_volunteer(db, org_id, payload.volunteer_user_id)
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

    conflicts = _conflicting_tasks(db, payload.campaign_id, ids)
    if conflicts and not payload.skip_conflicts:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Some report numbers already belong to a task in this campaign",
        )
    names = dict(
        db.query(models.ReportNumber.id, models.ReportNumber.name)
        .filter(models.ReportNumber.id.in_(ids))
        .all()
    )
    created: list[int] = []
    for rn_id in sorted((i for i in ids if i not in conflicts), key=lambda i: _natural_key(names[i])):
        task = _new_task(
            db,
            org_id,
            payload.campaign_id,
            payload.volunteer_user_id,
            payload.custom_date_value_id,
            payload.status,
            None,
            [rn_id],
            scheduled_at=payload.scheduled_at,
        )
        _apply_custom_values(
            db, org_id, task.id, payload.picklist_values or {}, payload.custom_field_values or {},
        )
        created.append(task.id)
    db.commit()
    # One email listing every task the activist just got.
    _email_assignment(background, org_id, payload.volunteer_user_id, created)
    return TaskBulkCreateOut(
        created_task_ids=created,
        skipped=[
            TaskBulkNumber(id=i, name=names[i], task_ids=conflicts[i]) for i in ids if i in conflicts
        ],
    )


@router.put("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    background: BackgroundTasks,
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
    if "scheduled_at" in data:  # fixes109
        task.scheduled_at = data["scheduled_at"]
    # fixes65 §4: an admin assigning (or reassigning) the task by hand. An
    # explicit null is ignored here — unassign has its own endpoint, which
    # also clears the claim audit. fixes74 §4: recorded as a manual
    # assignment — status "taken" and the claim link switched off.
    new_volunteer = data.get("volunteer_user_id")
    newly_assigned = None
    if new_volunteer is not None and new_volunteer != task.volunteer_user_id:
        _validate_volunteer(db, org_id, new_volunteer)
        assign(task, new_volunteer, "manual")
        newly_assigned = new_volunteer
    if data.get("status") is not None:
        # fixes74 §2: "available" and "taken" follow the assignment — an
        # unassigned task can't be taken, an assigned one can't be available.
        if data["status"] == "AVAILABLE" and not is_orphan(task):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "An assigned task can't be available — return it to the pool instead",
            )
        if data["status"] == "ACTIVE" and is_orphan(task):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Assign an activist to mark the task as taken"
            )
        task.status = data["status"]
    if "volunteer_report_summary" in data:
        task.volunteer_report_summary = data["volunteer_report_summary"]
    if "task_text" in data:
        task.task_text = _clean_task_text(data["task_text"])
    if task.task_text:
        rn_ids = data.get("report_number_ids")
        if rn_ids is None:
            rn_ids = [
                r for (r,) in db.query(models.TaskReportNumber.report_number_id).filter(
                    models.TaskReportNumber.task_id == task.id
                )
            ]
        _check_text_task(task.task_text, rn_ids)
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
    _apply_custom_values(
        db, org_id, task.id, data.get("picklist_values") or {},
        data.get("custom_field_values") or {},
    )

    db.commit()
    db.refresh(task)
    _email_assignment(background, org_id, newly_assigned, [task.id])
    return _single_out(db, org_id, task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    task = _get_or_404(task_id, current_user.organization_id, db)
    # fixes104 §2: links/values have no FK to tasks — clean them up by hand.
    picklist_utils.delete_links(db, "tasks", task.id)
    custom_field_utils.delete_values(db, "tasks", task.id)
    db.delete(task)
    db.commit()


# --- fixes65: orphan pool, QR claim, printing, paper entry ------------------


@router.post("/{task_id}/unassign", response_model=TaskOut)
def unassign_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """Spec §4 admin override: back to the orphan pool. The claim token is
    derived from the task's guid, so existing printouts stay valid for the
    next person who scans them."""
    org_id = current_user.organization_id
    task = _get_or_404(task_id, org_id, db)
    release(task)
    db.commit()
    db.refresh(task)
    return _single_out(db, org_id, task)


@router.post("/claim/{token}", response_model=ClaimResultOut)
def claim_task(
    token: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Spec §4: a signed-in user scanned an orphan task's QR. Returns
    `claimed` (now theirs), `yours` (already was), `taken` (another activist
    or the office has it) or `invalid` (bad/expired link, or another org's).
    Only activists (role shliach) can take a task; anyone else gets the
    current state back with an explanatory `detail`."""
    task = task_from_token(db, token)
    if task is None or task.organization_id != current_user.organization_id:
        return ClaimResultOut(state="invalid")
    if current_user.role != "shliach":
        if task.volunteer_user_id == current_user.id:
            return ClaimResultOut(state="yours", task_id=task.id)
        return ClaimResultOut(
            state="available" if is_orphan(task) else "taken",
            task_id=task.id,
            detail="Only activists can claim tasks",
        )
    state = claim(db, task, current_user)
    db.commit()
    return ClaimResultOut(state=state, task_id=task.id)


@router.get("/{task_id}/print-data", response_model=TaskPrintOut)
def task_print_data(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """Spec §3: everything the client-side PDF needs — the task, its
    apartments (grouped/sorted client-side like the apartments report) and
    the signed task token for the QR. fixes66 §1: every sheet gets it, not
    only unassigned ones — on an assigned task the same link is the
    activist's way into the system (the claim page offers sign-in)."""
    org_id = current_user.organization_id
    task = _get_or_404(task_id, org_id, db)
    rows = (
        db.query(models.Apartment, models.Building, models.ReportNumber, models.Area.area_name)
        .join(
            models.TaskReportNumber,
            models.TaskReportNumber.report_number_id == models.Apartment.report_number_id,
        )
        .join(models.Building, models.Building.id == models.Apartment.building_id)
        .outerjoin(models.Area, models.Area.id == models.Building.area_id)
        .join(models.ReportNumber, models.ReportNumber.id == models.Apartment.report_number_id)
        .filter(
            models.TaskReportNumber.task_id == task.id,
            models.Apartment.is_display.is_(True),
            models.Apartment.organization_id == org_id,
        )
        .all()
    )
    if not rows:
        raise HTTPException(status.HTTP_409_CONFLICT, "This task has no apartments to print")
    apartment_ids = [a.id for a, _b, _rn, _area in rows]
    # fixes69 §Admin3a: whatever's already on file (Jewish status, mezuzah,
    # language, notes) prints in the box instead of a blank one. fixes74 §9:
    # every picklist + custom field, for the admin-chosen extra columns.
    picklist_map = picklist_utils.get_values_bulk(db, org_id, "apartments", apartment_ids)
    language_map = picklist_utils.get_multi_values_bulk(
        db, org_id, "apartments", apartment_ids, "apartment.language"
    )
    custom_field_map = custom_field_utils.get_values_bulk(db, org_id, "apartment", apartment_ids)
    fixed_picklists = {
        "apartment.Jewish_status", "apartment.mezuzah_status", "apartment.campaign_status",
        "apartment.language",
    }
    return TaskPrintOut(
        task=_single_out(db, org_id, task),
        # fixes74 §4: no QR once the link is switched off.
        claim_token=make_claim_token(task.guid) if claim_link_enabled(task) else None,
        apartments=[
            TaskPrintApartment(
                id=a.id,
                building_id=b.id,
                building_name=b.building_name,
                building_address=b.building_address,
                floor=a.floor,
                apartment_name=a.apartment_name,
                name=a.name,
                report_number_name=rn.name,
                jewish_status=picklist_map.get(a.id, {}).get("apartment.Jewish_status"),
                mezuzah_status=picklist_map.get(a.id, {}).get("apartment.mezuzah_status"),
                language=language_map.get(a.id, []),
                apartment_notes=a.apartment_notes,
                phone=a.phone,
                email=a.email,
                campaign_status=picklist_map.get(a.id, {}).get("apartment.campaign_status"),
                area_name=area_name,
                picklist_values={
                    k: v
                    for k, v in picklist_map.get(a.id, {}).items()
                    if k not in fixed_picklists
                },
                custom_field_values={
                    k: v
                    for k, v in custom_field_map.get(a.id, {}).items()
                    if k != "to_knock"  # internal (fixes71 §C.3), never shown
                },
            )
            for a, b, rn, area_name in rows
        ],
    )


def _paper_entry_out(e: models.TaskPaperEntry) -> PaperEntryOut:
    if e.performer_unknown:
        performer_type = "unknown"
    elif e.performer_user_id is None and e.performer_name:
        performer_type = "name"
    else:
        performer_type = "user"
    return PaperEntryOut(
        id=e.id,
        task_id=e.task_id,
        performer_type=performer_type,
        performer_user_id=e.performer_user_id,
        performer_name=e.performer.full_name if e.performer else e.performer_name,
        entered_by_name=e.entered_by.full_name if e.entered_by else None,
        apartment_count=e.apartment_count,
        notes=e.notes,
        created_at=e.created_at,
    )


@router.get("/{task_id}/paper-entries", response_model=list[PaperEntryOut])
def list_paper_entries(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    task = _get_or_404(task_id, current_user.organization_id, db)
    entries = (
        db.query(models.TaskPaperEntry)
        .filter(models.TaskPaperEntry.task_id == task.id)
        .order_by(models.TaskPaperEntry.created_at.desc(), models.TaskPaperEntry.id.desc())
        .all()
    )
    return [_paper_entry_out(e) for e in entries]


# The columns of the printed task sheet an activist fills in by hand.
_PAPER_FIELDS = {"jewish_status", "mezuzah_status", "language", "apartment_notes"}


@router.post(
    "/{task_id}/paper-entries",
    response_model=PaperEntryOut,
    status_code=status.HTTP_201_CREATED,
)
def create_paper_entry(
    task_id: int,
    payload: PaperEntryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """Spec §6: the office types in a handwritten task sheet. "Who performed
    the work?" is mandatory — a registered user, a free-text name (logged
    here only; no account is created) or explicitly unknown. Each changed
    apartment goes through the normal versioned update. An orphan task
    leaves the pool: assigned to the registered performer, or locked as
    office-handled (`claimed_via='paper'`) so its QR shows as taken."""
    # Local import: routers.apartments is the owner of the versioning helpers.
    from app.picklist_utils import validate_picklist_value
    from app.routers.apartments import (
        _APARTMENT_LANGUAGE_FIELD_KEY,
        _apply_versioned_update,
        _split_picklist_changes,
        _validate_picklist_changes,
    )

    org_id = current_user.organization_id
    task = _get_or_404(task_id, org_id, db)

    performer_user = None
    performer_name = None
    if payload.performer_type == "user":
        if payload.performer_user_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Select who performed the work"
            )
        performer_user = _validate_volunteer(db, org_id, payload.performer_user_id)
    elif payload.performer_type == "name":
        performer_name = " ".join((payload.performer_name or "").split())
        if not performer_name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Enter the name of who performed the work",
            )

    # Only apartments that really belong to this task may be edited here.
    allowed_ids = {
        a_id
        for (a_id,) in db.query(models.Apartment.id)
        .join(
            models.TaskReportNumber,
            models.TaskReportNumber.report_number_id == models.Apartment.report_number_id,
        )
        .filter(
            models.TaskReportNumber.task_id == task.id,
            models.Apartment.is_display.is_(True),
            models.Apartment.organization_id == org_id,
        )
    }

    # Validate everything before the first (committing) versioned write.
    prepared = []
    for upd in payload.apartments:
        fields = set(upd.fields) & _PAPER_FIELDS
        if not fields:
            continue
        if upd.apartment_id not in allowed_ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Apartment does not belong to this task"
            )
        data = {f: getattr(upd, f) for f in fields if f != "language"}
        language_values = (upd.language or []) if "language" in fields else None
        for value in language_values or []:
            validate_picklist_value(db, org_id, _APARTMENT_LANGUAGE_FIELD_KEY, value)
        picklist_changes = _split_picklist_changes(data)
        _validate_picklist_changes(picklist_changes, org_id, db)
        prepared.append((upd.apartment_id, data, picklist_changes, language_values))

    for apartment_id, data, picklist_changes, language_values in prepared:
        _apply_versioned_update(
            db,
            db.get(models.Apartment, apartment_id),
            data,
            picklist_changes,
            current_user,
            {},
            language_values=language_values,
        )

    entry = models.TaskPaperEntry(
        organization_id=org_id,
        task_id=task.id,
        performer_user_id=performer_user.id if performer_user else None,
        performer_name=performer_name,
        performer_unknown=payload.performer_type == "unknown",
        entered_by_user_id=current_user.id,
        apartment_count=len(prepared),
        notes=(payload.notes or "").strip() or None,
    )
    db.add(entry)
    if is_orphan(task):
        if performer_user is not None:
            assign(task, performer_user.id, "paper")
        else:
            task.claimed_at = datetime.datetime.utcnow()
            task.claimed_via = "paper"
            if task.status == "AVAILABLE":
                task.status = "ACTIVE"
    db.commit()
    db.refresh(entry)
    return _paper_entry_out(entry)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    """fixes65 §6: a single task (the paper-entry page's header)."""
    org_id = current_user.organization_id
    return _single_out(db, org_id, _get_or_404(task_id, org_id, db))
