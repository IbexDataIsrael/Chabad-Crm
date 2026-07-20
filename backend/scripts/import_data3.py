"""One-off import of docs/data3.xlsx (per docs/importdata3-plan.md).

Sequentially processes sheet «גיליון1»: per row, upserts the report number
(col A), the building (cols B+C, keyed by "{number} {street}" address), and
the building's floor (col D), then inserts an `apartments` row (cols E–J:
label, jewish status, language, resident name, notes, phone). All buildings
land in one new area «שיפסיידביי». Two picklist options are added to the org
if missing: apartment.Jewish_status `gentile` («גוי») and apartment.language
`russian_english` («רוסית ואנגלית»); unmappable language texts fall back to
substring detection with the original preserved in the notes.

Default is a DRY-RUN (prints actions, rolls back). Pass --commit to persist.

Run inside the backend container:
    python -m scripts.import_data3 --org-id 1 --xlsx /tmp/data3.xlsx [--commit]
"""
import argparse
import sys

import openpyxl

from app import models, picklist_utils
from app.database import SessionLocal

# Column indexes (1-based) in sheet «גיליון1».
COL = {
    "report": 1,  # A REPORT NUMBER
    "street": 2,  # B STREET NAME
    "number": 3,  # C STREET NUMBER
    "floor": 4,  # D FLOOR
    "apartment": 5,  # E APARTMENT NO
    "jewish": 6,  # F JEWISH STATUS
    "language": 7,  # G LANGUAGE
    "name": 8,  # H NAME (resident)
    "notes": 9,  # I COMMENTS
    "phone": 10,  # J PHONE
}

IMPORT_AREA_NAME = "שיפסיידביי"

# File value (quote-stripped) -> stored apartment.Jewish_status value.
JEWISH_STATUS_MAP = {
    "יהודי": "jewish",
    "יהודי מעוניין": "jewish_interested",
    "יהודי וגוי": "jewish_gentile",
    "יהודי מעוניין וגוי": "jewish_interested_gentile",
    "יהודי שתומצ": "jewish_shtumtz",
    "גוי": "gentile",
}

# Clean/exact language texts -> stored apartment.language value.
LANGUAGE_MAP = {
    "רוסית": "russian",
    "אנגלית": "english",
    "עברית": "hebrew",
    "יידיש": "yiddish",
    "אידיש": "yiddish",
    "רוסית ואנגלית": "russian_english",
    "רוסית אנגלית": "russian_english",
    "אנגלית רוסית": "russian_english",
    "אנגלית ורוסית": "russian_english",
}

# Options the import may add to the org's picklists: (field_key, value, he, en).
NEW_PICKLIST_OPTIONS = [
    ("apartment.Jewish_status", "gentile", "גוי", "Gentile"),
    ("apartment.language", "russian_english", "רוסית ואנגלית", "Russian & English"),
]


def cell_text(ws, row, col):
    """Cell as a trimmed string; numeric cells lose any trailing '.0'."""
    v = ws.cell(row=row, column=col).value
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def floor_sort_order(name, warnings, row):
    if name.isdigit():
        return int(name)
    if name == "BSMT":
        return -1
    warnings.append(f"row {row}: unexpected floor name '{name}' — sort_order 999")
    return 999


def map_language(text):
    """-> (stored value or None, needs_note). Exact matches carry no note;
    fallback substring detection preserves the original text in the notes."""
    exact = LANGUAGE_MAP.get(text)
    if exact:
        return exact, False
    has_ru = "רוסית" in text
    has_en = "אנגלית" in text
    if has_ru and has_en:
        return "russian_english", True
    if has_ru:
        return "russian", True
    if has_en:
        return "english", True
    if "עברית" in text:
        return "hebrew", True
    if "אידיש" in text or "יידיש" in text:
        return "yiddish", True
    return None, True


def ensure_picklist_options(db, org_id, created):
    for field_key, value, he, en in NEW_PICKLIST_OPTIONS:
        exists = (
            db.query(models.PicklistValue)
            .filter(
                models.PicklistValue.organization_id == org_id,
                models.PicklistValue.field_key == field_key,
                models.PicklistValue.value == value,
            )
            .first()
        )
        if exists:
            continue
        max_sort = (
            db.query(models.PicklistValue.sort_order)
            .filter(
                models.PicklistValue.organization_id == org_id,
                models.PicklistValue.field_key == field_key,
            )
            .order_by(models.PicklistValue.sort_order.desc())
            .limit(1)
            .scalar()
        )
        db.add(
            models.PicklistValue(
                organization_id=org_id,
                field_key=field_key,
                value=value,
                hebrew_label=he,
                english_value=en,
                sort_order=(max_sort if max_sort is not None else -1) + 1,
            )
        )
        created.append(f"{field_key}: {value} ({he})")
    db.flush()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xlsx", default="/tmp/data3.xlsx")
    ap.add_argument("--org-id", type=int, required=True)
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    ap.add_argument(
        "--force-rerun",
        action="store_true",
        help="proceed even if the org already contains the import's buildings",
    )
    args = ap.parse_args()

    ws = openpyxl.load_workbook(args.xlsx, data_only=True).worksheets[0]
    db = SessionLocal()
    try:
        org = db.get(models.Organization, args.org_id)
        if org is None:
            print(f"ERROR: organization {args.org_id} not found")
            return 1
        print(f"Target org: {org.id} — {org.name} ({'COMMIT' if args.commit else 'DRY-RUN'})")

        # Re-run guard: none of the file's composite addresses may pre-exist.
        addresses = set()
        for row in range(2, ws.max_row + 1):
            street = cell_text(ws, row, COL["street"])
            number = cell_text(ws, row, COL["number"])
            if street and number:
                addresses.add(f"{number} {street}")
        clashing = (
            db.query(models.Building)
            .filter(
                models.Building.organization_id == org.id,
                models.Building.building_address.in_(addresses),
            )
            .count()
        )
        if clashing and not args.force_rerun:
            print(
                f"ERROR: org already has {clashing} of the file's buildings — the "
                "import likely already ran. Pass --force-rerun to import anyway."
            )
            return 1

        # Import area (all buildings), created once.
        area = (
            db.query(models.Area)
            .filter(
                models.Area.organization_id == org.id,
                models.Area.area_name == IMPORT_AREA_NAME,
            )
            .first()
        )
        area_created = area is None
        if area_created:
            area = models.Area(organization_id=org.id, area_name=IMPORT_AREA_NAME)
            db.add(area)
            db.flush()

        new_options = []
        ensure_picklist_options(db, org.id, new_options)

        # Org-scoped caches, seeded from the DB (spec: lookups before creates).
        reports = {
            r.name: r
            for r in db.query(models.ReportNumber).filter(
                models.ReportNumber.organization_id == org.id
            )
        }
        buildings = {
            b.building_address: b
            for b in db.query(models.Building).filter(
                models.Building.organization_id == org.id
            )
        }
        floors = {
            (f.building_id, f.name): f
            for f in db.query(models.Floor).filter(
                models.Floor.organization_id == org.id
            )
        }

        stats = {
            "rows": 0,
            "apartments": 0,
            "reports": [],
            "buildings": [],
            "floors": 0,
            "lang_notes": 0,
        }
        jewish_counts = {}
        lang_counts = {}
        warnings = []

        for row in range(2, ws.max_row + 1):
            report_name = cell_text(ws, row, COL["report"])
            street = cell_text(ws, row, COL["street"])
            number = cell_text(ws, row, COL["number"])
            apt_name = cell_text(ws, row, COL["apartment"])
            if not (report_name or street or apt_name):
                continue  # blank tail row
            stats["rows"] += 1
            if not (street and number):
                warnings.append(f"row {row}: missing street/number — row skipped")
                continue

            # Step 1: report number.
            report = reports.get(report_name) if report_name else None
            if report_name and report is None:
                report = models.ReportNumber(
                    organization_id=org.id, name=report_name
                )
                db.add(report)
                db.flush()
                reports[report_name] = report
                stats["reports"].append(report_name)

            # Step 2: building.
            address = f"{number} {street}"
            building = buildings.get(address)
            if building is None:
                building = models.Building(
                    organization_id=org.id,
                    area_id=area.id,
                    building_address=address,
                )
                db.add(building)
                db.flush()
                buildings[address] = building
                stats["buildings"].append(address)

            # Step 3: floor (per building; apartments reference it by name).
            floor_name = cell_text(ws, row, COL["floor"])
            if floor_name and (building.id, floor_name) not in floors:
                floor = models.Floor(
                    organization_id=org.id,
                    building_id=building.id,
                    name=floor_name,
                    sort_order=floor_sort_order(floor_name, warnings, row),
                )
                db.add(floor)
                db.flush()
                floors[(building.id, floor_name)] = floor
                stats["floors"] += 1

            # Steps 4–7: field extraction.
            notes = cell_text(ws, row, COL["notes"])

            jewish_raw = cell_text(ws, row, COL["jewish"])
            jewish_status = None
            if jewish_raw:
                key = jewish_raw.replace('"', "").replace("״", "")
                jewish_status = JEWISH_STATUS_MAP.get(key)
                if jewish_status is None:
                    warnings.append(
                        f"row {row}: unknown jewish status '{jewish_raw}' — kept in notes"
                    )
                    extra = f"יהדות: {jewish_raw}"
                    notes = f"{notes}\n{extra}" if notes else extra
                else:
                    jewish_counts[jewish_status] = jewish_counts.get(jewish_status, 0) + 1

            lang_raw = cell_text(ws, row, COL["language"])
            language = None
            if lang_raw:
                language, needs_note = map_language(lang_raw)
                if language:
                    lang_counts[language] = lang_counts.get(language, 0) + 1
                if needs_note:
                    extra = f"שפה: {lang_raw}"
                    notes = f"{notes}\n{extra}" if notes else extra
                    stats["lang_notes"] += 1

            # Step 8: apartment insert (fresh versioning lineage). jewish_status
            # /language are picklist-backed (fixes32) — set via PicklistLink
            # after the row has an id.
            apartment = models.Apartment(
                organization_id=org.id,
                building_id=building.id,
                report_number_id=report.id if report else None,
                floor=floor_name,
                apartment_name=apt_name,
                name=cell_text(ws, row, COL["name"]),
                phone=cell_text(ws, row, COL["phone"]),
                apartment_notes=notes,
            )
            db.add(apartment)
            if jewish_status or language:
                db.flush()
                if jewish_status:
                    picklist_utils.set_value(
                        db, org.id, "apartments", apartment.id,
                        "apartment.Jewish_status", jewish_status,
                    )
                if language:
                    picklist_utils.set_value(
                        db, org.id, "apartments", apartment.id,
                        "apartment.language", language,
                    )
            stats["apartments"] += 1

        print(f"\nrows processed: {stats['rows']}")
        print(f"area: {'create «' + IMPORT_AREA_NAME + '»' if area_created else 'exists'}")
        print(f"picklist options to create: {new_options or 'none'}")
        print(f"report numbers to create ({len(stats['reports'])}): {stats['reports']}")
        print(f"buildings to create ({len(stats['buildings'])}): {stats['buildings']}")
        print(f"floor rows to create: {stats['floors']}")
        print(f"apartments to create: {stats['apartments']}")
        print(f"jewish_status tally: {jewish_counts}")
        print(f"language tally: {lang_counts}")
        print(f"language texts preserved in notes: {stats['lang_notes']}")
        for w in warnings:
            print("WARNING:", w)

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
