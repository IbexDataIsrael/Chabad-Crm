"""fixes53 §7/§9: an activist's self-service status/feedback submissions —
"Report completed" (3-choice + comment) and "Comments about the system", both
reachable only from a shliach's own self-edit page. Writes are shliach-only,
self-scoped (resolved via their own login, never an arbitrary contact_id);
reads (the org-wide log for /dashboard/messages-from-activists) are
admin-only.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.core.shliach import resolve_shliach
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.schemas import (
    ReportCompletionCreate,
    ReportCompletionOut,
    ShliachSummary,
    SystemCommentCreate,
    SystemCommentOut,
)

router = APIRouter(prefix="/api/shliach-messages", tags=["shliach-messages"])


def _resolve_self_contact_id(db: Session, current_user: models.User) -> int:
    if current_user.role != "shliach":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only an activist can submit this"
        )
    shliach = resolve_shliach(db, current_user)
    if not shliach:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No linked activist profile")
    return shliach.contact_id


@router.post(
    "/report-completions",
    response_model=ReportCompletionOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_report_completion(
    payload: ReportCompletionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact_id = _resolve_self_contact_id(db, current_user)
    row = models.ShliachReportCompletion(
        organization_id=current_user.organization_id,
        contact_id=contact_id,
        status=payload.status,
        comments=payload.comments,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    contact = db.get(models.Contact, contact_id)
    return ReportCompletionOut(
        id=row.id,
        guid=row.guid,
        status=row.status,
        comments=row.comments,
        created_at=row.created_at,
        activist=ShliachSummary(id=contact.id, name=contact.name, last_name=contact.last_name),
    )


@router.get("/report-completions", response_model=list[ReportCompletionOut])
def list_report_completions(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """fixes53 §9: the full org log, newest first, for /dashboard/messages-
    from-activists."""
    rows = (
        db.query(models.ShliachReportCompletion, models.Contact)
        .join(models.Contact, models.Contact.id == models.ShliachReportCompletion.contact_id)
        .filter(models.ShliachReportCompletion.organization_id == admin.organization_id)
        .order_by(models.ShliachReportCompletion.created_at.desc())
        .all()
    )
    return [
        ReportCompletionOut(
            id=r.id, guid=r.guid, status=r.status, comments=r.comments,
            created_at=r.created_at,
            activist=ShliachSummary(id=c.id, name=c.name, last_name=c.last_name),
        )
        for r, c in rows
    ]


@router.post(
    "/system-comments",
    response_model=SystemCommentOut,
    status_code=status.HTTP_201_CREATED,
)
def submit_system_comment(
    payload: SystemCommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    contact_id = _resolve_self_contact_id(db, current_user)
    comment = payload.comment.strip()
    if not comment:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "comment cannot be blank")
    row = models.ShliachSystemComment(
        organization_id=current_user.organization_id,
        contact_id=contact_id,
        comment=comment,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    contact = db.get(models.Contact, contact_id)
    return SystemCommentOut(
        id=row.id, guid=row.guid, comment=row.comment, created_at=row.created_at,
        activist=ShliachSummary(id=contact.id, name=contact.name, last_name=contact.last_name),
    )


@router.get("/system-comments", response_model=list[SystemCommentOut])
def list_system_comments(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rows = (
        db.query(models.ShliachSystemComment, models.Contact)
        .join(models.Contact, models.Contact.id == models.ShliachSystemComment.contact_id)
        .filter(models.ShliachSystemComment.organization_id == admin.organization_id)
        .order_by(models.ShliachSystemComment.created_at.desc())
        .all()
    )
    return [
        SystemCommentOut(
            id=r.id, guid=r.guid, comment=r.comment, created_at=r.created_at,
            activist=ShliachSummary(id=c.id, name=c.name, last_name=c.last_name),
        )
        for r, c in rows
    ]
