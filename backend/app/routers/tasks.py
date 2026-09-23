"""Task CRUD (fixes58 §3.3/§3.4), org-scoped. Admin + Campaign Manager only,
same gate as Campaigns. A Task assigns a volunteer (a real login, `users.id`
— see `docs/plan58-plan.md` decision #2) to one or more report numbers under
a Campaign; `_shliach_apartment_ids` (`routers/apartments.py`) grants
apartment access while the Task is ACTIVE under an active Campaign.
"""
import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.core.claim_token import make_claim_token
from app.core.task_claim import claim, is_orphan, task_from_token
from app.database import get_db
from app.deps import get_current_user, require_admin_or_campaign_manager
from app.schemas import (
    ClaimResultOut,
    PaperEntryCreate,
    PaperEntryOut,
    TaskCreate,
    TaskOut,
    TaskPageOut,
    TaskPrintApartment,
    TaskPrintOut,
    TaskUpdate,
)

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


def _latest_reports_by_volunteer(
    db: Session, org_id: int, user_ids: list[int]
) -> dict[int, tuple[str, Optional[str]]]:
    """fixes60 §1/decision #2: the Tasks page's report column is the
    volunteer's own most recent `ShliachReportCompletion`, not literally
    scoped per-task — that table has no task_id (and no UI collects one on
    submission). Resolved the same way apartment access is: by the shliach's
    linked user_id, falling back to an email match for an unlinked contact
    (fixes21). Batched across the whole page's rows in 3 queries total, not
    one per row."""
    result: dict[int, tuple[str, Optional[str]]] = {}
    if not user_ids:
        return result

    contact_id_by_user: dict[int, int] = {}
    linked = (
        db.query(models.ContactShliach.user_id, models.ContactShliach.contact_id)
        .filter(
            models.ContactShliach.organization_id == org_id,
            models.ContactShliach.user_id.in_(user_ids),
            models.ContactShliach.is_display.is_(True),
        )
        .all()
    )
    for uid, cid in linked:
        contact_id_by_user[uid] = cid

    unresolved_ids = [uid for uid in user_ids if uid not in contact_id_by_user]
    if unresolved_ids:
        unresolved_users = {
            u.id: u.email
            for u in db.query(models.User.id, models.User.email).filter(
                models.User.id.in_(unresolved_ids), models.User.email.isnot(None)
            )
        }
        if unresolved_users:
            by_email = (
                db.query(models.Contact.email, models.ContactShliach.contact_id)
                .join(models.ContactShliach, models.ContactShliach.contact_id == models.Contact.id)
                .filter(
                    models.ContactShliach.organization_id == org_id,
                    models.ContactShliach.is_display.is_(True),
                    models.Contact.email.in_(unresolved_users.values()),
                )
                .all()
            )
            email_to_contact = {email: cid for email, cid in by_email}
            for uid, email in unresolved_users.items():
                if email in email_to_contact:
                    contact_id_by_user[uid] = email_to_contact[email]

    contact_ids = list(set(contact_id_by_user.values()))
    if not contact_ids:
        return result
    rows = (
        db.query(
            models.ShliachReportCompletion.contact_id,
            models.ShliachReportCompletion.status,
            models.ShliachReportCompletion.comments,
        )
        .filter(models.ShliachReportCompletion.contact_id.in_(contact_ids))
        .order_by(models.ShliachReportCompletion.created_at.desc())
        .all()
    )
    latest_by_contact: dict[int, tuple[str, Optional[str]]] = {}
    for contact_id, report_status, comments in rows:
        latest_by_contact.setdefault(contact_id, (report_status, comments))

    for uid, cid in contact_id_by_user.items():
        if cid in latest_by_contact:
            result[uid] = latest_by_contact[cid]
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


def _to_out(
    task: models.Task,
    report_numbers: list[tuple[int, str]],
    latest_report: Optional[tuple[str, Optional[str]]] = None,
    apartment_count: int = 0,
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
        report_number_ids=[rn_id for rn_id, _ in report_numbers],
        report_number_names=[name for _, name in report_numbers],
        status=task.status,
        volunteer_report_summary=task.volunteer_report_summary,
        latest_report_status=latest_report[0] if latest_report else None,
        latest_report_notes=latest_report[1] if latest_report else None,
        claimed_at=task.claimed_at,
        claimed_via=task.claimed_via,
        is_orphan=is_orphan(task),
        apartment_count=apartment_count,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def _single_out(db: Session, org_id: int, task: models.Task) -> TaskOut:
    rn_by_task = _report_numbers_by_task(db, [task.id])
    reports = (
        _latest_reports_by_volunteer(db, org_id, [task.volunteer_user_id])
        if task.volunteer_user_id
        else {}
    )
    return _to_out(
        task,
        rn_by_task.get(task.id, []),
        reports.get(task.volunteer_user_id),
        _apartment_counts_by_task(db, [task.id]).get(task.id, 0),
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


@router.get("/list", response_model=TaskPageOut)
def list_tasks(
    status_filter: Optional[list[str]] = Query(None, alias="status"),
    campaign_id: Optional[list[int]] = Query(None),
    # fixes65 §8: "orphan" = the unassigned pool (printed, unclaimed).
    assignment: Optional[Literal["orphan", "assigned"]] = None,
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
    reports_by_volunteer = _latest_reports_by_volunteer(
        db, org_id, list({t.volunteer_user_id for t in rows if t.volunteer_user_id})
    )
    apt_counts = _apartment_counts_by_task(db, [t.id for t in rows])
    return TaskPageOut(
        items=[
            _to_out(
                t,
                rn_by_task.get(t.id, []),
                reports_by_volunteer.get(t.volunteer_user_id),
                apt_counts.get(t.id, 0),
            )
            for t in rows
        ],
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
    return _single_out(db, org_id, task)


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
    # fixes65 §4: an admin assigning (or reassigning) the task by hand. An
    # explicit null is ignored here — unassign has its own endpoint, which
    # also clears the claim audit.
    new_volunteer = data.get("volunteer_user_id")
    if new_volunteer is not None and new_volunteer != task.volunteer_user_id:
        _validate_volunteer(db, org_id, new_volunteer)
        task.volunteer_user_id = new_volunteer
        task.claimed_at = None
        task.claimed_via = None
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
    return _single_out(db, org_id, task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_campaign_manager),
):
    task = _get_or_404(task_id, current_user.organization_id, db)
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
    task.volunteer_user_id = None
    task.claimed_at = None
    task.claimed_via = None
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
    apartments (grouped/sorted client-side like the apartments report) and,
    only for an unassigned task, the signed claim token for the QR."""
    org_id = current_user.organization_id
    task = _get_or_404(task_id, org_id, db)
    rows = (
        db.query(models.Apartment, models.Building, models.ReportNumber)
        .join(
            models.TaskReportNumber,
            models.TaskReportNumber.report_number_id == models.Apartment.report_number_id,
        )
        .join(models.Building, models.Building.id == models.Apartment.building_id)
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
    return TaskPrintOut(
        task=_single_out(db, org_id, task),
        claim_token=make_claim_token(task.guid) if is_orphan(task) else None,
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
            )
            for a, b, rn in rows
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
        task.claimed_at = datetime.datetime.utcnow()
        task.claimed_via = "paper"
        if performer_user is not None:
            task.volunteer_user_id = performer_user.id
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
