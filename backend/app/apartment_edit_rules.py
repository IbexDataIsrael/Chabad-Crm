"""fixes115/fixes118: which apartment fields the chat helper may edit, decided
on the server.

One rule for the assistant endpoints (routers/assistant_apartments.py),
built from the settings the dashboard already has, never from a hardcoded
field list:

- Apartment fields only (fixes118): the fixed lists (Jewish status,
  campaign status, mezuzah status, languages), the org's own apartment
  picklists (e.g. a seasonal Chanuka list) and its yes/no apartment fields
  (e.g. "lit a menorah"), taken from the apartment field catalog the campaign
  field visibility screen uses (apartment_fields.list_apartment_field_keys;
  to_knock is never in it). Everything else — apartment number, floor,
  report number, resident, phone, email, notes and the org's text / number /
  date custom fields — is never editable here, for any role.
- Every role edits like an activist (owner decision, fixes118): hidden by
  the org's field settings, hidden by the active campaign, locked in
  shliach-config's apartment_edit_locked_fields — and nothing at all when
  shliach-config's disable_edit is on.
- One label per field and option, in the user's language (core/user_locale).
"""
from dataclasses import dataclass, field as dc_field
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import apartment_fields, custom_field_utils, models, picklist_utils
from app.core.campaigns import get_active_campaign_id
from app.core.user_locale import pick, user_locale
from app.field_registry import TOGGLEABLE_KEYS, default_visible

LANGUAGE_KEY = "apartment.language"
JEWISH_STATUS_KEY = "apartment.Jewish_status"
CUSTOM_PREFIX = "customfield.apartment."

_FIXED_PICKLISTS = {
    JEWISH_STATUS_KEY,
    "apartment.campaign_status",
    "apartment.mezuzah_status",
}
# shliach-config's lock list names the fixed fields its own way
# (APARTMENT_FIELD_KEYS on that page); org picklists are locked by the same
# key the catalog uses.
_LOCK_KEYS = {
    "language": LANGUAGE_KEY,
    "jewish_status": JEWISH_STATUS_KEY,
    "campaign_status": "apartment.campaign_status",
    "mezuzah_status": "apartment.mezuzah_status",
}


@dataclass
class FieldSpec:
    field_key: str
    label: str
    kind: str  # single_option | multi_option | yes_no
    options: list[dict] = dc_field(default_factory=list)


def _hidden_by_org(db: Session, org_id: int) -> set[str]:
    rows = db.query(models.FieldSetting).filter(models.FieldSetting.organization_id == org_id)
    saved = {r.field_key: r.is_visible for r in rows}
    hidden = {k for k, visible in saved.items() if not visible}
    hidden |= {k for k in TOGGLEABLE_KEYS if k not in saved and not default_visible(k)}
    return hidden


def _hidden_by_campaign(db: Session, org_id: int) -> set[str]:
    campaign_id = get_active_campaign_id(db, org_id)
    if campaign_id is None:
        return set()
    return {
        r.field_key
        for r in db.query(models.CampaignFieldVisibility).filter(
            models.CampaignFieldVisibility.campaign_id == campaign_id,
            models.CampaignFieldVisibility.is_visible.is_(False),
        )
    }


def _activist_locks(db: Session, org_id: int) -> Optional[set[str]]:
    """The activist locks as catalog keys; None = editing disabled entirely."""
    org = db.get(models.Organization, org_id)
    cfg = org.shliach_view_config if org and isinstance(org.shliach_view_config, dict) else {}
    if cfg.get("disable_edit"):
        return None
    return {_LOCK_KEYS.get(k, k) for k in cfg.get("apartment_edit_locked_fields") or []}


def _labels(db: Session, keys: list[str]) -> dict[str, tuple[str, Optional[str]]]:
    if not keys:
        return {}
    rows = db.query(models.FieldLocalization).filter(
        models.FieldLocalization.technical_name.in_(keys)
    )
    return {r.technical_name: (r.hebrew_label, r.english_label) for r in rows}


def _kind(meta, yes_no_keys: set[str]) -> Optional[str]:
    if meta.field_key == LANGUAGE_KEY:
        return "multi_option"
    if meta.field_key in _FIXED_PICKLISTS or meta.label_key.startswith("picklist_def."):
        return "single_option"
    if meta.field_key in yes_no_keys:
        return "yes_no"
    return None  # never editable through the helper


def editable_specs(db: Session, user: models.User, locale: str) -> list[FieldSpec]:
    """The fields this user may edit on any visible apartment, in catalog
    order, without per-apartment values or options (see apartment_views)."""
    org_id = user.organization_id
    locked = _activist_locks(db, org_id)
    if locked is None:
        return []
    hidden = _hidden_by_org(db, org_id) | _hidden_by_campaign(db, org_id) | locked
    yes_no_keys = {
        CUSTOM_PREFIX + d.field_key
        for d in db.query(models.CustomFieldDefinition).filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.is_active.is_(True),
            models.CustomFieldDefinition.field_type == "boolean",
        )
    }
    catalog = apartment_fields.list_apartment_field_keys(db, org_id)
    labels = _labels(db, [m.label_key for m in catalog if m.label is None])
    specs = []
    for meta in catalog:
        kind = _kind(meta, yes_no_keys)
        if kind is None or meta.field_key in hidden:
            continue
        he, en = (meta.label, meta.english_label) if meta.label else labels.get(meta.label_key, (None, None))
        specs.append(FieldSpec(meta.field_key, pick(locale, he, en) or meta.field_key, kind))
    return specs


def _picklist_options(
    db: Session, org_id: int, keys: list[str], locale: str
) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {k: [] for k in keys}
    if not keys:
        return out
    rows = (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key.in_(keys),
            models.PicklistValue.is_active.is_(True),
        )
        .order_by(models.PicklistValue.sort_order, models.PicklistValue.id)
    )
    for o in rows:
        out[o.field_key].append(
            {"value": o.value, "label": pick(locale, o.hebrew_label, o.english_value) or o.value}
        )
    return out


def apartment_views(
    db: Session, user: models.User, rows: list[models.Apartment]
) -> list[dict]:
    """Each apartment as the assistant shows it, with `editable_fields`: the
    fields this user may edit on it right now, each with its current value
    and the org's current options. An option field with nothing to pick from
    is left out."""
    org_id = user.organization_id
    locale = user_locale(db, user)
    specs = editable_specs(db, user, locale)
    ids = [a.id for a in rows]
    picklist_values = picklist_utils.get_values_bulk(db, org_id, "apartments", ids)
    languages = picklist_utils.get_multi_values_bulk(db, org_id, "apartments", ids, LANGUAGE_KEY)
    custom_values = custom_field_utils.get_values_bulk(db, org_id, "apartment", ids)
    options = _picklist_options(
        db, org_id, [s.field_key for s in specs if s.kind != "yes_no"], locale
    )

    out = []
    for a in rows:
        fields = []
        for s in specs:
            if s.kind == "yes_no":
                current = custom_values.get(a.id, {}).get(s.field_key[len(CUSTOM_PREFIX):])
                fields.append({
                    "field_key": s.field_key, "label": s.label, "kind": s.kind,
                    "current_value": current,
                })
                continue
            if not options[s.field_key]:
                continue
            if s.kind == "multi_option":
                current = languages.get(a.id, [])
            else:
                current = picklist_values.get(a.id, {}).get(s.field_key)
            fields.append({
                "field_key": s.field_key, "label": s.label, "kind": s.kind,
                "current_value": current, "options": options[s.field_key],
            })
        lineage_id = a.root_id or a.id
        out.append({
            "apartment_id": a.id,
            "lineage_id": lineage_id,
            # fixes118 decision 8: always opens the current version.
            "web_path": f"/dashboard/apartments/lineage/{lineage_id}",
            "building_address": a.building.building_address if a.building else None,
            "apartment_name": a.apartment_name,
            "floor": a.floor,
            "resident_name": a.name,
            "editable_fields": fields,
        })
    return out


def invalid(field_key: str, code: str, value: Any = None) -> HTTPException:
    item: dict[str, Any] = {"field": field_key, "code": code}
    if value is not None:
        item["value"] = value
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"status": "invalid", "invalid_fields": [item]},
    )


def parse_value(entry: dict, value: Any) -> Any:
    """Check `value` against one editable_fields entry; returns the value to
    store or raises a 422 naming the field. A single option and a yes/no are
    never cleared; an empty list clears a multi option."""
    key, kind = entry["field_key"], entry["kind"]
    if kind == "yes_no":
        if not isinstance(value, bool):
            raise invalid(key, "expected_yes_no")
        return value
    if kind == "single_option":
        if isinstance(value, (bool, list, dict)) or value is None:
            raise invalid(key, "expected_option")
        for o in entry["options"]:
            if str(o["value"]) == str(value).strip():
                return o["value"]
        raise invalid(key, "value_not_allowed", value)
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise invalid(key, "expected_list")
    allowed = {o["value"] for o in entry["options"]}
    picked = list(dict.fromkeys(v.strip() for v in value if v.strip()))
    for v in picked:
        if v not in allowed:
            raise invalid(key, "value_not_allowed", v)
    return picked


def same_value(kind: str, current: Any, new: Any) -> bool:
    if kind == "multi_option":
        return sorted(current or []) == sorted(new or [])
    return current == new
