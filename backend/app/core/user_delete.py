"""fixes75 §11: everything that has to happen before a user row can be
deleted, shared by the org admin's delete (routers/users.py) and the
superadmin's (routers/admin.py).

An activist can be bound two ways, and both stay supported for everyone
else: through tasks, and directly to report numbers / areas on their
ContactShliach. Deleting the user:
  a. returns their tasks to the pool (unassigned / פנוי);
  b. clears their own direct report-number and area bindings, as a new
     ContactShliach version so the edit history still shows what they had;
  c. keeps every history row (paper entries, building completions, apartment
     and shliach edit history) with the user reference cleared.
"""
from sqlalchemy.orm import Session

from app import models
from app.core.shliach import (
    apply_shliach_versioned_update,
    resolve_shliach,
    set_shliach_areas,
    set_shliach_report_numbers,
)
from app.core.task_claim import release


def clear_user_references(db: Session, user: models.User, actor: models.User) -> None:
    """Detach `user` from every row that points at it (no commit)."""
    # a. Tasks: back to the pool. A finished task keeps its COMPLETED status
    # (only the reference goes); anything still open becomes AVAILABLE.
    for task in db.query(models.Task).filter(models.Task.volunteer_user_id == user.id):
        release(task)
        if task.status != "COMPLETED":
            task.status = "AVAILABLE"

    # b. Direct bindings on the user's own activist record.
    linked = resolve_shliach(db, user)
    if linked is not None and linked.user_id not in (None, user.id):
        linked = None  # email fallback hit another login's record — not theirs
    if linked is not None and (linked.report_numbers or linked.areas):
        new = apply_shliach_versioned_update(db, linked, {"user_id": None}, actor)
        set_shliach_areas(db, new, [], user.organization_id)
        set_shliach_report_numbers(db, new, [], user.organization_id)

    # Every shliach version (historical ones too) carries user_id forward.
    db.query(models.ContactShliach).filter(
        models.ContactShliach.user_id == user.id
    ).update({models.ContactShliach.user_id: None}, synchronize_session=False)

    # Contacts assigned to them become unassigned (guid FK, fixes10).
    db.query(models.Contact).filter(
        models.Contact.assigned_user_id == user.guid
    ).update({models.Contact.assigned_user_id: None}, synchronize_session=False)

    # c. History keeps its rows; only the reference is cleared. The DB FKs are
    # ON DELETE SET NULL already — done explicitly so it holds on any engine.
    for model, column in (
        (models.TaskPaperEntry, models.TaskPaperEntry.performer_user_id),
        (models.TaskPaperEntry, models.TaskPaperEntry.entered_by_user_id),
        (models.CampaignBuildingCompletion, models.CampaignBuildingCompletion.completed_by_user_id),
        (models.Apartment, models.Apartment.editor_id),
        (models.ContactShliach, models.ContactShliach.editor_id),
        (models.SystemAccessLog, models.SystemAccessLog.user_id),
        (models.ErrorLog, models.ErrorLog.user_id),
        (models.ActivityLog, models.ActivityLog.user_id),
    ):
        db.query(model).filter(column == user.id).update(
            {column: None}, synchronize_session=False
        )

    # Per-user data with no meaning without the user.
    db.query(models.UserPreference).filter(
        models.UserPreference.user_id == user.id
    ).delete(synchronize_session=False)
    db.query(models.StreetActivityEvent).filter(
        models.StreetActivityEvent.user_id == user.id
    ).delete(synchronize_session=False)
    # fixes113: their assistant proposals (the contacts they created stay).
    db.query(models.AssistantProposal).filter(
        models.AssistantProposal.user_id == user.id
    ).delete(synchronize_session=False)
    # fixes118: their request_id proofs of write.
    db.query(models.AssistantRequest).filter(
        models.AssistantRequest.user_id == user.id
    ).delete(synchronize_session=False)
    db.flush()
