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
import math
from itertools import combinations
from typing import Optional

from sqlalchemy import func, or_
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
    # fixes87: demo clones only (empty selection otherwise) — the chosen
    # activists' tasks, their campaigns and task↔report-number links.
    (models.Campaign, {}, False),
    (
        models.Task,
        {"campaign_id": "campaigns", "custom_date_value_id": "picklist_values"},
        False,
    ),
    (
        models.TaskReportNumber,
        {"task_id": "tasks", "report_number_id": "report_number"},
        False,
    ),
]

# Columns that reference a user — never cloned (no user rows are copied),
# always nulled on the copy regardless of what the source pointed at.
_USER_FK_COLUMNS = {"assigned_user_id", "editor_id", "user_id", "volunteer_user_id"}
# fixes87: of those, the integer user ids a demo clone points at the new demo
# logins (assigned_user_id stores a user GUID — always nulled).
_DEMO_MAPPED_USER_COLUMNS = {"user_id", "volunteer_user_id"}

# fixes83: columns that must not be copied verbatim either —
#   client_uuid: VisitHistory's offline-sync dedupe key, GLOBALLY unique, so
#     copying it crashed every clone of an org with synced visits
#     (UniqueViolation ix_visit_history_client_uuid, prod 2026-09-30);
#   campaign_id: campaigns aren't cloned, so it would point at the source
#     org's campaign.
_NULLED_COLUMNS = {"client_uuid", "campaign_id"}


def _whole_building_selection(
    db: Session, source_org_id: int, apartment_limit: int
) -> dict[str, set[int]]:
    """fixes86: an apartments cap selects WHOLE buildings — the most recently
    created buildings are taken until their (displayed) apartments reach
    `apartment_limit`, rounding up so no building is split. Only those
    buildings, the areas they sit in, and the report numbers their
    apartments use are cloned; every other building / area / report number
    is dropped. Returns {tablename: allowed source ids}."""
    counts = (
        db.query(models.Apartment.building_id, func.count(models.Apartment.id))
        .filter(
            models.Apartment.organization_id == source_org_id,
            models.Apartment.is_display.is_(True),
            models.Apartment.building_id.isnot(None),
        )
        .group_by(models.Apartment.building_id)
        .all()
    )
    per_building = {bid: n for bid, n in counts}
    buildings = (
        db.query(models.Building.id, models.Building.area_id)
        .filter(
            models.Building.organization_id == source_org_id,
            models.Building.id.in_(per_building.keys() or {0}),
        )
        .order_by(models.Building.id.desc())
        .all()
    )
    building_ids: set[int] = set()
    area_ids: set[int] = set()
    total = 0
    for bid, area_id in buildings:
        if total >= apartment_limit:
            break
        building_ids.add(bid)
        total += per_building[bid]
        if area_id is not None:
            area_ids.add(area_id)
    # Every version (not only the displayed one) of the chosen buildings'
    # apartments — Apartment.root_id chains must stay intact.
    apartment_rows = (
        db.query(models.Apartment.id, models.Apartment.report_number_id)
        .filter(
            models.Apartment.organization_id == source_org_id,
            models.Apartment.building_id.in_(building_ids or {0}),
        )
        .all()
    )
    return {
        "buildings": building_ids,
        "areas": area_ids,
        "apartments": {a for a, _ in apartment_rows},
        "report_number": {rn for _, rn in apartment_rows if rn is not None},
    }


class _DemoIdentities:
    """fixes87 §7: a clone never carries real people's emails or phone
    numbers. Each distinct real value maps to ONE made-up value for the whole
    clone, so the same person stays consistent across tables (an activist's
    contact card and its shliach snapshot) and distinct people stay distinct
    (contacts.phone is unique per org)."""

    def __init__(self, org_id: int):
        self.org_id = org_id
        self.emails: dict[str, str] = {}
        self.phones: dict[str, str] = {}

    def email(self, value: str) -> str:
        key = value.strip().lower()
        if key not in self.emails:
            self.emails[key] = f"person{len(self.emails) + 1}@org{self.org_id}.demo"
        return self.emails[key]

    def phone(self, value: str) -> str:
        key = "".join(ch for ch in value if ch.isdigit()) or value
        if key not in self.phones:
            self.phones[key] = f"050-{len(self.phones) + 1:07d}"
        return self.phones[key]


def _activist_candidates(db: Session, org_id: int) -> list[dict]:
    """fixes87: every activist login in the org that has at least one task
    (any status), with that activist's task ids, report numbers and the
    displayed apartments those report numbers cover."""
    tasks = (
        db.query(models.Task.id, models.Task.volunteer_user_id)
        .join(models.User, models.User.id == models.Task.volunteer_user_id)
        .filter(
            models.Task.organization_id == org_id,
            models.User.organization_id == org_id,
            models.User.role == "shliach",
        )
        .all()
    )
    tasks_by_user: dict[int, set[int]] = {}
    for tid, uid in tasks:
        tasks_by_user.setdefault(uid, set()).add(tid)
    if not tasks_by_user:
        return []
    all_tasks = {t for ts in tasks_by_user.values() for t in ts}
    rns_by_task: dict[int, set[int]] = {}
    for tid, rn in db.query(
        models.TaskReportNumber.task_id, models.TaskReportNumber.report_number_id
    ).filter(models.TaskReportNumber.task_id.in_(all_tasks)):
        rns_by_task.setdefault(tid, set()).add(rn)
    all_rns = {rn for rns in rns_by_task.values() for rn in rns}
    apts_by_rn: dict[int, set[int]] = {}
    for aid, rn in db.query(models.Apartment.id, models.Apartment.report_number_id).filter(
        models.Apartment.organization_id == org_id,
        models.Apartment.is_display.is_(True),
        models.Apartment.report_number_id.in_(all_rns or {0}),
    ):
        apts_by_rn.setdefault(rn, set()).add(aid)
    names = {
        u.id: u.full_name
        for u in db.query(models.User.id, models.User.full_name).filter(
            models.User.id.in_(tasks_by_user.keys())
        )
    }
    out = []
    for uid, tids in tasks_by_user.items():
        rns = {rn for t in tids for rn in rns_by_task.get(t, ())}
        apts = {a for rn in rns for a in apts_by_rn.get(rn, ())}
        out.append({
            "user_id": uid,
            "full_name": names.get(uid, ""),
            "task_ids": tids,
            "report_number_ids": rns,
            "apartment_ids": apts,
        })
    return out


def _choose(cands: list[dict], n: int, target: int) -> list[dict]:
    """The n activists whose combined task apartments come closest to
    `target` (ties → more apartments). Exhaustive when the number of
    combinations is small, else greedy + pairwise swaps."""
    n = min(n, len(cands))
    if n <= 0:
        return []

    def score(combo) -> tuple[int, int]:
        size = len(set().union(*(c["apartment_ids"] for c in combo)))
        return (abs(size - target), -size)

    if math.comb(len(cands), n) <= 20000:
        best = list(min(combinations(cands, n), key=score))
    else:
        ranked = sorted(cands, key=lambda c: -len(c["apartment_ids"]))
        best, rest = ranked[:n], ranked[n:]
        improved = True
        while improved:
            improved = False
            for i in range(len(best)):
                for j in range(len(rest)):
                    trial = best[:i] + [rest[j]] + best[i + 1:]
                    if score(trial) < score(best):
                        best[i], rest[j] = rest[j], best[i]
                        improved = True
    return sorted(best, key=lambda c: -len(c["apartment_ids"]))


def plan_demo_clone(db: Session, org_id: int, activist_count: int, apartment_target: int) -> dict:
    """fixes87: the preview shown before a demo clone — which activists (with
    tasks) will be cloned and how many apartments their tasks hold. Nothing
    is written; the clone then receives exactly these user ids."""
    cands = _activist_candidates(db, org_id)
    chosen = _choose(cands, activist_count, apartment_target)
    apts = set().union(*(c["apartment_ids"] for c in chosen)) if chosen else set()
    buildings = (
        db.query(func.count(func.distinct(models.Apartment.building_id)))
        .filter(models.Apartment.id.in_(apts or {0}))
        .scalar()
        or 0
    )
    return {
        "available_activists": len(cands),
        "activists": [
            {
                "user_id": c["user_id"],
                "full_name": c["full_name"],
                "task_count": len(c["task_ids"]),
                "apartment_count": len(c["apartment_ids"]),
            }
            for c in chosen
        ],
        "apartment_count": len(apts),
        "building_count": buildings,
    }


def _demo_selection(db: Session, org_id: int, user_ids: list[int]) -> dict:
    """fixes87: what a demo clone copies for the chosen activists — their
    tasks + campaigns, exactly their task apartments (every version, so
    root_id chains hold), those apartments' buildings, the buildings' areas,
    the report numbers involved, and the activists' own contact cards."""
    from app.core.shliach import resolve_shliach  # local: avoids an import cycle

    by_user = {c["user_id"]: c for c in _activist_candidates(db, org_id)}
    missing = [u for u in user_ids if u not in by_user]
    if missing:
        raise ValueError(f"not activists with tasks in this organization: {missing}")
    chosen = [by_user[u] for u in user_ids]
    task_ids = {t for c in chosen for t in c["task_ids"]}
    display_apts = {a for c in chosen for a in c["apartment_ids"]}
    roots = {
        root or aid
        for aid, root in db.query(models.Apartment.id, models.Apartment.root_id).filter(
            models.Apartment.id.in_(display_apts or {0})
        )
    }
    apt_rows = (
        db.query(models.Apartment.id, models.Apartment.building_id, models.Apartment.report_number_id)
        .filter(
            models.Apartment.organization_id == org_id,
            or_(models.Apartment.id.in_(roots or {0}), models.Apartment.root_id.in_(roots or {0})),
        )
        .all()
    )
    building_ids = {b for _, b, _ in apt_rows if b is not None}
    area_ids = {
        a for (a,) in db.query(models.Building.area_id).filter(
            models.Building.id.in_(building_ids or {0}), models.Building.area_id.isnot(None)
        )
    }
    campaign_ids = {
        c for (c,) in db.query(models.Task.campaign_id).filter(models.Task.id.in_(task_ids or {0}))
    }
    shliach_contacts = set()
    users = []
    for uid in user_ids:
        user = db.get(models.User, uid)
        users.append(user)
        sh = resolve_shliach(db, user)
        if sh is not None:
            shliach_contacts.add(sh.contact_id)
    return {
        "selection": {
            "apartments": {a for a, _, _ in apt_rows},
            "buildings": building_ids,
            "areas": area_ids,
            "report_number": {c for c in (rn for _, _, rn in apt_rows) if c is not None}
            | {rn for c in chosen for rn in c["report_number_ids"]},
            "campaigns": campaign_ids,
            "tasks": task_ids,
        },
        "shliach_contact_ids": shliach_contacts,
        "users": users,
    }


def clone_organization(
    db: Session,
    source_org_id: int,
    new_org_name: str,
    admin_username: str,
    admin_full_name: str,
    admin_email: str,
    admin_password: str,
    table_limits: dict[str, int] | None = None,
    demo_activist_user_ids: Optional[list[int]] = None,
    demo_password: Optional[str] = None,
    summary: Optional[dict] = None,
) -> models.Organization:
    """Copy every CRM row belonging to `source_org_id` into a brand-new
    organization, with fresh ids/guids and every internal reference rewired.
    Runs inside the caller's transaction — the caller commits; on any error
    the caller should roll back (a partially-inserted clone must never be
    left committed).

    `table_limits` optionally caps how many rows are copied for one or more
    tables (keyed by `__tablename__`, e.g. {"apartments": 500}) — see the
    module docstring for what happens to rows elsewhere that referenced a
    row a cap left out.

    fixes87: `demo_activist_user_ids` (the ids a plan_demo_clone preview
    chose) switches to a demo clone — see _demo_selection. Each activist gets
    a made-up demo login (activistN@org<id>.demo, `demo_password`) so real
    people never see the demo org. `summary`, if given, is filled with the
    real counts and the demo logins."""
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

    table_limits = dict(table_limits or {})
    # fixes87: tasks/campaigns are cloned only in a demo clone.
    selection: dict[str, set[int]] = {"campaigns": set(), "tasks": set()}
    user_map: dict[int, int] = {}
    demo_logins: list[dict] = []
    identities = _DemoIdentities(new_org.id)
    shliach_contact_ids: Optional[set[int]] = None
    if demo_activist_user_ids:
        if not demo_password:
            raise ValueError("a demo clone needs a password for the activists' demo logins")
        demo = _demo_selection(db, source_org_id, demo_activist_user_ids)
        selection = demo["selection"]
        shliach_contact_ids = demo["shliach_contact_ids"]
        table_limits.pop("apartments", None)
        table_limits.pop("buildings", None)
        for i, src_user in enumerate(demo["users"], start=1):
            login = f"activist{i}@org{new_org.id}.demo"
            first, _, last = (src_user.full_name or "").partition(" ")
            demo_user = models.User(
                organization_id=new_org.id,
                username=login,
                email=login,
                full_name=src_user.full_name,
                first_name=first or None,
                last_name=last or None,
                password_hash=hash_password(demo_password),
                role="shliach",
                is_active=True,
                email_verified=True,
            )
            db.add(demo_user)
            db.flush()
            user_map[src_user.id] = demo_user.id
            demo_logins.append({"username": login, "full_name": src_user.full_name})
            # The activist's own card/snapshot email becomes their demo login.
            if src_user.email:
                identities.emails[src_user.email.strip().lower()] = login
    # fixes86: an apartments cap means "whole buildings" — it replaces the
    # plain row caps on apartments/buildings with an explicit id selection.
    elif table_limits.get("apartments") is not None:
        selection.update(_whole_building_selection(
            db, source_org_id, max(0, table_limits.pop("apartments"))
        ))
        table_limits.pop("buildings", None)
        logger.info(
            "org_clone: whole-building selection — %d buildings, %d apartment rows, "
            "%d areas, %d report numbers",
            len(selection["buildings"]), len(selection["apartments"]),
            len(selection["areas"]), len(selection["report_number"]),
        )

    for model, fk_remap, is_polymorphic in _CLONE_PLAN:
        tablename = model.__tablename__
        nullable_by_column = {col.name: col.nullable for col in model.__table__.columns}
        query = db.query(model).filter(model.organization_id == source_org_id)
        if tablename in selection:
            query = query.filter(model.id.in_(selection[tablename] or {0}))
        limit = table_limits.get(tablename)
        if tablename == "contacts" and shliach_contact_ids is not None:
            # fixes87: only the chosen activists' own cards; the contacts cap
            # applies to everyone else and never cuts a chosen activist.
            others = query.filter(models.Contact.contact_type != "shliach")
            others = (
                others.order_by(model.id.desc()).limit(max(0, limit)).all()
                if limit is not None
                else others.all()
            )
            activists = query.filter(model.id.in_(shliach_contact_ids or {0})).all()
            rows = sorted(others + activists, key=lambda r: r.id)
        elif limit is not None:
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
            for column in (_USER_FK_COLUMNS | _NULLED_COLUMNS) - fk_remap.keys():
                if column not in data:
                    continue
                if column in _DEMO_MAPPED_USER_COLUMNS and data[column] in user_map:
                    data[column] = user_map[data[column]]  # fixes87: → demo login
                else:
                    data[column] = None
            # fixes87 §7: made-up contact details, never the real ones.
            if data.get("email"):
                data["email"] = identities.email(data["email"])
            if data.get("phone"):
                data["phone"] = identities.phone(data["phone"])
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

    # fixes87: per-campaign field visibility has no organization_id column,
    # so it isn't in the plan — copy it for the cloned campaigns.
    for old_cid, new_cid in id_maps.get("campaigns", {}).items():
        for fv in db.query(models.CampaignFieldVisibility).filter(
            models.CampaignFieldVisibility.campaign_id == old_cid
        ):
            db.add(
                models.CampaignFieldVisibility(
                    campaign_id=new_cid, field_key=fv.field_key, is_visible=fv.is_visible
                )
            )
    db.flush()

    if summary is not None:
        summary.update(
            activists=len(demo_logins),
            apartments=db.query(models.Apartment)
            .filter(
                models.Apartment.organization_id == new_org.id,
                models.Apartment.is_display.is_(True),
            )
            .count(),
            tasks=len(id_maps.get("tasks", {})),
            demo_logins=demo_logins,
        )
    return new_org
