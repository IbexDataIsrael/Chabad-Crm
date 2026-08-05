"""The AI query feature's explicit table/column allowlist (`/api/ai/query`).

This is the only place a natural-language request ever meets the database.
The LLM never sees or emits SQL — it returns `{"table", "filters"}`, which
`run_query` validates against the allowlist below and turns into a scoped
SQLAlchemy query. Every table's `base_query` reuses the same org + role/
shliach-visibility scoping as the real REST endpoint it mirrors (imported,
never re-derived), applied unconditionally regardless of what the model
returned — the LLM output can only narrow a query with extra `.filter()`
calls on an explicit column allowlist, never widen or bypass tenant scoping.
"""
from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any, Callable, Optional

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app import models, picklist_utils
from app.routers.apartments import _shliach_apartment_ids
from app.routers.contacts import _contacts_query

ROW_CAP = 200
MAX_FILTERS = 8

_ALL_ROLES = frozenset({"admin", "staff", "shliach"})
_ADMIN_ONLY = frozenset({"admin"})

OPS_BY_KIND: dict[str, frozenset[str]] = {
    "text": frozenset({"eq", "contains"}),
    "number": frozenset({"eq", "gt", "gte", "lt", "lte"}),
    "date": frozenset({"eq", "gt", "gte", "lt", "lte"}),
    "bool": frozenset({"eq"}),
}


class ManifestError(Exception):
    """Any failure validating/running an LLM-produced query intent — carries
    the HTTP status the router should respond with."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


@dataclass(frozen=True)
class ColumnSpec:
    key: str
    label_he: str
    label_en: str
    kind: str  # "text" | "number" | "date" | "bool"
    expr: Any = None  # SQLAlchemy column/label expression; None => special-cased
    allowed_ops: Optional[frozenset[str]] = None  # overrides OPS_BY_KIND[kind]


@dataclass(frozen=True)
class TableSpec:
    key: str
    title_he: str
    title_en: str
    allowed_roles: frozenset[str]
    columns: dict[str, ColumnSpec]
    display_columns: list[str]
    base_query: Callable[[Session, models.User], Any]
    order_by: Callable[[Any], Any]
    serialize: Callable[[Session, models.User, list], list[dict]]


@dataclass
class QueryResult:
    table_title: str
    columns: list[dict]
    rows: list[dict]
    row_count: int
    truncated: bool


# --- contacts ---------------------------------------------------------------

def _contacts_base_query(db: Session, user: models.User):
    return (
        _contacts_query(db, user, None, None, None)
        .outerjoin(
            models.ContactMekurav,
            models.ContactMekurav.contact_id == models.Contact.id,
        )
        .outerjoin(
            models.AdminArea,
            models.AdminArea.id == models.ContactMekurav.admin_area_id,
        )
        .add_columns(
            models.ContactMekurav.tzedaka_potential,
            models.AdminArea.name.label("admin_area_name"),
        )
    )


def _serialize_contacts(db: Session, user: models.User, rows: list) -> list[dict]:
    picklist_map = picklist_utils.get_values_bulk(
        db,
        user.organization_id,
        "contacts",
        [contact.id for contact, _, _ in rows],
        ["contact.pipeline_status"],
    )
    return [
        {
            "name": contact.name,
            "last_name": contact.last_name,
            "phone": contact.phone,
            "contact_type": contact.contact_type,
            "address": contact.address,
            "pipeline_status": picklist_map.get(contact.id, {}).get(
                "contact.pipeline_status"
            ),
            "admin_area_name": admin_area_name,
        }
        for contact, _tzedaka, admin_area_name in rows
    ]


# --- visits -------------------------------------------------------------

def _visits_base_query(db: Session, user: models.User):
    query = (
        db.query(models.VisitHistory)
        .filter(models.VisitHistory.organization_id == user.organization_id)
        .outerjoin(models.Contact, models.Contact.id == models.VisitHistory.contact_id)
        .add_columns(models.Contact.name.label("contact_name"))
    )
    if user.role == "shliach":
        visible_contact_ids = _contacts_query(
            db, user, None, None, None
        ).with_entities(models.Contact.id)
        query = query.filter(models.VisitHistory.contact_id.in_(visible_contact_ids))
    return query


def _serialize_visits(db: Session, user: models.User, rows: list) -> list[dict]:
    return [
        {
            "visit_date": visit.visit_date.isoformat() if visit.visit_date else None,
            "contact_name": contact_name,
            "location": visit.location,
            "notes": visit.notes,
        }
        for visit, contact_name in rows
    ]


# --- donations (admin only) --------------------------------------------

def _donations_base_query(db: Session, user: models.User):
    return (
        db.query(models.Donation)
        .filter(models.Donation.organization_id == user.organization_id)
        .outerjoin(models.Contact, models.Contact.id == models.Donation.contact_id)
        .add_columns(models.Contact.name.label("contact_name"))
    )


def _serialize_donations(db: Session, user: models.User, rows: list) -> list[dict]:
    return [
        {
            "donation_date": donation.donation_date.isoformat()
            if donation.donation_date
            else None,
            "contact_name": contact_name,
            "amount": donation.amount,
            "is_ongoing": donation.is_ongoing,
        }
        for donation, contact_name in rows
    ]


# --- buildings -----------------------------------------------------------

def _buildings_base_query(db: Session, user: models.User):
    return (
        db.query(models.Building)
        .filter(models.Building.organization_id == user.organization_id)
        .outerjoin(models.Area, models.Area.id == models.Building.area_id)
        .add_columns(models.Area.area_name.label("area_name"))
    )


def _serialize_buildings(db: Session, user: models.User, rows: list) -> list[dict]:
    return [
        {
            "building_name": building.building_name,
            "building_address": building.building_address,
            "area_name": area_name,
            "is_town_house": building.is_town_house,
        }
        for building, area_name in rows
    ]


# --- apartments ------------------------------------------------------------

def _apartments_base_query(db: Session, user: models.User):
    query = (
        db.query(models.Apartment)
        .filter(
            models.Apartment.organization_id == user.organization_id,
            models.Apartment.is_display.is_(True),
        )
        .outerjoin(models.Building, models.Building.id == models.Apartment.building_id)
        .add_columns(models.Building.building_address.label("building_address"))
    )
    if user.role == "shliach":
        query = query.filter(
            models.Apartment.id.in_(_shliach_apartment_ids(db, user))
        )
    return query


def _serialize_apartments(db: Session, user: models.User, rows: list) -> list[dict]:
    return [
        {
            "name": apartment.name,
            "apartment_name": apartment.apartment_name,
            "floor": apartment.floor,
            "phone": apartment.phone,
            "building_address": building_address,
        }
        for apartment, building_address in rows
    ]


# --- mivtzoim (the mitzvah checklist — tefillin, candles, etc.) -----------
# Admin-configurable per org (CustomFieldDefinition, entity_type="visit",
# field_type="boolean") — every org gets the same 5 defaults seeded
# (seed.py VISIT_MIVTZOIM_CUSTOM_FIELDS) but can add more, so the valid
# values for the visits.mivtzoim filter aren't static: they're looked up
# live and woven into the system prompt per request (build_system_prompt).

def _active_mivtzoim_definitions(db: Session, org_id: int) -> list:
    return (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_type == "boolean",
            models.CustomFieldDefinition.is_active.is_(True),
        )
        .order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id)
        .all()
    )


def _mivtzoim_base_query(db: Session, user: models.User):
    return (
        db.query(models.CustomFieldDefinition)
        .outerjoin(
            models.CustomFieldValue,
            and_(
                models.CustomFieldValue.definition_id == models.CustomFieldDefinition.id,
                models.CustomFieldValue.checked.is_(True),
            ),
        )
        .filter(
            models.CustomFieldDefinition.organization_id == user.organization_id,
            models.CustomFieldDefinition.entity_type == "visit",
            models.CustomFieldDefinition.field_type == "boolean",
            models.CustomFieldDefinition.is_active.is_(True),
        )
        .add_columns(func.count(models.CustomFieldValue.id).label("times_checked"))
        .group_by(models.CustomFieldDefinition.id)
    )


def _serialize_mivtzoim(db: Session, user: models.User, rows: list) -> list[dict]:
    return [
        {
            "name_he": defn.hebrew_label,
            "name_en": defn.english_label,
            "times_checked": times_checked,
        }
        for defn, times_checked in rows
    ]


# --- registry ----------------------------------------------------------

TABLES: dict[str, TableSpec] = {
    "contacts": TableSpec(
        key="contacts",
        title_he="אנשי קשר",
        title_en="Contacts",
        allowed_roles=_ALL_ROLES,
        columns={
            "name": ColumnSpec("name", "שם פרטי", "First name", "text", models.Contact.name),
            "last_name": ColumnSpec("last_name", "שם משפחה", "Last name", "text", models.Contact.last_name),
            "phone": ColumnSpec("phone", "טלפון", "Phone", "text", models.Contact.phone),
            "email": ColumnSpec("email", "אימייל", "Email", "text", models.Contact.email),
            "contact_type": ColumnSpec("contact_type", "סוג איש קשר", "Contact type", "text", models.Contact.contact_type),
            "address": ColumnSpec("address", "כתובת", "Address", "text", models.Contact.address),
            "priority_score": ColumnSpec("priority_score", "ציון עדיפות", "Priority score", "number", models.Contact.priority_score),
            "created_at": ColumnSpec("created_at", "נוצר בתאריך", "Created at", "date", models.Contact.created_at),
            "pipeline_status": ColumnSpec(
                "pipeline_status", "סטטוס פייפליין", "Pipeline status", "text",
                expr=None, allowed_ops=frozenset({"eq"}),
            ),
            "tzedaka_potential": ColumnSpec("tzedaka_potential", "פוטנציאל צדקה", "Tzedaka potential", "text", models.ContactMekurav.tzedaka_potential),
            "admin_area_name": ColumnSpec("admin_area_name", "אזור מנהל", "Admin area", "text", models.AdminArea.name),
        },
        display_columns=["name", "last_name", "phone", "contact_type", "address", "pipeline_status", "admin_area_name"],
        base_query=_contacts_base_query,
        order_by=lambda q: q.order_by(models.Contact.name),
        serialize=_serialize_contacts,
    ),
    "visits": TableSpec(
        key="visits",
        title_he="ביקורים",
        title_en="Visits",
        allowed_roles=_ALL_ROLES,
        columns={
            "visit_date": ColumnSpec("visit_date", "תאריך", "Visit date", "date", models.VisitHistory.visit_date),
            "location": ColumnSpec("location", "מיקום", "Location", "text", models.VisitHistory.location),
            "notes": ColumnSpec("notes", "הערות", "Notes", "text", models.VisitHistory.notes),
            "contact_name": ColumnSpec("contact_name", "איש קשר", "Contact", "text", models.Contact.name),
            "mivtzoim": ColumnSpec(
                "mivtzoim", "מבצע", "Mivtzoh", "text",
                expr=None, allowed_ops=frozenset({"eq"}),
            ),
        },
        display_columns=["visit_date", "contact_name", "location", "notes"],
        base_query=_visits_base_query,
        order_by=lambda q: q.order_by(models.VisitHistory.visit_date.desc()),
        serialize=_serialize_visits,
    ),
    "donations": TableSpec(
        key="donations",
        title_he="תרומות",
        title_en="Donations",
        allowed_roles=_ADMIN_ONLY,
        columns={
            "donation_date": ColumnSpec("donation_date", "תאריך", "Donation date", "date", models.Donation.donation_date),
            "amount": ColumnSpec("amount", "סכום", "Amount", "number", models.Donation.amount),
            "is_ongoing": ColumnSpec("is_ongoing", "הוראת קבע", "Ongoing", "bool", models.Donation.is_ongoing),
            "contact_name": ColumnSpec("contact_name", "איש קשר", "Contact", "text", models.Contact.name),
        },
        display_columns=["donation_date", "contact_name", "amount", "is_ongoing"],
        base_query=_donations_base_query,
        order_by=lambda q: q.order_by(models.Donation.donation_date.desc()),
        serialize=_serialize_donations,
    ),
    "buildings": TableSpec(
        key="buildings",
        title_he="בניינים",
        title_en="Buildings",
        allowed_roles=_ALL_ROLES,
        columns={
            "building_name": ColumnSpec("building_name", "שם בניין", "Building name", "text", models.Building.building_name),
            "building_address": ColumnSpec("building_address", "כתובת בניין", "Building address", "text", models.Building.building_address),
            "is_town_house": ColumnSpec("is_town_house", "בית פרטי", "Town house", "bool", models.Building.is_town_house),
            "area_name": ColumnSpec("area_name", "אזור", "Area", "text", models.Area.area_name),
        },
        display_columns=["building_name", "building_address", "area_name", "is_town_house"],
        base_query=_buildings_base_query,
        order_by=lambda q: q.order_by(models.Building.building_name),
        serialize=_serialize_buildings,
    ),
    "apartments": TableSpec(
        key="apartments",
        title_he="דירות",
        title_en="Apartments",
        allowed_roles=_ALL_ROLES,
        columns={
            "apartment_name": ColumnSpec("apartment_name", "תווית", "Apartment label", "text", models.Apartment.apartment_name),
            "floor": ColumnSpec("floor", "קומה", "Floor", "text", models.Apartment.floor),
            "name": ColumnSpec("name", "שם דייר", "Resident name", "text", models.Apartment.name),
            "phone": ColumnSpec("phone", "טלפון", "Phone", "text", models.Apartment.phone),
            "building_address": ColumnSpec("building_address", "כתובת בניין", "Building address", "text", models.Building.building_address),
        },
        display_columns=["name", "apartment_name", "floor", "phone", "building_address"],
        base_query=_apartments_base_query,
        order_by=lambda q: q.order_by(models.Building.building_address, models.Apartment.apartment_name),
        serialize=_serialize_apartments,
    ),
    "mivtzoim": TableSpec(
        key="mivtzoim",
        title_he="מבצעים",
        title_en="Mivtzoim",
        allowed_roles=_ALL_ROLES,
        columns={
            "name_he": ColumnSpec("name_he", "שם (עברית)", "Name (Hebrew)", "text", models.CustomFieldDefinition.hebrew_label),
            "name_en": ColumnSpec("name_en", "שם (אנגלית)", "Name (English)", "text", models.CustomFieldDefinition.english_label),
            "times_checked": ColumnSpec(
                "times_checked", "כמות פעמים", "Times recorded", "number",
                expr=None, allowed_ops=frozenset(),  # display-only — it's a per-request aggregate, not filterable
            ),
        },
        display_columns=["name_he", "name_en", "times_checked"],
        base_query=_mivtzoim_base_query,
        order_by=lambda q: q.order_by(models.CustomFieldDefinition.sort_order, models.CustomFieldDefinition.id),
        serialize=_serialize_mivtzoim,
    ),
}


# --- filter validation + application ------------------------------------

def _coerce_value(kind: str, raw: Any) -> Any:
    if kind == "text":
        if not isinstance(raw, (str, int, float)):
            raise ValueError("expected text")
        return str(raw)
    if kind == "number":
        if isinstance(raw, bool):
            raise ValueError("expected number")
        return float(raw)
    if kind == "bool":
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            low = raw.strip().lower()
            if low in ("true", "1", "yes", "כן"):
                return True
            if low in ("false", "0", "no", "לא"):
                return False
        raise ValueError("expected bool")
    if kind == "date":
        if isinstance(raw, str):
            return datetime.datetime.fromisoformat(raw)
        raise ValueError("expected date")
    raise ValueError(f"unknown kind {kind}")


def _apply_filter(
    db: Session, user: models.User, query, table_key: str, column: ColumnSpec, op: str, value: Any
):
    if table_key == "contacts" and column.key == "pipeline_status":
        return query.filter(
            models.Contact.id.in_(
                picklist_utils.matching_entity_ids(
                    "contacts", "contact.pipeline_status", [value]
                )
            )
        )
    if table_key == "visits" and column.key == "mivtzoim":
        valid_keys = {d.field_key for d in _active_mivtzoim_definitions(db, user.organization_id)}
        if value not in valid_keys:
            raise ManifestError(422, f"Unknown mivtzoim: {value}")
        return query.filter(
            models.VisitHistory.id.in_(
                db.query(models.CustomFieldValue.visit_id)
                .join(
                    models.CustomFieldDefinition,
                    models.CustomFieldDefinition.id == models.CustomFieldValue.definition_id,
                )
                .filter(
                    models.CustomFieldDefinition.field_key == value,
                    models.CustomFieldValue.checked.is_(True),
                )
            )
        )
    expr = column.expr
    if op == "eq":
        return query.filter(expr == value)
    if op == "contains":
        return query.filter(expr.ilike(f"%{value}%"))
    if op == "gt":
        return query.filter(expr > value)
    if op == "gte":
        return query.filter(expr >= value)
    if op == "lt":
        return query.filter(expr < value)
    if op == "lte":
        return query.filter(expr <= value)
    raise ManifestError(422, f"Unsupported operator: {op}")  # pragma: no cover


def run_query(db: Session, user: models.User, intent: Any) -> QueryResult:
    """Validate a parsed LLM intent against the allowlist and execute it,
    scoped identically to the real REST endpoint each table mirrors."""
    if not isinstance(intent, dict) or "ok" not in intent:
        raise ManifestError(502, "Unexpected AI response")
    if intent.get("ok") is False:
        message = intent.get("message") or "הבקשה אינה נתמכת"
        raise ManifestError(422, str(message)[:300])
    if intent.get("ok") is not True:
        raise ManifestError(502, "Unexpected AI response")

    table_key = intent.get("table")
    spec = TABLES.get(table_key) if isinstance(table_key, str) else None
    if spec is None or user.role not in spec.allowed_roles:
        raise ManifestError(403, "This request isn't permitted for your role")

    filters = intent.get("filters") or []
    if not isinstance(filters, list) or len(filters) > MAX_FILTERS:
        raise ManifestError(422, "Too many filters")

    query = spec.base_query(db, user)
    for raw_filter in filters:
        if not isinstance(raw_filter, dict):
            raise ManifestError(422, "Malformed filter")
        column_key = raw_filter.get("column")
        op = raw_filter.get("op")
        value = raw_filter.get("value")
        column = spec.columns.get(column_key) if isinstance(column_key, str) else None
        if column is None:
            raise ManifestError(422, f"Unknown column: {column_key}")
        allowed_ops = column.allowed_ops or OPS_BY_KIND[column.kind]
        if op not in allowed_ops:
            raise ManifestError(
                422, f"Unsupported operator '{op}' for column '{column_key}'"
            )
        try:
            coerced = _coerce_value(column.kind, value)
        except (ValueError, TypeError):
            raise ManifestError(422, f"Invalid value for column '{column_key}'")
        query = _apply_filter(db, user, query, table_key, column, op, coerced)

    query = spec.order_by(query).limit(ROW_CAP + 1)
    rows = query.all()
    truncated = len(rows) > ROW_CAP
    rows = rows[:ROW_CAP]
    display_rows = spec.serialize(db, user, rows)

    title = intent.get("title")
    table_title = str(title).strip()[:200] if title else spec.title_he

    columns_meta = [
        {
            "key": key,
            "label_he": spec.columns[key].label_he,
            "label_en": spec.columns[key].label_en,
        }
        for key in spec.display_columns
    ]

    return QueryResult(
        table_title=table_title,
        columns=columns_meta,
        rows=display_rows,
        row_count=len(display_rows),
        truncated=truncated,
    )


# --- system prompt --------------------------------------------------------

# (table key the example demonstrates, or None if it doesn't name a table —
# used to filter examples to what the calling role may actually see, so a
# non-admin's prompt never mentions "donations" even in a worked example).
_FEW_SHOT_EXAMPLES: list[tuple[Optional[str], str]] = [
    (
        "contacts",
        'User: "הראה לי אנשי קשר בכתובת ברוקלין עם סטטוס פייפליין \'לקבוע פגישה\'" '
        '→ {"ok": true, "table": "contacts", "title": "אנשי קשר בברוקלין - לקבוע פגישה", '
        '"filters": [{"column": "address", "op": "contains", "value": "Brooklyn"}, '
        '{"column": "pipeline_status", "op": "eq", "value": "לקבוע פגישה"}]}',
    ),
    (
        "donations",
        'User: "Show donations over $500 this year" → {"ok": true, "table": "donations", '
        '"title": "Donations over $500 in 2026", "filters": [{"column": "amount", '
        '"op": "gt", "value": 500}, {"column": "donation_date", "op": "gte", "value": "2026-01-01"}]}',
    ),
    (
        "apartments",
        'User: "אילו דירות יש בבניין ברחוב הרצל" → {"ok": true, "table": "apartments", '
        '"title": "דירות ברחוב הרצל", "filters": [{"column": "building_address", '
        '"op": "contains", "value": "הרצל"}]}',
    ),
    (
        "mivtzoim",
        'User: "כמה מבצעים יש לנו" → {"ok": true, "table": "mivtzoim", "title": "מבצעים", "filters": []}',
    ),
    (
        "visits",
        'User: "תראה לי ביקורים שבהם הניחו תפילין" → {"ok": true, "table": "visits", '
        '"title": "ביקורים עם תפילין", "filters": [{"column": "mivtzoim", "op": "eq", "value": "tefillin"}]}',
    ),
    (
        None,
        'User: "List last week\'s birthdays" (nothing like that is available here) '
        '→ {"ok": false, "message": "No table tracks birthdays or significant dates yet."}',
    ),
]


def build_system_prompt(db: Session, user: models.User) -> str:
    """Only lists the tables the calling user's role may see — defense in
    depth alongside the server-side role check in `run_query`. Also weaves
    in the org's live, admin-configurable mivtzoim list (field_key + labels)
    since those aren't a fixed set the model can be told about statically."""
    role = user.role
    tables = [t for t in TABLES.values() if role in t.allowed_roles]
    mivtzoim_defs = _active_mivtzoim_definitions(db, user.organization_id)
    mivtzoim_options = ", ".join(
        f'"{d.field_key}" ({d.hebrew_label} / {d.english_label or d.field_key})'
        for d in mivtzoim_defs
    )
    lines = [
        "You are the query-routing engine for a bilingual (Hebrew/English) CRM. "
        "Translate the user's natural-language request into ONE JSON object — "
        "nothing else, no prose, no markdown fences — matching exactly one of "
        "these two shapes:",
        '{"ok": true, "table": "<table key>", "title": "<short report title, '
        'in the language of the request>", "filters": [{"column": "<column key>", '
        '"op": "eq|contains|gt|gte|lt|lte", "value": <value>}]}',
        '{"ok": false, "message": "<short explanation, in the language of the '
        'request, of why no report can be produced>"}',
        "",
        "Never invent a table or column that isn't listed below. Use \"contains\" "
        "only for free-text partial matches; use \"eq\" for exact matches "
        "(including status/picklist-style fields). Dates are ISO 8601 "
        "(YYYY-MM-DD). If the request doesn't clearly map to one of the tables "
        "below, or asks for data unavailable to this role, return the ok:false "
        "form instead of guessing.",
        "",
        "Available tables:",
    ]
    for t in tables:
        col_descriptions = ", ".join(
            f"{c.key} ({c.kind}, ops: {'/'.join(sorted(c.allowed_ops or OPS_BY_KIND[c.kind]))}"
            + (
                f", valid values: {mivtzoim_options}"
                if t.key == "visits" and c.key == "mivtzoim" and mivtzoim_options
                else ""
            )
            + ")"
            for c in t.columns.values()
        )
        lines.append(f"- {t.key} ({t.title_he} / {t.title_en}): {col_descriptions}")
        if t.key == "mivtzoim" and mivtzoim_options:
            lines.append(
                f"  (each row = one mivtzoh/campaign your org currently tracks: {mivtzoim_options})"
            )
    visible_table_keys = {t.key for t in tables}
    lines.append("")
    lines.append("Examples:")
    lines.extend(
        example
        for table_key, example in _FEW_SHOT_EXAMPLES
        if table_key is None or table_key in visible_table_keys
    )
    return "\n".join(lines)
