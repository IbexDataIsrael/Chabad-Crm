"""Organization backup & restore points (fixes16).

Admin-only, org-scoped: one button creates a restore point (the org's CRM
data, compressed, stored in the org_backups table), another replaces the
current data with a chosen point — atomically, with an automatic safety
snapshot taken first so a restore can itself be undone. User accounts are
never backed up or touched. Retention: the newest BACKUP_RETENTION points.
"""
import datetime
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app import models
from app.core.backup import (
    AUTO_PRE_RESTORE_NOTE,
    create_snapshot,
    pack,
    prune_old_backups,
    restore_snapshot,
    snapshot_counts,
    unpack,
)
from app.database import get_db
from app.deps import require_admin
from app.schemas import BackupCreate, BackupOut, BackupRestoreResult

router = APIRouter(prefix="/api/backups", tags=["backups"])

logger = logging.getLogger("app.backups")


def _out(row: models.OrgBackup) -> BackupOut:
    try:
        counts = json.loads(row.counts or "{}")
    except ValueError:  # pragma: no cover — counts is always server-written
        counts = {}
    return BackupOut(
        id=row.id,
        guid=row.guid,
        note=row.note,
        kind=row.kind,
        created_by_name=row.created_by_name,
        created_at=row.created_at,
        counts=counts,
    )


def _get_or_404(backup_id: int, org_id: int, db: Session) -> models.OrgBackup:
    row = (
        db.query(models.OrgBackup)
        .filter(
            models.OrgBackup.id == backup_id,
            models.OrgBackup.organization_id == org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Backup not found")
    return row


def _log_event(db: Session, user: models.User, event: str) -> None:
    """Audit trail in the system access log (fixes16 §4)."""
    now = datetime.datetime.utcnow()
    db.add(
        models.SystemAccessLog(
            date=now.date(),
            time=now.time(),
            username=user.email or user.username,
            status=event,
            user_id=user.id,
            organization_id=user.organization_id,
        )
    )


def _make_backup_row(
    db: Session, admin: models.User, note: str | None, kind: str
) -> models.OrgBackup:
    """Snapshot the org now and store it as a restore point (no commit —
    callers own the transaction). Pruning past the retention limit included."""
    snapshot = create_snapshot(db, admin.organization_id)
    row = models.OrgBackup(
        organization_id=admin.organization_id,
        created_by_name=admin.full_name,
        note=(note or "").strip() or None,
        kind=kind,
        counts=json.dumps(snapshot_counts(snapshot), ensure_ascii=False),
        data=pack(snapshot),
    )
    db.add(row)
    db.flush()
    prune_old_backups(db, admin.organization_id)
    return row


@router.get("", response_model=list[BackupOut])
def list_backups(
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    rows = (
        db.query(models.OrgBackup)
        .filter(models.OrgBackup.organization_id == admin.organization_id)
        .order_by(models.OrgBackup.created_at.desc(), models.OrgBackup.id.desc())
        .all()
    )
    return [_out(r) for r in rows]


@router.post("", response_model=BackupOut, status_code=status.HTTP_201_CREATED)
def create_backup(
    payload: BackupCreate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Create a restore point of the data as it is right now."""
    row = _make_backup_row(db, admin, payload.note, kind="manual")
    _log_event(db, admin, "BACKUP_CREATED")
    db.commit()
    db.refresh(row)
    logger.info(
        "org %s: backup %s created by %s", admin.organization_id, row.id, admin.email
    )
    return _out(row)


@router.post("/{backup_id}/restore", response_model=BackupRestoreResult)
def restore_backup(
    backup_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """Replace the org's CRM data with this restore point — one transaction,
    all-or-nothing. A safety snapshot of the current state is created first so
    the restore itself can be undone. (If the org is at the retention limit,
    that safety snapshot may prune the oldest point — possibly the one being
    restored; its data is already loaded, so the restore still completes.)"""
    row = _get_or_404(backup_id, admin.organization_id, db)
    snapshot = unpack(row.data)
    safety = _make_backup_row(db, admin, AUTO_PRE_RESTORE_NOTE, kind="auto")
    restore_snapshot(db, admin.organization_id, snapshot, admin)
    _log_event(db, admin, "BACKUP_RESTORED")
    db.commit()
    logger.warning(
        "org %s: RESTORED backup %s by %s (safety backup %s)",
        admin.organization_id, backup_id, admin.email, safety.id,
    )
    return BackupRestoreResult(
        restored=snapshot_counts(snapshot), safety_backup_id=safety.id
    )


@router.get("/{backup_id}/download")
def download_backup(
    backup_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """The restore point as a readable JSON file (fixes16 §1 nice-to-have)."""
    row = _get_or_404(backup_id, admin.organization_id, db)
    snapshot = unpack(row.data)
    stamp = (row.created_at or datetime.datetime.utcnow()).strftime("%Y%m%d-%H%M")
    filename = f"crm-backup-{admin.organization_id}-{stamp}.json"
    return Response(
        content=json.dumps(snapshot, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
