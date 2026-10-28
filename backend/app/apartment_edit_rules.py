"""fixes115: which apartment fields a user may edit, decided on the server.

One rule for the assistant endpoints (routers/assistant_apartments.py),
built from the settings the dashboard already has, never from a hardcoded
field list:

- The candidates are the apartment field catalog the campaign field
  visibility screen uses (apartment_fields.list_apartment_field_keys: fixed
  registry fields + the org's custom picklists + its custom fields, to_knock
  never). A catalog key with no write mapping below is never editable.
- Hidden by the org's field settings (field_settings, the Fields page) =
  hidden for everyone. Owner decision: org settings are for the whole org.
- A shliach additionally loses the fields the active campaign hides
  (campaign_field_visibility), every field when shliach-config's
  disable_edit is on, and each field in apartment_edit_locked_fields.
- A shliach never edits the apartment number (the dashboard PUT 403s it),
  the floor or the report number (street2 never offers either).
- Every other role follows the admin rules (org settings only).
"""
import datetime
from dataclasses import dataclass, field as dc_field
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app import apartment_fields, custom_field_utils, models, picklist_utils
from app.core.campaigns import get_active_campaign_id
from app.field_registry import TOGGLEABLE_KEYS, default_visible
from app.schemas import _validate_email, _validate_phone

LANGUAGE_KEY = "apartment.language"
JEWISH_STATUS_KEY = "apartment.Jewish_status"
CUSTOM_PREFIX = "customfield.apartment."

# Fixed registry keys -> the real column they write. floor and
# report_number_id are option fields (the building's floors / the org's
# report numbers); the rest are text.
COLUMNS = {
    "apartments.apartment_name": "apartment_name",
    "apartments.floor": "floor",
    "apartments.apartment_notes": "apartment_notes",
    "apartments.name": "name",
    "apartments.phone": "phone",
    "apartments.email": "email",
    "apartments.report_number_id": "report_number_id",
}
_FIXED_PICKLISTS = {
    JEWISH_STATUS_KEY,
    "apartment.campaign_status",
    "apartment.mezuzah_status",
    LANGUAGE_KEY,
}
_SHLIACH_NEVER = {
    "apartments.apartment_name",
    "apartments.floor",
    "apartments.report_number_id",
}
# shliach-config's lock list names the fixed fields its own way
# (APARTMENT_FIELD_KEYS on that page); custom picklists and custom fields
# are locked by the same key the catalog uses.
_LOCK_KEYS = {
    "resident": "apartments.name",
    "phone": "apartments.phone",
    "email": "apartments.email",
    "notes": "apartments.apartment_notes",
    "report_number": "apartments.report_number_id",
    "language": LANGUAGE_KEY,
    "jewish_status": JEWISH_STATUS_KEY,
    "campaign_status": "apartment.campaign_status",
    "mezuzah_status": "apartment.mezuzah_status",
}
_CUSTOM_KINDS = {"text": "text", "number": "number", "date": "date", "boolean": "yes_no"}


@dataclass
class FieldSpec:
    field_key: str
    label: str
    label_en: str
    kind: str  # single_option | multi_option | text | number | date | yes_no
    target: str  # column | picklist | language | custom
    name: str  # column name, picklist field_key or custom field_key
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


def _shliach_locks(db: Session, org_id: int) -> Optional[set[str]]:
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


def _spec(meta, custom_types: dict[str, str]) -> Optional[FieldSpec]:
    key = meta.field_key
    if key in COLUMNS:
        option_column = key in ("apartments.floor", "apartments.report_number_id")
        return FieldSpec(key, "", "", "single_option" if option_column else "text",
                         "column", COLUMNS[key])
    if key == LANGUAGE_KEY:
        return FieldSpec(key, "", "", "multi_option", "language", key)
    if key.startswith(CUSTOM_PREFIX):
        name = key[len(CUSTOM_PREFIX):]
        kind = _CUSTOM_KINDS.get(custom_types.get(name, ""))
        return FieldSpec(key, "", "", kind, "custom", name) if kind else None
    if key in _FIXED_PICKLISTS or meta.label_key.startswith("picklist_def."):
        return FieldSpec(key, "", "", "single_option", "picklist", key)
    return None  # a catalog entry with no write mapping is never editable


def editable_specs(db: Session, user: models.User) -> list[FieldSpec]:
    """The fields this user may edit on any visible apartment, in catalog
    order, without per-apartment values or options (see apartment_views)."""
    org_id = user.organization_id
    hidden = _hidden_by_org(db, org_id)
    locked: set[str] = set()
    if user.role == "shliach":
        shliach_locks = _shliach_locks(db, org_id)
        if shliach_locks is None:
            return []
        hidden |= _hidden_by_campaign(db, org_id) | _SHLIACH_NEVER
        locked = shliach_locks
    custom_types = {
        d.field_key: d.field_type
        for d in db.query(models.CustomFieldDefinition).filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.is_active.is_(True),
        )
    }
    catalog = apartment_fields.list_apartment_field_keys(db, org_id)
    labels = _labels(db, [m.label_key for m in catalog if m.label is None])
    specs = []
    for meta in catalog:
        if meta.field_key in hidden or meta.field_key in locked:
            continue
        spec = _spec(meta, custom_types)
        if spec is None:
            continue
        he, en = (meta.label, meta.english_label) if meta.label else labels.get(meta.label_key, (None, None))
        spec.label = he or meta.field_key
        spec.label_en = en or spec.label
        specs.append(spec)
    return specs


def _picklist_options(db: Session, org_id: int, keys: list[str]) -> dict[str, list[dict]]:
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
            {"value": o.value, "label": o.hebrew_label, "label_en": o.english_value or o.value}
        )
    return out


def apartment_views(
    db: Session, user: models.User, rows: list[models.Apartment]
) -> list[dict]:
    """Each apartment as the assistant shows it, with `editable_fields`: the
    fields this user may edit on it right now, each with its current value
    and (option fields) the org's current options. An option field with
    nothing to pick from is left out."""
    org_id = user.organization_id
    specs = editable_specs(db, user)
    ids = [a.id for a in rows]
    picklist_values = picklist_utils.get_values_bulk(db, org_id, "apartments", ids)
    languages = picklist_utils.get_multi_values_bulk(db, org_id, "apartments", ids, LANGUAGE_KEY)
    custom_values = custom_field_utils.get_values_bulk(db, org_id, "apartment", ids)
    options = _picklist_options(
        db, org_id, [s.name for s in specs if s.target in ("picklist", "language")]
    )
    if any(s.name == "report_number_id" for s in specs):
        options["report_number_id"] = [
            {"value": r.id, "label": r.name, "label_en": r.name}
            for r in db.query(models.ReportNumber)
            .filter(models.ReportNumber.organization_id == org_id)
            .order_by(models.ReportNumber.name, models.ReportNumber.id)
        ]
    floors: dict[int, list[dict]] = {}
    if any(s.name == "floor" for s in specs):
        for f in (
            db.query(models.Floor)
            .filter(
                models.Floor.organization_id == org_id,
                models.Floor.building_id.in_({a.building_id for a in rows}),
            )
            .order_by(models.Floor.sort_order, models.Floor.id)
        ):
            floors.setdefault(f.building_id, []).append(
                {"value": f.name, "label": f.name, "label_en": f.name}
            )

    out = []
    for a in rows:
        fields = []
        for s in specs:
            if s.target == "column":
                current = getattr(a, s.name)
            elif s.target == "picklist":
                current = picklist_values.get(a.id, {}).get(s.name)
            elif s.target == "language":
                current = languages.get(a.id, [])
            else:
                current = custom_values.get(a.id, {}).get(s.name)
            entry: dict[str, Any] = {
                "field_key": s.field_key, "label": s.label, "label_en": s.label_en,
                "kind": s.kind, "current_value": current,
            }
            if s.kind in ("single_option", "multi_option"):
                opts = floors.get(a.building_id, []) if s.name == "floor" else options.get(s.name, [])
                if not opts:
                    continue
                entry["options"] = opts
            fields.append(entry)
        out.append({
            "apartment_id": a.id,
            "lineage_id": a.root_id or a.id,
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
    store or raises a 422 naming the field. Same checks as the dashboard:
    picklist options, the phone/email validators, custom field types."""
    key, kind = entry["field_key"], entry["kind"]
    if kind == "single_option":
        if isinstance(value, (bool, list, dict)) or value is None:
            raise invalid(key, "expected_option")
        for o in entry["options"]:
            if str(o["value"]) == str(value).strip():
                return o["value"]
        raise invalid(key, "value_not_allowed", value)
    if kind == "multi_option":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise invalid(key, "expected_list")
        allowed = {o["value"] for o in entry["options"]}
        picked = list(dict.fromkeys(v.strip() for v in value if v.strip()))
        for v in picked:
            if v not in allowed:
                raise invalid(key, "value_not_allowed", v)
        return picked
    if value is None:
        return None  # clears a text / number / date / yes-no field
    if kind == "yes_no":
        if not isinstance(value, bool):
            raise invalid(key, "expected_yes_no")
        return value
    if kind == "number":
        if isinstance(value, bool):
            raise invalid(key, "expected_number")
        try:
            return float(value)
        except (TypeError, ValueError):
            raise invalid(key, "expected_number")
    if not isinstance(value, str):
        raise invalid(key, "expected_text")
    text = value.strip()
    if kind == "date":
        try:
            datetime.date.fromisoformat(text[:10])
        except ValueError:
            raise invalid(key, "expected_date")
        return text
    if not text:
        return None
    try:
        if key == "apartments.phone":
            return _validate_phone(text)
        if key == "apartments.email":
            return _validate_email(text)
    except ValueError:
        raise invalid(key, "invalid_format")
    return text


def same_value(kind: str, current: Any, new: Any) -> bool:
    if kind == "multi_option":
        return sorted(current or []) == sorted(new or [])
    if kind == "text":
        return (current or None) == new
    return current == new
