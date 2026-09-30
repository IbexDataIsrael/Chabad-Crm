"""Clone an organization's full CRM data set into a brand-new organization.

Distinct from org backup/restore (app/core/backup.py), which restores a
snapshot back into the SAME org, reusing the rows' original ids (safe only
because the org's own rows were just wiped, freeing those exact ids). A clone
leaves the source org untouched, so every copied row needs a brand-new id and
every internal reference (FK columns, and the polymorphic entity_table/
entity_id pairs used by custom fields and picklists) has to be rewired to
point at the new rows — never at the source org's.

User accounts are never cloned — the caller supplies fresh admin credentials
for the new org instead, matching how a backup snapshot never carries user
rows either. Columns that reference a user (Contact.assigned_user_id,
Apartment.editor_id, ContactShliach.user_id) are nulled on the copy.

Optional per-table row caps (`table_limits`, keyed by `__tablename__` — the
same string used as `entity_table`) let the caller avoid dragging a source
org's largest tables (e.g. 25k+ apartments) into what's meant to be a small
sample/demo copy. A capped table keeps its highest-id rows (most recently
created). Any row elsewhere in the plan whose *required* (NOT NULL) FK
points at a row that a cap left out is dropped rather than inserted with a
dangling reference; a nullable FK is set NULL instead (e.g. a mekurav whose
apartment didn't make the cut just ends up unhoused in the copy).
"""
import logging

from sqlalchemy.orm import Session

from app import models
from app.core.security import hash_password

logger = logging.getLogger(__name__)

# Parent -> child order (same dependency ordering app.core.backup.
# SNAPSHOT_MODELS already proves safe). Each entry is
# (model, {column: target_table}, is_polymorphic):
#   - target_table is another model's __tablename__ to remap that FK column
#     through, or "self" for a self-referential FK (e.g. Apartment.root_id —
#     always points at an earlier id within the same table, per its own
#     versioning invariant, so it's resolvable against the in-progress map).
#   - is_polymorphic=True means the model carries entity_table/entity_id
#     columns (PicklistLink, CustomFieldValue) whose target table is decided
#     per-row by the stored entity_table value.
_CLONE_PLAN: list[tuple[type, dict[str, str], bool]] = [
    (models.Area, {}, False),
    (models.AdminArea, {}, False),
    (models.ReportNumber, {}, False),
    (models.Building, {"area_id": "areas"}, False),
    (models.Floor, {"building_id": "buildings"}, False),
    (
        models.Apartment,
        {"building_id": "buildings", "report_number_id": "report_number", "root_id": "self"},
        False,
    ),
    (models.Contact, {}, False),
    (
        models.ContactMekurav,
        {"contact_id": "contacts", "apartment_id": "apartments", "admin_area_id": "admin_areas"},
        False,
    ),
    # fixes83: root_id (version lineage) used to keep pointing at the SOURCE
    # org's versions.
    (models.ContactShliach, {"contact_id": "contacts", "root_id": "self"}, False),
    (
        models.ReportNumberContactShliach,
        {"report_number_id": "report_number", "contact_shliach_id": "contact_shliach"},
        False,
    ),
    (models.ContactShliachArea, {"contact_shliach_id": "contact_shliach", "area_id": "areas"}, False),
    (models.CustomFieldDefinition, {}, False),
    (models.SignificantDate, {}, False),
    (
        models.ContactMekuravSpecialDate,
        {"contact_mekurav_id": "contact_mekurav", "special_date_id": "significant_dates"},
        False,
    ),
    (models.SignificantDateReminder, {"significant_date_id": "significant_dates"}, False),
    # fixes83: apartment_id used to keep pointing at the SOURCE org's apartment.
    (models.VisitHistory, {"contact_id": "contacts", "apartment_id": "apartments"}, False),
    (
        models.CustomFieldValue,
        {"definition_id": "custom_field_definitions", "visit_id": "visit_history"},
        True,
    ),
    (models.Donation, {"contact_id": "contacts"}, False),
    (models.PicklistDefinition, {}, False),
    (models.PicklistValue, {}, False),
    (
        models.PicklistLink,
        {"picklist_definition_id": "picklists", "picklist_value_id": "picklist_values"},
        True,
    ),
    (models.FieldSetting, {}, False),
]

# Columns that reference a user — never cloned (no user rows are copied),
# always nulled on the copy regardless of what the source pointed at.
_USER_FK_COLUMNS = {"assigned_user_id", "editor_id", "user_id"}

# fixes83: columns that must not be copied verbatim either —
#   client_uuid: VisitHistory's offline-sync dedupe key, GLOBALLY unique, so
#     copying it crashed every clone of an org with synced visits
#     (UniqueViolation ix_visit_history_client_uuid, prod 2026-09-30);
#   campaign_id: campaigns aren't cloned, so it would point at the source
#     org's campaign.
_NULLED_COLUMNS = {"client_uuid", "campaign_id"}


def clone_organization(
    db: Session,
    source_org_id: int,
    new_org_name: str,
    admin_username: str,
    admin_full_name: str,
    admin_email: str,
    admin_password: str,
    table_limits: dict[str, int] | None = None,
) -> models.Organization:
    """Copy every CRM row belonging to `source_org_id` into a brand-new
    organization, with fresh ids/guids and every internal reference rewired.
    Runs inside the caller's transaction — the caller commits; on any error
    the caller should roll back (a partially-inserted clone must never be
    left committed).

    `table_limits` optionally caps how many rows are copied for one or more
    tables (keyed by `__tablename__`, e.g. {"apartments": 500}) — see the
    module docstring for what happens to rows elsewhere that referenced a
    row a cap left out."""
    source = db.get(models.Organization, source_org_id)
    if source is None:
        raise ValueError(f"organization {source_org_id} not found")

    new_org = models.Organization(
        name=new_org_name,
        logo_url=source.logo_url,
        map_in_english=source.map_in_english,
        default_lat=source.default_lat,
        default_lng=source.default_lng,
        default_zoom=source.default_zoom,
        shliach_can_view_contacts=source.shliach_can_view_contacts,
        report_notes=source.report_notes,
        label_font_size=source.label_font_size,
        label_color=source.label_color,
        label_font_family=source.label_font_family,
        is_active=True,
        approval_status="approved",
    )
    db.add(new_org)
    db.flush()

    db.add(
        models.User(
            organization_id=new_org.id,
            username=admin_username,
            full_name=admin_full_name,
            email=admin_email,
            password_hash=hash_password(admin_password),
            role="admin",
            is_active=True,
            email_verified=True,
        )
    )
    db.flush()

    # old id -> new id, per table — keyed by __tablename__, which is exactly
    # the string stored in entity_table on polymorphic rows.
    id_maps: dict[str, dict[int, int]] = {}

    for model, fk_remap, is_polymorphic in _CLONE_PLAN:
        tablename = model.__tablename__
        nullable_by_column = {col.name: col.nullable for col in model.__table__.columns}
        query = db.query(model).filter(model.organization_id == source_org_id)
        limit = (table_limits or {}).get(tablename)
        if limit is not None:
            limit = max(0, limit)
            # Keep the most recently created rows. Re-sorted back to ascending
            # id below — self-referential FKs (e.g. Apartment.root_id) only
            # resolve if an earlier-id row in the same table was already
            # cloned before a later one that points at it.
            rows = (
                query.order_by(model.id.desc()).limit(limit).all()
            )
            rows.reverse()
        else:
            rows = query.order_by(model.id).all()

        id_map: dict[int, int] = {}
        skipped = 0
        for row in rows:
            data = {
                col.name: getattr(row, col.name)
                for col in model.__table__.columns
                if col.name not in ("id", "guid")
            }
            data["organization_id"] = new_org.id
            orphaned = False
            for column, target_table in fk_remap.items():
                old_value = data.get(column)
                if old_value is None:
                    continue
                target_map = id_map if target_table == "self" else id_maps[target_table]
                new_value = target_map.get(old_value)
                if new_value is None and not nullable_by_column[column]:
                    # The row this FK pointed to was left out by a table cap
                    # (elsewhere in the plan) — can't insert a required FK as
                    # NULL, so this row can't be cloned either.
                    orphaned = True
                    break
                data[column] = new_value
            if orphaned:
                skipped += 1
                continue
            if is_polymorphic and data.get("entity_id") is not None:
                new_entity_id = id_maps[data["entity_table"]].get(data["entity_id"])
                if new_entity_id is None:
                    # A polymorphic link/value pointing at nothing real is
                    # never useful, capped nullable column or not.
                    skipped += 1
                    continue
                data["entity_id"] = new_entity_id
            for column in _USER_FK_COLUMNS | _NULLED_COLUMNS:
                if column in data:
                    data[column] = None
            new_row = model(**data)
            db.add(new_row)
            db.flush()
            id_map[row.id] = new_row.id
        id_maps[tablename] = id_map
        if limit is not None:
            logger.info(
                "org_clone: %s capped at %d — cloned %d, skipped %d (dangling required FK)",
                tablename, limit, len(id_map), skipped,
            )
        elif skipped:
            logger.info(
                "org_clone: %s cloned %d, skipped %d (dangling required FK from a capped table)",
                tablename, len(id_map), skipped,
            )

    return new_org
