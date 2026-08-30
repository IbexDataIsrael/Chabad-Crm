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
    ShliachAnnouncementCreate,
    ShliachAnnouncementOut,
    ShliachAnnouncementUpdate,
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


# fixes54 §5/§6.1: admin-authored announcements for the activist landing
# page's feed. Reads are open to any org member (a shliach needs their own
# org's feed); a non-admin caller only ever sees is_visible=True rows — the
# filter lives here, not trusted to the frontend. Writes (full CRUD) are
# admin-only, same split as the picklist registry.
@router.get("/announcements", response_model=list[ShliachAnnouncementOut])
def list_announcements(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.ShliachAnnouncement).filter(
        models.ShliachAnnouncement.organization_id == current_user.organization_id
    )
    if current_user.role != "admin":
        query = query.filter(models.ShliachAnnouncement.is_visible.is_(True))
    return query.order_by(models.ShliachAnnouncement.created_at.desc()).all()


@router.post(
    "/announcements",
    response_model=ShliachAnnouncementOut,
    status_code=status.HTTP_201_CREATED,
)
def create_announcement(
    payload: ShliachAnnouncementCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = models.ShliachAnnouncement(
        organization_id=admin.organization_id,
        message_title=payload.message_title,
        message_content=payload.message_content,
        is_visible=payload.is_visible,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _get_announcement_or_404(
    announcement_id: int, org_id: int, db: Session
) -> models.ShliachAnnouncement:
    row = (
        db.query(models.ShliachAnnouncement)
        .filter(
            models.ShliachAnnouncement.id == announcement_id,
            models.ShliachAnnouncement.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found")
    return row


@router.put("/announcements/{announcement_id}", response_model=ShliachAnnouncementOut)
def update_announcement(
    announcement_id: int,
    payload: ShliachAnnouncementUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = _get_announcement_or_404(announcement_id, admin.organization_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/announcements/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(
    announcement_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    row = _get_announcement_or_404(announcement_id, admin.organization_id, db)
    db.delete(row)
    db.commit()
