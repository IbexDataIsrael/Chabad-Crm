"""fixes65 §2/§4: orphan-task pool rules + QR claim execution, shared by the
public claim/registration endpoints and the authenticated tasks router."""
import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.core.claim_token import parse_claim_token


def is_orphan(task: models.Task) -> bool:
    """In the unassigned pool: nobody claimed it and the office isn't
    handling it from paper."""
    return task.volunteer_user_id is None and task.claimed_via != "paper"


def claim_link_enabled(task: models.Task) -> bool:
    """fixes74 §4: a manually assigned task's claim link is switched off
    (until it's returned to the pool, which clears `claimed_via`)."""
    return task.claimed_via != "manual"


def assign(task: models.Task, user_id: int, via: str) -> None:
    """Give the task to an activist (no commit). fixes74 §2/§4: an assigned
    task is "taken" — AVAILABLE becomes ACTIVE; a manual pick forces ACTIVE."""
    now = datetime.datetime.utcnow()
    task.volunteer_user_id = user_id
    task.claimed_at = now
    task.claimed_via = via
    task.assigned_at = now
    if via == "manual" or task.status == "AVAILABLE":
        task.status = "ACTIVE"


def release(task: models.Task) -> None:
    """Back to the orphan pool (no commit): the link works again and the
    task is available."""
    task.volunteer_user_id = None
    task.claimed_at = None
    task.claimed_via = None
    task.assigned_at = None
    if task.status == "ACTIVE":
        task.status = "AVAILABLE"


def task_from_token(db: Session, token: str) -> Optional[models.Task]:
    """The task a claim token points at, or None when the token is forged /
    malformed, the task was deleted, it's done (a finished task's printout
    stops working), or fixes74 §4 it was assigned manually. An
    unassigned-then-reclaimed task keeps the same token."""
    guid = parse_claim_token(token)
    if guid is None:
        return None
    task = db.query(models.Task).filter(models.Task.guid == guid).first()
    if task is None or task.status == "COMPLETED" or not claim_link_enabled(task):
        return None
    return task


def claim_state_for(task: Optional[models.Task], user: Optional[models.User]) -> str:
    if task is None:
        return "invalid"
    if user is not None and task.volunteer_user_id == user.id:
        return "yours"
    if not is_orphan(task):
        return "taken"
    return "available"


def claim(db: Session, task: models.Task, user: models.User) -> str:
    """Assign an orphan task to `user` (no commit). Returns the resulting
    state: 'yours' on success or when it already was theirs, else 'taken'."""
    state = claim_state_for(task, user)
    if state != "available":
        return state
    assign(task, user.id, "qr")
    return "claimed"


def task_apartment_count(db: Session, task_id: int) -> int:
    return (
        db.query(func.count(models.Apartment.id))
        .join(
            models.TaskReportNumber,
            models.TaskReportNumber.report_number_id == models.Apartment.report_number_id,
        )
        .filter(
            models.TaskReportNumber.task_id == task_id,
            models.Apartment.is_display.is_(True),
        )
        .scalar()
        or 0
    )
