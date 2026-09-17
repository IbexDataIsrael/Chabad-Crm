"""One-off import of docs/data2.xlsx (per docs/data_import2.md and
docs/data_import2_plan.md — read the plan for every decision made along the
way). Same base logic as scripts/import_apartment_data.py, reused wholesale,
with two modifications:

1. Column C override — every row forces its building to
   `building_type_id = "divided_town_house"` (`is_town_house = True`)
   instead of the original script's "בניין" substring rule. 100% of this
   file's rows already read "בית מחולק", so this is unconditional here.
2. Existing records — the original script's building dedup (exact address,
   then normalized (number, street)) is unchanged, so no duplicate building
   is ever created. Since every one of this file's 394 addresses already
   exists in org 1, the override in (1) is applied to the *matched* building
   too (updating building_type_id in place) rather than only at creation —
   see the plan for why this is safe here (every reclassified building has
   0 floors). A building found with floors > 0 is left untouched and logged
   as a warning instead, as a defensive guard.

Sheet «תיקונים», columns A-M (same layout as the original import) plus a
new column N ("שורה בקובץ הראשי" — row number in the source file), which is
a traceability pointer only and isn't written anywhere.

Apartment dedup is in-file only (same as the original script) — this does
NOT check for apartments already in the DB under a matched building, so a
matched building's pre-existing single apartment is left as-is and this
run's apartment(s) are added alongside it (see plan).

Default is a DRY-RUN (prints a summary, rolls back). Pass --commit to persist.

Run inside the backend container:
    python -m scripts.import_data2 --org-id 1 --xlsx /tmp/data2.xlsx [--commit]
"""
import argparse
import re
import sys
import time
from collections import Counter

import openpyxl

from app import models, picklist_utils
from app.core.display import building_display_name
from app.core.geocode import geocode_address
from app.database import SessionLocal
from app.schemas import _validate_email, _validate_phone

COL = {
    "report": 1,  # A
    "area": 2,  # B
    "btype": 3,  # C
    "street": 4,  # D
    "number": 5,  # E
    "floor": 6,  # F
    "apt": 7,  # G
    "jewish": 8,  # H
    "language": 9,  # I
    "name": 10,  # J
    "notes": 11,  # K
    "contact": 12,  # L
    "mezuzah": 13,  # M
}

GEOCODE_SUFFIX = ", Brooklyn, NY"

TARGET_BUILDING_TYPE_ID = "divided_town_house"

JEWISH_STATUS_MAP = {
    "יהודי": "jewish",
    "יהודי מעוניין": "jewish_interested",
    "יהודי וגוי": "jewish_gentile",
    "יהודי מעוניין וגוי": "jewish_interested_gentile",
    "יהודי שתומצ": "jewish_shtumtz",
    "גוי": "gentile",
}
# Longest key first so "יהודי מעוניין וגוי" is tried before "יהודי".
JEWISH_STATUS_PREFIXES = sorted(JEWISH_STATUS_MAP, key=len, reverse=True)

LANGUAGE_MAP = {
    "רוסית": "russian",
    "אנגלית": "english",
    "עברית": "hebrew",
    "יידיש": "yiddish",
    "אידיש": "yiddish",
}

MEZUZAH_FIELD_KEY = "mezuzah_notes"


def cell_text(ws, row, col):
    """Cell as a trimmed string; numeric cells lose any trailing '.0'."""
    v = ws.cell(row=row, column=col).value
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def append_note(notes, text):
    return f"{notes}\n{text}" if notes else text


def normalize_address_key(address):
    """(street, number) key so a differently-ordered address string still
    matches an existing building — see import_apartment_data.py's original
    plan note; carried over unchanged."""
    if not address:
        return None
    first_segment = address.split(",")[0].strip()
    tokens = first_segment.split()
    if not tokens:
        return None
    if tokens[0].isdigit():
        number, street = tokens[0], " ".join(tokens[1:])
    elif tokens[-1].isdigit():
        number, street = tokens[-1], " ".join(tokens[:-1])
    else:
        return None
    return (number, street.strip().lower())


def resolve_jewish_status(raw, warnings):
    """-> (stored value or None, leftover text for notes or None)."""
    key = raw.replace('"', "").replace("״", "").strip()
    if key in JEWISH_STATUS_MAP:
        return JEWISH_STATUS_MAP[key], None
    for prefix in JEWISH_STATUS_PREFIXES:
        if key.startswith(prefix):
            leftover = key[len(prefix):].strip(" \n-")
            warnings["jewish_status_prefix_match"] += 1
            return JEWISH_STATUS_MAP[prefix], (f"יהדות: {raw}" if leftover else None)
    warnings["jewish_status_unmapped"] += 1
    return None, f"יהדות: {raw}"


def resolve_languages(raw, warnings):
    """-> (list of stored values, leftover text for notes or None)."""
    values, leftovers = [], []
    for segment in raw.split(","):
        seg = segment.strip()
        if not seg:
            continue
        mapped = LANGUAGE_MAP.get(seg)
        if mapped:
            if mapped not in values:
                values.append(mapped)
        else:
            warnings["language_unmapped"] += 1
            leftovers.append(seg)
    note = f"שפה: {raw}" if leftovers else None
    return values, note


_PHONE_CANDIDATE_RE = re.compile(r"[\d][\d\-\s().]{7,}[\d]")


def resolve_contact(raw, warnings):
    """-> (email or None, phone or None, leftover text for notes or None)."""
    raw = raw.strip()
    try:
        email = _validate_email(raw)
        if email:
            return email, None, None
    except ValueError:
        pass
    try:
        phone = _validate_phone(raw)
        if phone:
            return None, phone, None
    except ValueError:
        pass
    for match in _PHONE_CANDIDATE_RE.finditer(raw):
        try:
            phone = _validate_phone(match.group(0).strip())
            if phone:
                warnings["contact_extracted_from_junk"] += 1
                return None, phone, f"טלפון/אימייל (גולמי): {raw}"
        except ValueError:
            continue
    warnings["contact_unparsed"] += 1
    return None, None, f"טלפון/אימייל (לא זוהה): {raw}"


def floor_sort_order(name, warnings):
    s = name.strip()
    if s.isdigit():
        return int(s)
    m = re.match(r"^(\d+)", s)
    if m:
        return int(m.group(1))
    upper = s.upper()
    # fixes64 §1: "L" (Lobby) always sorts ahead of every other floor,
    # including the basement/sub-basement tiers below — mirrors the app's own
    # add_floor()/create_building() rule (app/routers/buildings.py).
    if upper == "L":
        return -1000
    if upper in ("BSMT", "B", "LB") or s == "למטה":
        return -1
    if upper == "LL":
        return -2
    if s == "למעלה":
        return 1
    if upper == "PH":
        return 1000
    warnings["floor_name_unrecognized"][s] += 1
    return 900


def get_or_create_definition(db, org_id, field_key):
    definition = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.system_name == field_key,
        )
        .first()
    )
    if definition is None:
        hebrew_label, entity_type = picklist_utils.PICKLIST_FIELDS[field_key]
        definition = models.PicklistDefinition(
            organization_id=org_id,
            system_name=field_key,
            hebrew_display_name=hebrew_label,
            entity_type=entity_type,
            is_system=True,
            allow_multiple=field_key in picklist_utils.MULTI_VALUE_PICKLIST_FIELDS,
        )
        db.add(definition)
        db.flush()
    return definition


def get_or_create_value(db, org_id, field_key, value, cache):
    key = (field_key, value)
    if key in cache:
        return cache[key]
    picklist_value = (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == field_key,
            models.PicklistValue.value == value,
        )
        .first()
    )
    if picklist_value is None:
        picklist_value = models.PicklistValue(
            organization_id=org_id,
            field_key=field_key,
            value=value,
            hebrew_label=value,
            is_active=False,
        )
        db.add(picklist_value)
        db.flush()
    cache[key] = picklist_value
    return picklist_value


def ensure_mezuzah_field(db, org_id):
    definition = (
        db.query(models.CustomFieldDefinition)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
            models.CustomFieldDefinition.field_key == MEZUZAH_FIELD_KEY,
        )
        .first()
    )
    if definition:
        return definition, False
    max_sort = (
        db.query(models.CustomFieldDefinition.sort_order)
        .filter(
            models.CustomFieldDefinition.organization_id == org_id,
            models.CustomFieldDefinition.entity_type == "apartment",
        )
        .order_by(models.CustomFieldDefinition.sort_order.desc())
        .limit(1)
        .scalar()
    )
    definition = models.CustomFieldDefinition(
        organization_id=org_id,
        entity_type="apartment",
        field_key=MEZUZAH_FIELD_KEY,
        hebrew_label="הערות מזוזה",
        english_label="Mezuzah notes",
        field_type="text",
        sort_order=(max_sort if max_sort is not None else -1) + 1,
    )
    db.add(definition)
    db.flush()
    return definition, True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xlsx", default="/tmp/data2.xlsx")
    ap.add_argument("--org-id", type=int, required=True)
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    args = ap.parse_args()

    ws = openpyxl.load_workbook(args.xlsx, data_only=True).worksheets[0]
    db = SessionLocal()
    try:
        org = db.get(models.Organization, args.org_id)
        if org is None:
            print(f"ERROR: organization {args.org_id} not found")
            return 1
        print(f"Target org: {org.id} — {org.name} ({'COMMIT' if args.commit else 'DRY-RUN'})")

        mezuzah_def, mezuzah_created = ensure_mezuzah_field(db, org.id)

        jewish_definition = get_or_create_definition(db, org.id, "apartment.Jewish_status")
        language_definition = get_or_create_definition(db, org.id, "apartment.language")
        picklist_value_cache = {}
        for v in set(JEWISH_STATUS_MAP.values()):
            get_or_create_value(db, org.id, "apartment.Jewish_status", v, picklist_value_cache)
        for v in set(LANGUAGE_MAP.values()):
            get_or_create_value(db, org.id, "apartment.language", v, picklist_value_cache)

        areas = {
            a.area_name: a
            for a in db.query(models.Area).filter(models.Area.organization_id == org.id)
        }
        existing_buildings = (
            db.query(models.Building).filter(models.Building.organization_id == org.id).all()
        )
        buildings_by_address = {b.building_address: b for b in existing_buildings}
        buildings_by_norm = {}
        for b in existing_buildings:
            key = normalize_address_key(b.building_address)
            if key:
                buildings_by_norm.setdefault(key, b)
        # Building.id -> current floor count, computed once up front so the
        # reclassify-guard below (mod 2 in the plan: never touch a building
        # that actually has floors) is a cheap in-memory check per row
        # instead of a query per row.
        floor_counts = Counter(
            building_id
            for (building_id,) in db.query(models.Floor.building_id).filter(
                models.Floor.organization_id == org.id
            )
        )
        building_by_id = {b.id: b for b in existing_buildings}
        floors = {
            (building_by_id[f.building_id], f.name): f
            for f in db.query(models.Floor).filter(models.Floor.organization_id == org.id)
            if f.building_id in building_by_id
        }
        reports = {
            r.name: r
            for r in db.query(models.ReportNumber).filter(
                models.ReportNumber.organization_id == org.id
            )
        }
        # Apartment count per existing building before this run (informational
        # only — see plan's "apartment dedup is in-file only" note).
        apartments_before = Counter(
            building_id
            for (building_id,) in db.query(models.Apartment.building_id).filter(
                models.Apartment.organization_id == org.id,
                models.Apartment.is_display == True,  # noqa: E712
            )
        )

        stats = Counter()
        warnings = Counter()
        warnings["floor_name_unrecognized"] = Counter()
        jewish_counts = Counter()
        language_counts = Counter()
        new_areas, new_buildings = [], []
        matched_existing_buildings = []  # (address, old_type) already divided_town_house
        reclassified_buildings = []  # (address, old_type)
        skipped_reclassify_has_floors = []  # (address, floor_count) — guard triggered
        buildings_with_prior_apartments = []  # (address, count_before)
        # Buildings this run has already classified/logged once — subsequent
        # rows referencing the same building (very common: this file lists
        # one row per apartment, several per address) must not be logged or
        # reclassified again.
        handled_building_ids = set()
        apartments_by_key = {}  # (building, floor_raw, apt_raw) -> Apartment

        pending_batch = []  # [(apartment, jewish_status, languages, mezuzah_raw), ...]
        BATCH_SIZE = 500

        def flush_batch():
            db.flush()
            for apt, j_status, langs, mezuzah in pending_batch:
                if j_status:
                    db.add(
                        models.PicklistLink(
                            organization_id=org.id,
                            entity_table="apartments",
                            entity_id=apt.id,
                            picklist_definition_id=jewish_definition.id,
                            picklist_value_id=picklist_value_cache[
                                ("apartment.Jewish_status", j_status)
                            ].id,
                        )
                    )
                for lang in langs:
                    db.add(
                        models.PicklistLink(
                            organization_id=org.id,
                            entity_table="apartments",
                            entity_id=apt.id,
                            picklist_definition_id=language_definition.id,
                            picklist_value_id=picklist_value_cache[
                                ("apartment.language", lang)
                            ].id,
                        )
                    )
                if mezuzah:
                    db.add(
                        models.CustomFieldValue(
                            organization_id=org.id,
                            entity_table="apartments",
                            entity_id=apt.id,
                            definition_id=mezuzah_def.id,
                            value=mezuzah,
                        )
                    )
            db.flush()
            pending_batch.clear()

        start_time = time.time()
        PROGRESS_EVERY = 2000

        for row_num in range(2, ws.max_row + 1):
            if row_num % PROGRESS_EVERY == 0:
                elapsed = time.time() - start_time
                rate = row_num / elapsed if elapsed else 0
                print(
                    f"  ...row {row_num}/{ws.max_row} "
                    f"({elapsed:.0f}s elapsed, {rate:.0f} rows/s)",
                    flush=True,
                )
            report_raw = cell_text(ws, row_num, COL["report"])
            street = cell_text(ws, row_num, COL["street"])
            apt_raw = cell_text(ws, row_num, COL["apt"])
            if report_raw is None and street is None and apt_raw is None:
                continue
            stats["rows"] += 1

            area_name = cell_text(ws, row_num, COL["area"])
            number = cell_text(ws, row_num, COL["number"])
            floor_raw = cell_text(ws, row_num, COL["floor"])
            jewish_raw = cell_text(ws, row_num, COL["jewish"])
            lang_raw = cell_text(ws, row_num, COL["language"])
            name_raw = cell_text(ws, row_num, COL["name"])
            notes = cell_text(ws, row_num, COL["notes"])
            contact_raw = cell_text(ws, row_num, COL["contact"])
            mezuzah_raw = cell_text(ws, row_num, COL["mezuzah"])

            if not (street and number):
                warnings["missing_street_or_number"] += 1
                continue

            # Step 2: area.
            area = areas.get(area_name) if area_name else None
            if area_name and area is None:
                area = models.Area(organization_id=org.id, area_name=area_name)
                db.add(area)
                db.flush()
                areas[area_name] = area
                new_areas.append(area_name)

            # Step 4: building (existing-building dedup, unchanged from the
            # original script) + Modification 1/2 (column C override applied
            # to the matched building, guarded by Modification 2's
            # floors > 0 defensive check).
            address = f"{street} {number}"
            building = buildings_by_address.get(address)
            if building is None:
                norm_key = normalize_address_key(address)
                building = buildings_by_norm.get(norm_key) if norm_key else None

            if building is None:
                coords = geocode_address(f"{address}{GEOCODE_SUFFIX}")
                building = models.Building(
                    organization_id=org.id,
                    area=area,
                    building_address=address,
                    is_town_house=True,
                    building_type_id=TARGET_BUILDING_TYPE_ID,
                    longitude=coords[1] if coords else None,
                    latitude=coords[0] if coords else None,
                )
                db.add(building)
                db.flush()
                buildings_by_address[address] = building
                norm_key = normalize_address_key(address)
                if norm_key:
                    buildings_by_norm[norm_key] = building
                new_buildings.append(address)
            elif building.id not in handled_building_ids:
                handled_building_ids.add(building.id)
                prior_floor_count = floor_counts.get(building.id, 0)
                old_type = building.building_type_id
                if old_type == TARGET_BUILDING_TYPE_ID:
                    matched_existing_buildings.append((address, old_type))
                elif prior_floor_count > 0:
                    skipped_reclassify_has_floors.append((address, prior_floor_count))
                    warnings["reclassify_skipped_has_floors"] += 1
                else:
                    building.building_type_id = TARGET_BUILDING_TYPE_ID
                    building.is_town_house = True
                    reclassified_buildings.append((address, old_type))
                prior_apts = apartments_before.get(building.id, 0)
                if prior_apts:
                    buildings_with_prior_apartments.append((address, prior_apts))
            stats["buildings_seen"] += 1

            # Step 5: floor.
            if floor_raw and (building, floor_raw) not in floors:
                floor = models.Floor(
                    organization_id=org.id,
                    building=building,
                    name=floor_raw,
                    sort_order=floor_sort_order(floor_raw, warnings),
                )
                db.add(floor)
                db.flush()
                floors[(building, floor_raw)] = floor
                stats["floors_created"] += 1

            # Step 1: report number.
            report = reports.get(report_raw) if report_raw else None
            if report_raw and report is None:
                report = models.ReportNumber(organization_id=org.id, name=report_raw)
                db.add(report)
                db.flush()
                reports[report_raw] = report
                stats["reports_created"] += 1

            # Steps 6-8: field resolution.
            jewish_status, jewish_leftover = (
                resolve_jewish_status(jewish_raw, warnings) if jewish_raw else (None, None)
            )
            if jewish_status:
                jewish_counts[jewish_status] += 1
            if jewish_leftover:
                notes = append_note(notes, jewish_leftover)

            languages, lang_leftover = (
                resolve_languages(lang_raw, warnings) if lang_raw else ([], None)
            )
            for lang in languages:
                language_counts[lang] += 1
            if lang_leftover:
                notes = append_note(notes, lang_leftover)

            email = phone = None
            if contact_raw:
                email, phone, contact_leftover = resolve_contact(contact_raw, warnings)
                if contact_leftover:
                    notes = append_note(notes, contact_leftover)

            if apt_raw:
                apartment_name = apt_raw
            elif floor_raw:
                apartment_name = floor_raw
            else:
                apartment_name = f"{building_display_name(building)}-th"
                warnings["fallback_th_name"] += 1

            # Merge duplicate (building, floor, apt) rows within this import
            # (same as the original script) — not cross-checked against
            # apartments already in the DB (see plan).
            dedup_key = (building, floor_raw, apt_raw)
            existing_apt = apartments_by_key.get(dedup_key)
            if existing_apt is not None:
                flush_batch()
                stats["rows_merged"] += 1
                if name_raw and not existing_apt.name:
                    existing_apt.name = name_raw
                elif name_raw and existing_apt.name and name_raw != existing_apt.name:
                    existing_apt.apartment_notes = append_note(
                        existing_apt.apartment_notes, f"שם נוסף: {name_raw}"
                    )
                if notes:
                    existing_apt.apartment_notes = append_note(
                        existing_apt.apartment_notes, notes
                    )
                if email and not existing_apt.email:
                    existing_apt.email = email
                if phone and not existing_apt.phone:
                    existing_apt.phone = phone
                if report and not existing_apt.report_number_id:
                    existing_apt.report_number_id = report.id
                if jewish_status and not picklist_utils.get_values(
                    db, org.id, "apartments", existing_apt.id, ["apartment.Jewish_status"]
                )["apartment.Jewish_status"]:
                    picklist_utils.set_value(
                        db, org.id, "apartments", existing_apt.id,
                        "apartment.Jewish_status", jewish_status,
                    )
                if languages:
                    merged = set(
                        picklist_utils.get_multi_values(
                            db, org.id, "apartments", existing_apt.id, "apartment.language"
                        )
                    ) | set(languages)
                    picklist_utils.set_multi_values(
                        db, org.id, "apartments", existing_apt.id,
                        "apartment.language", sorted(merged),
                    )
                if mezuzah_raw:
                    existing = (
                        db.query(models.CustomFieldValue)
                        .filter(
                            models.CustomFieldValue.entity_table == "apartments",
                            models.CustomFieldValue.entity_id == existing_apt.id,
                            models.CustomFieldValue.definition_id == mezuzah_def.id,
                        )
                        .first()
                    )
                    if existing and existing.value:
                        existing.value = append_note(existing.value, mezuzah_raw)
                    elif existing:
                        existing.value = mezuzah_raw
                    else:
                        db.add(
                            models.CustomFieldValue(
                                organization_id=org.id,
                                entity_table="apartments",
                                entity_id=existing_apt.id,
                                definition_id=mezuzah_def.id,
                                value=mezuzah_raw,
                            )
                        )
                continue

            apartment = models.Apartment(
                organization_id=org.id,
                building=building,
                floor=floor_raw,
                apartment_name=apartment_name,
                name=name_raw,
                phone=phone,
                email=email,
                apartment_notes=notes,
            )
            if report:
                apartment.report_number = report
            db.add(apartment)
            apartments_by_key[dedup_key] = apartment

            pending_batch.append((apartment, jewish_status, languages, mezuzah_raw))
            if len(pending_batch) >= BATCH_SIZE:
                flush_batch()
            stats["apartments_created"] += 1

        flush_batch()

        print(f"\nrows processed: {stats['rows']}")
        print(f"mezuzah_notes custom field: {'created' if mezuzah_created else 'already existed'}")
        print(f"areas created ({len(new_areas)}): {new_areas[:20]}{'...' if len(new_areas) > 20 else ''}")
        print(f"buildings created new: {len(new_buildings)}")
        print(f"existing buildings matched (not re-created) — total: {len(matched_existing_buildings) + len(reclassified_buildings) + len(skipped_reclassify_has_floors)}")
        print(f"  reclassified to divided_town_house ({len(reclassified_buildings)}):")
        by_old_type = Counter(t for _, t in reclassified_buildings)
        print(f"    by previous building_type_id: {dict(by_old_type)}")
        for addr, old_type in reclassified_buildings[:20]:
            print(f"    {addr!r}: {old_type} -> divided_town_house")
        if len(reclassified_buildings) > 20:
            print(f"    ...and {len(reclassified_buildings) - 20} more")
        print(f"  already divided_town_house, unchanged ({len(matched_existing_buildings)})")
        print(f"  skipped reclassify — building has floors > 0 ({len(skipped_reclassify_has_floors)}):")
        for addr, fc in skipped_reclassify_has_floors:
            print(f"    {addr!r}: {fc} floor(s) — left as-is")
        print(f"buildings with apartment(s) already in DB before this run ({len(buildings_with_prior_apartments)}, informational — old apartment(s) kept, not merged):")
        for addr, count in buildings_with_prior_apartments[:20]:
            print(f"    {addr!r}: {count} pre-existing apartment(s)")
        if len(buildings_with_prior_apartments) > 20:
            print(f"    ...and {len(buildings_with_prior_apartments) - 20} more")
        print(f"floors created: {stats['floors_created']}")
        print(f"report numbers created: {stats['reports_created']}")
        print(f"apartments created: {stats['apartments_created']}")
        print(f"rows merged into an existing (this-run) apartment: {stats['rows_merged']}")
        print(f"jewish_status tally: {dict(jewish_counts)}")
        print(f"language tally: {dict(language_counts)}")
        print("\nwarnings (aggregated):")
        for key, count in warnings.items():
            if key == "floor_name_unrecognized":
                if count:
                    print(f"  floor_name_unrecognized: {dict(count)}")
                continue
            if count:
                print(f"  {key}: {count}")

        if args.commit:
            db.commit()
            print("\nCOMMITTED.")
        else:
            db.rollback()
            print("\nDry-run only — nothing was written. Re-run with --commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
