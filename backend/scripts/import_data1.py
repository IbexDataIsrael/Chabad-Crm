"""One-off import of docs/data1.xlsx (per docs/data_import-plan.md).

Creates, per named row (column M): a `contacts` row (mekurav, phone=NULL) +
`contact_mekurav` (admin area link, tzedaka potential, texts) +
`community_checklists` (mitzvot flags/notes, torah_thought) and, for column K
(parashah of the first visit), a `visit_history` row dated to that parashah's
2025 Shabbat. Admin areas (column L) are looked up / created per organization.

Default is a DRY-RUN (prints actions, rolls back). Pass --commit to persist.

Run inside the backend container:
    python -m scripts.import_data1 --org-id 1 --xlsx /tmp/data1.xlsx [--commit]
"""
import argparse
import datetime
import sys

import openpyxl

from app import models
from app.database import SessionLocal

# Column indexes (1-based) in the sheet «מעקב אחרי אנשים שביקרתי».
COL = {
    "background": 1,  # A
    "recommendations": 2,  # B
    "rebbe_connection": 3,  # C
    "torah_letter": 4,  # D
    "torah_thought": 5,  # E
    "torah_pamphlet": 6,  # F (עלון)
    "shabbat_candles": 7,  # G
    "tzedakah": 8,  # H
    "tefillin": 9,  # I (תפילין)
    "tzedaka_potential": 10,  # J
    "first_visit": 11,  # K (parashah name)
    "admin_area": 12,  # L
    "name": 13,  # M
}

# checklist column pairs: sheet key -> (bool attr, notes attr)
CHECKLIST_PAIRS = {
    "torah_letter": ("torah_letter", "letter_torah_notes"),
    "torah_pamphlet": ("torah_pamphlet", "torah_pamphlet_notes"),
    "shabbat_candles": ("shabbat_candles", "shabbat_candles_notes"),
    "tzedakah": ("tzedakah", "charity_note"),
    "tefillin": ("tefillin", "tefillin_notes"),
}

# Parashah of the first visit -> that Shabbat's date in 2025 (Diaspora cycle).
PARASHAH_DATES = {
    "שלח": datetime.date(2025, 6, 21),
    "קורח": datetime.date(2025, 6, 28),
    "קרח": datetime.date(2025, 6, 28),
}

TORAH_THOUGHT_GIVEN = "given"  # picklist value labeled «נמסר»


def cell_text(ws, row, col):
    v = ws.cell(row=row, column=col).value
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def is_bare_marker(text):
    """True for cells that only flag the mitzvah (1, *1, 1*) with no real note."""
    return text is not None and text.replace("*", "").strip() == "1"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--xlsx", default="/tmp/data1.xlsx")
    ap.add_argument("--org-id", type=int, required=True)
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    ap.add_argument(
        "--force-rerun",
        action="store_true",
        help="proceed even if the org already contains phoneless contacts",
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

        # Re-run guard: imported contacts are (initially) the only phoneless ones.
        phoneless = (
            db.query(models.Contact)
            .filter(
                models.Contact.organization_id == org.id,
                models.Contact.phone.is_(None),
            )
            .count()
        )
        if phoneless and not args.force_rerun:
            print(
                f"ERROR: org already has {phoneless} phoneless contacts — the import "
                "likely already ran. Pass --force-rerun to import anyway."
            )
            return 1

        # Org-scoped admin-area cache (trimmed-name lookup, like the plan says).
        areas = {
            a.name: a
            for a in db.query(models.AdminArea).filter(
                models.AdminArea.organization_id == org.id
            )
        }
        created_areas = []

        stats = {"contacts": 0, "visits": 0, "thought_extra": 0}
        flag_counts = {k: 0 for k in CHECKLIST_PAIRS}
        warnings = []

        for row in range(2, ws.max_row + 1):
            name = cell_text(ws, row, COL["name"])
            if not name:
                continue

            # 1) admin area lookup/create (column L).
            area_name = cell_text(ws, row, COL["admin_area"])
            admin_area = None
            if area_name:
                admin_area = areas.get(area_name)
                if admin_area is None:
                    admin_area = models.AdminArea(
                        organization_id=org.id, name=area_name
                    )
                    db.add(admin_area)
                    db.flush()
                    areas[area_name] = admin_area
                    created_areas.append(area_name)

            # 2) texts + torah-thought extra note (column E non-marker text).
            background = cell_text(ws, row, COL["background"])
            thought = cell_text(ws, row, COL["torah_thought"])
            if thought and not is_bare_marker(thought):
                extra = f"דבר תורה: {thought}"
                background = f"{background}\n{extra}" if background else extra
                stats["thought_extra"] += 1

            # 3) contact + mekurav + checklist.
            contact = models.Contact(
                organization_id=org.id,
                name=name,
                phone=None,
                contact_type="mekurav",
            )
            db.add(contact)
            db.flush()
            db.add(
                models.ContactMekurav(
                    organization_id=org.id,
                    contact_id=contact.id,
                    admin_area_id=admin_area.id if admin_area else None,
                    tzedaka_potential=cell_text(ws, row, COL["tzedaka_potential"]),
                    rebbe_connection=cell_text(ws, row, COL["rebbe_connection"]),
                    recommendations=cell_text(ws, row, COL["recommendations"]),
                    background=background,
                )
            )
            checklist = models.CommunityChecklist(contact_id=contact.id)
            if thought:
                checklist.torah_thought = TORAH_THOUGHT_GIVEN
            for key, (bool_attr, notes_attr) in CHECKLIST_PAIRS.items():
                text = cell_text(ws, row, COL[key])
                if text:
                    setattr(checklist, bool_attr, True)
                    if not is_bare_marker(text):
                        setattr(checklist, notes_attr, text)
                    flag_counts[key] += 1
            db.add(checklist)

            # 4) first visit (column K, parashah name) -> visit_history row.
            visit_text = cell_text(ws, row, COL["first_visit"])
            if visit_text:
                visit_date = PARASHAH_DATES.get(visit_text)
                if visit_date is None:
                    warnings.append(
                        f"row {row}: unknown parashah '{visit_text}' — visit skipped"
                    )
                else:
                    db.add(
                        models.VisitHistory(
                            organization_id=org.id,
                            contact_id=contact.id,
                            visit_date=datetime.datetime.combine(
                                visit_date, datetime.time()
                            ),
                            notes=f"ביקור ראשון — פרשת {visit_text}",
                        )
                    )
                    stats["visits"] += 1

            stats["contacts"] += 1

        print(f"\ncontacts to create: {stats['contacts']}")
        print(f"admin areas to create ({len(created_areas)}): {created_areas}")
        print(f"visit_history rows: {stats['visits']}")
        print(f"checklist flags: {flag_counts}")
        print(f"torah-thought texts appended to background: {stats['thought_extra']}")
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
