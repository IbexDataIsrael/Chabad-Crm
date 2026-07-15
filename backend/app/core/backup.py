"""Organization backup snapshots + restore (fixes16).

A snapshot is a plain JSON document — every org-scoped CRM row of every model
in SNAPSHOT_MODELS, serialized column-by-column — stored zlib-compressed in
the `org_backups` table. Restore wipes the org's current CRM rows and
re-inserts the snapshot's rows **with their original ids**: ids are never
reused (sequences only move forward), so after deleting the org's rows the
snapshot ids are guaranteed free, and every internal FK in the snapshot stays
valid without remapping.

User accounts are never part of a snapshot; links from restored rows to users
that no longer exist are repaired instead (nulled, or reassigned to the
restoring admin where the column is NOT NULL).
"""
import datetime
import json
import zlib

from sqlalchemy import Date, DateTime, Time
from sqlalchemy.orm import Session

from app import models

# Restore points kept per organization; creating one past the limit deletes
# the oldest (fixes16 §2).
BACKUP_RETENTION = 10

# Note stamped on the automatic safety snapshot taken right before a restore.
AUTO_PRE_RESTORE_NOTE = "אוטומטי — לפני שחזור"

# Org-scoped CRM models in parent→child insert order (restore inserts in this
# order; the wipe runs in reverse). Users / Organization / access logs /
# email templates are deliberately NOT part of a snapshot.
SNAPSHOT_MODELS = [
    models.Area,
    models.AdminArea,
    models.ReportNumber,  # before Apartment (apartments.report_number_id FK)
    models.Building,
    models.Floor,
    models.Apartment,
    models.Contact,
    models.ContactMekurav,
    models.ContactShliach,
    models.ReportNumberContactShliach,
    models.ContactShliachArea,
    models.CustomFieldDefinition,
    models.SignificantDate,
    models.ContactMekuravSpecialDate,
    models.SignificantDateReminder,
    models.VisitHistory,
    models.CustomFieldValue,  # visit-scoped, after VisitHistory (fixes25)
    models.Donation,
    models.PicklistDefinition,
    models.PicklistValue,
    models.ContactPicklistValue,
    models.FieldSetting,
]

# Models scoped through their visit rather than an organization_id column
# (fixes25 — custom-field values moved from contacts onto visits).
_VISIT_SCOPED = (models.CustomFieldValue,)

# What the counts summary reports (tablename → summary key).
_COUNT_TABLES = {
    "contacts": "contacts",
    "apartments": "apartments",
    "buildings": "buildings",
    "areas": "areas",
    "visit_history": "visits",
    "donations": "donations",
}


def _dump_rows(db: Session, model, org_id: int, visit_ids: list[int]) -> list[dict]:
    if model in _VISIT_SCOPED:
        query = db.query(model).filter(model.visit_id.in_(visit_ids))
    else:
        query = db.query(model).filter(model.organization_id == org_id)
    rows = []
    for obj in query.all():
        row = {}
        for col in model.__table__.columns:
            value = getattr(obj, col.name)
            if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
                value = value.isoformat()
            row[col.name] = value
        rows.append(row)
    return rows


def create_snapshot(db: Session, org_id: int) -> dict:
    """The org's CRM data as one JSON-serializable document."""
    visit_ids = [
        vid
        for (vid,) in db.query(models.VisitHistory.id)
        .filter(models.VisitHistory.organization_id == org_id)
        .all()
    ]
    tables = {
        model.__tablename__: _dump_rows(db, model, org_id, visit_ids)
        for model in SNAPSHOT_MODELS
    }
    return {
        "version": 1,
        "organization_id": org_id,
        "created_at": datetime.datetime.utcnow().isoformat(),
        "tables": tables,
    }


def snapshot_counts(snapshot: dict) -> dict[str, int]:
    tables = snapshot.get("tables", {})
    counts = {
        key: len(tables.get(tablename, []))
        for tablename, key in _COUNT_TABLES.items()
    }
    counts["total_rows"] = sum(len(rows) for rows in tables.values())
    return counts


def pack(snapshot: dict) -> bytes:
    return zlib.compress(json.dumps(snapshot, ensure_ascii=False).encode("utf-8"))


def unpack(blob: bytes) -> dict:
    return json.loads(zlib.decompress(blob).decode("utf-8"))


def _parse_row(model, row: dict) -> dict:
    """ISO strings back to date/time objects, unknown columns dropped (the
    schema may have gained or lost columns since the snapshot was taken)."""
    known = {c.name: c for c in model.__table__.columns}
    parsed = {}
    for name, value in row.items():
        col = known.get(name)
        if col is None:
            continue
        if isinstance(value, str):
            if isinstance(col.type, DateTime):
                value = datetime.datetime.fromisoformat(value)
            elif isinstance(col.type, Date):
                value = datetime.date.fromisoformat(value)
            elif isinstance(col.type, Time):
                value = datetime.time.fromisoformat(value)
        parsed[name] = value
    return parsed


def restore_snapshot(
    db: Session, org_id: int, snapshot: dict, acting_user: models.User
) -> None:
    """Replace the org's CRM data with the snapshot's, inside the caller's
    transaction (the caller commits; any failure rolls everything back)."""
    tables = snapshot.get("tables", {})

    # Wipe the current org rows, children first.
    visit_ids_query = db.query(models.VisitHistory.id).filter(
        models.VisitHistory.organization_id == org_id
    )
    for model in reversed(SNAPSHOT_MODELS):
        if model in _VISIT_SCOPED:
            db.query(model).filter(
                model.visit_id.in_(visit_ids_query)
            ).delete(synchronize_session=False)
        else:
            db.query(model).filter(model.organization_id == org_id).delete(
                synchronize_session=False
            )
    db.flush()

    # Valid user links, for repairing references to since-deleted users.
    org_users = (
        db.query(models.User.id, models.User.guid)
        .filter(models.User.organization_id == org_id)
        .all()
    )
    valid_user_ids = {uid for uid, _ in org_users}
    valid_user_guids = {guid for _, guid in org_users}

    for model in SNAPSHOT_MODELS:
        rows = [
            _parse_row(model, dict(r)) for r in tables.get(model.__tablename__, [])
        ]
        if model is models.CustomFieldValue:
            # Pre-fixes25 snapshots stored contact-scoped values (no visit_id);
            # those rows can't satisfy the NOT NULL visit FK — skip them.
            rows = [r for r in rows if r.get("visit_id") is not None]
        if not rows:
            continue
        if model is models.Apartment:
            # fixes19: root_id is a self-FK; a version's root always has the
            # smaller id, so id order inserts parents first.
            rows.sort(key=lambda r: r.get("id") or 0)
        for row in rows:
            # Snapshots are server-created for this same org, but force the
            # tenant scope anyway — a snapshot must never write another org.
            if "organization_id" in row:
                row["organization_id"] = org_id
            if model is models.Contact and row.get("assigned_user_id") not in (
                None,
                *valid_user_guids,
            ):
                row["assigned_user_id"] = None
            elif model is models.ContactShliach and row.get("user_id") not in (
                None,
                *valid_user_ids,
            ):
                row["user_id"] = None
            elif model is models.Apartment and row.get("editor_id") not in (
                None,
                *valid_user_ids,
            ):
                # fixes19: the version-history editor stamp is a user link.
                row["editor_id"] = None
        db.execute(model.__table__.insert(), rows)
    db.flush()


def prune_old_backups(db: Session, org_id: int) -> None:
    """Keep only the newest BACKUP_RETENTION restore points for the org."""
    stale_ids = [
        bid
        for (bid,) in db.query(models.OrgBackup.id)
        .filter(models.OrgBackup.organization_id == org_id)
        .order_by(models.OrgBackup.created_at.desc(), models.OrgBackup.id.desc())
        .offset(BACKUP_RETENTION)
        .all()
    ]
    if stale_ids:
        db.query(models.OrgBackup).filter(
            models.OrgBackup.id.in_(stale_ids)
        ).delete(synchronize_session=False)
