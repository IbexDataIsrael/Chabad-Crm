"""fixes72 §B: per-campaign change history, computed at read time from the
already-permanent Apartment version chain — no separate audit-log table.

A version row S with campaign_id == X is "an edit that happened during
campaign X" (campaign_id is stamped fresh on every NEW row at creation time
— see routers/apartments.py's _sync_to_knock-adjacent stamping). The
WHEN/WHO of that specific edit live on S's PREDECESSOR P (P.last_edit /
P.editor_id are stamped when P was retired to make room for S) — NOT on S
itself, whose own last_edit/editor_id stay NULL until something later
retires S in turn. Getting this backwards silently produces blank
timestamps/editors for every entry (verified live against a known edit
before writing the endpoint that uses this).
"""
import datetime
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import apartment_fields, custom_field_utils, models, picklist_utils
from app.core.display import building_display_name

# Real (non-picklist) columns compared verbatim, mirroring apartments.py's
# own _VERSIONED_COLUMNS plus building_id (versioned but excluded from that
# tuple only because per-field restore forbids restoring it — a genuine
# building_id change from a real edit is still diff-worthy here).
_REAL_COLUMNS = (
    "building_id", "apartment_name", "apartment_notes", "floor",
    "name", "phone", "email", "report_number_id", "source", "status",
)
_REAL_COLUMN_FIELD_KEY = {c: f"apartments.{c}" for c in _REAL_COLUMNS}
# Fallback label_key for the few real columns the admin field-visibility
# catalog (apartment_fields.py) doesn't cover, since that catalog is scoped
# to admin-toggleable fields only, not every diff-worthy column.
_UNCATALOGED_LABEL_KEYS = {
    "apartments.status": "apartments.status",
    "apartments.source": "apartments.source",
    "apartments.building_id": "apartments.building_id",
}
_FIXED_PICKLIST_LABEL_KEYS = {
    "apartment.Jewish_status": "picklist.apartment.Jewish_status",
    "apartment.campaign_status": "picklist.apartment.campaign_status",
    "apartment.mezuzah_status": "picklist.apartment.mezuzah_status",
}
_LANGUAGE_FIELD_KEY = "apartment.language"


def _predecessor(db: Session, org_id: int, v: models.Apartment) -> Optional[models.Apartment]:
    """The row v replaced, if any — v IS the lineage root (a creation event,
    no predecessor) when v.root_id is None."""
    if v.root_id is None:
        return None
    return (
        db.query(models.Apartment)
        .filter(
            models.Apartment.organization_id == org_id,
            models.Apartment.id < v.id,
            or_(models.Apartment.root_id == v.root_id, models.Apartment.id == v.root_id),
        )
        .order_by(models.Apartment.id.desc())
        .first()
    )


def compute_campaign_history(
    db: Session, org_id: int, campaign_id: int, page: int, page_size: int,
) -> tuple[list[dict], int]:
    base_query = db.query(models.Apartment).filter(
        models.Apartment.organization_id == org_id,
        models.Apartment.campaign_id == campaign_id,
    )
    total = base_query.count()
    page_rows = (
        base_query.order_by(models.Apartment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    if not page_rows:
        return [], total

    predecessors = {v.id: _predecessor(db, org_id, v) for v in page_rows}
    all_ids = [v.id for v in page_rows] + [p.id for p in predecessors.values() if p]

    picklist_map = picklist_utils.get_values_bulk(db, org_id, "apartments", all_ids)
    language_map = picklist_utils.get_multi_values_bulk(
        db, org_id, "apartments", all_ids, _LANGUAGE_FIELD_KEY
    )
    custom_map = custom_field_utils.get_values_bulk(db, org_id, "apartment", all_ids)

    # The admin visibility catalog is scoped to configurable fields only (it
    # deliberately excludes to_knock) — use it for labels where available,
    # but fall back to CustomFieldDefinition directly so an excluded field
    # (to_knock) still gets a real label in history instead of its raw key.
    catalog = {f.field_key: f for f in apartment_fields.list_apartment_field_keys(db, org_id)}
    custom_defs = {
        d.field_key: d
        for d in db.query(models.CustomFieldDefinition).filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.field_type != "select",
        )
    }

    building_labels: dict[int, str] = {}
    report_number_labels: dict[int, str] = {}

    def _building_label(building_id: Optional[int]) -> Optional[str]:
        if building_id is None:
            return None
        if building_id not in building_labels:
            b = db.query(models.Building).filter(models.Building.id == building_id).first()
            building_labels[building_id] = building_display_name(b) if b else f"#{building_id}"
        return building_labels[building_id]

    def _report_number_label(rn_id: Optional[int]) -> Optional[str]:
        if rn_id is None:
            return None
        if rn_id not in report_number_labels:
            rn = db.query(models.ReportNumber).filter(models.ReportNumber.id == rn_id).first()
            report_number_labels[rn_id] = rn.name if rn else f"#{rn_id}"
        return report_number_labels[rn_id]

    entries = []
    for v in page_rows:
        p = predecessors[v.id]
        changes: list[dict] = []

        for col in _REAL_COLUMNS:
            old_raw = getattr(p, col) if p else None
            new_raw = getattr(v, col)
            if old_raw == new_raw:
                continue
            field_key = _REAL_COLUMN_FIELD_KEY[col]
            meta = catalog.get(field_key)
            if col == "building_id":
                old_val, new_val = _building_label(old_raw), _building_label(new_raw)
            elif col == "report_number_id":
                old_val, new_val = _report_number_label(old_raw), _report_number_label(new_raw)
            else:
                old_val, new_val = old_raw, new_raw
            changes.append({
                "field_key": field_key,
                "label_key": meta.label_key if meta else _UNCATALOGED_LABEL_KEYS.get(field_key, field_key),
                "label": meta.label if meta else None,
                "english_label": meta.english_label if meta else None,
                "field_type": None,
                "old_value": old_val,
                "new_value": new_val,
            })

        old_picks = picklist_map.get(p.id, {}) if p else {}
        new_picks = picklist_map.get(v.id, {})
        for field_key in set(old_picks) | set(new_picks):
            old_val, new_val = old_picks.get(field_key), new_picks.get(field_key)
            if old_val == new_val:
                continue
            meta = catalog.get(field_key)
            changes.append({
                "field_key": field_key,
                "label_key": meta.label_key if meta else _FIXED_PICKLIST_LABEL_KEYS.get(field_key, field_key),
                "label": meta.label if meta else None,
                "english_label": meta.english_label if meta else None,
                "field_type": None,
                "old_value": old_val,
                "new_value": new_val,
            })

        old_lang = sorted(language_map.get(p.id, [])) if p else []
        new_lang = sorted(language_map.get(v.id, []))
        if old_lang != new_lang:
            changes.append({
                "field_key": _LANGUAGE_FIELD_KEY,
                "label_key": "picklist.apartment.language",
                "label": None, "english_label": None, "field_type": None,
                "old_value": ", ".join(old_lang) or None,
                "new_value": ", ".join(new_lang) or None,
            })

        old_custom = custom_map.get(p.id, {}) if p else {}
        new_custom = custom_map.get(v.id, {})
        for field_key in set(old_custom) | set(new_custom):
            old_val, new_val = old_custom.get(field_key), new_custom.get(field_key)
            if old_val == new_val:
                continue
            key = f"customfield.apartment.{field_key}"
            meta = catalog.get(key)
            definition = custom_defs.get(field_key)
            changes.append({
                "field_key": key,
                "label_key": meta.label_key if meta else key,
                "label": meta.label if meta else (definition.hebrew_label if definition else None),
                "english_label": meta.english_label if meta else (definition.english_label if definition else None),
                "field_type": definition.field_type if definition else None,
                "old_value": old_val,
                "new_value": new_val,
            })

        if not changes:
            continue  # a save that produced no real change (e.g. re-submitting the same value)

        entries.append({
            "apartment_id": v.id,
            "building_id": v.building_id,
            "building_label": _building_label(v.building_id),
            "event": "created" if p is None else "edited",
            "editor_name": (p.editor.full_name if p and p.editor else None),
            "changed_at": (p.last_edit if p else v.created_at) or datetime.datetime.utcnow(),
            "changes": changes,
        })
    return entries, total
