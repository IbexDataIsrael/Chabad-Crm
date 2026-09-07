"""One-time data patch: add a "missing" (חסר) option to every org's
`apartment.language` picklist, then set it on every current apartment that
has no language selected at all.

`seed_default_options_for_empty_lists` only seeds an org's default options
when the whole list is still empty, so existing orgs (which already have
hebrew/english/russian/yiddish) never pick up a value added later to
`seed.PICKLISTS` — this script is the retroactive counterpart for them.
Only display rows (`is_display=True`, i.e. each apartment's current version)
are touched; historical versions keep whatever they had.

Writes `PicklistLink` rows directly in bulk instead of going through
`picklist_utils.set_multi_values` per apartment — that helper re-queries the
definition/value and does a delete+insert on every call, which is fine for a
single edit but far too slow across tens of thousands of rows (see the
"Picklist bulk-import perf gotcha" precedent from the apartment data
import). Dry-run by default.

Run inside the backend container:
    python -m scripts.backfill_apartment_missing_language [--org-id 1] [--commit]
"""
import argparse
import datetime
import sys
from uuid import uuid4

from app import models, picklist_utils
from app.database import SessionLocal

FIELD_KEY = "apartment.language"
VALUE = "missing"
HEBREW_LABEL = "חסר"
ENGLISH_VALUE = "Missing"
BATCH_SIZE = 5000


def ensure_picklist_value(db, org_id: int) -> models.PicklistValue:
    row = (
        db.query(models.PicklistValue)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == FIELD_KEY,
            models.PicklistValue.value == VALUE,
        )
        .first()
    )
    if row is not None:
        if not row.is_active:
            row.is_active = True
        return row
    max_sort = (
        db.query(models.PicklistValue.sort_order)
        .filter(
            models.PicklistValue.organization_id == org_id,
            models.PicklistValue.field_key == FIELD_KEY,
        )
        .order_by(models.PicklistValue.sort_order.desc())
        .first()
    )
    row = models.PicklistValue(
        organization_id=org_id,
        field_key=FIELD_KEY,
        value=VALUE,
        hebrew_label=HEBREW_LABEL,
        english_value=ENGLISH_VALUE,
        sort_order=(max_sort[0] + 1) if max_sort and max_sort[0] is not None else 0,
        is_active=True,
    )
    db.add(row)
    db.flush()
    return row


def ensure_definition(db, org_id: int) -> models.PicklistDefinition:
    definition = (
        db.query(models.PicklistDefinition)
        .filter(
            models.PicklistDefinition.organization_id == org_id,
            models.PicklistDefinition.system_name == FIELD_KEY,
        )
        .first()
    )
    if definition is not None:
        return definition
    hebrew_label, entity_type = picklist_utils.PICKLIST_FIELDS[FIELD_KEY]
    definition = models.PicklistDefinition(
        organization_id=org_id,
        system_name=FIELD_KEY,
        hebrew_display_name=hebrew_label,
        entity_type=entity_type,
        is_system=True,
        allow_multiple=True,
    )
    db.add(definition)
    db.flush()
    return definition


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--org-id", type=int, help="limit to one org (default: all orgs)")
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        orgs_query = db.query(models.Organization)
        if args.org_id is not None:
            orgs_query = orgs_query.filter(models.Organization.id == args.org_id)
        orgs = orgs_query.order_by(models.Organization.id).all()
        if not orgs:
            print("ERROR: no matching organization(s) found")
            return 1

        grand_total = 0
        for org in orgs:
            picklist_value = ensure_picklist_value(db, org.id)
            definition = ensure_definition(db, org.id)

            apartment_ids = [
                row[0]
                for row in db.query(models.Apartment.id)
                .filter(
                    models.Apartment.organization_id == org.id,
                    models.Apartment.is_display.is_(True),
                    models.Apartment.id.notin_(
                        picklist_utils.unassigned_entity_ids("apartments", FIELD_KEY)
                    ),
                )
                .all()
            ]

            now = datetime.datetime.utcnow()
            for start in range(0, len(apartment_ids), BATCH_SIZE):
                chunk = apartment_ids[start : start + BATCH_SIZE]
                db.bulk_insert_mappings(
                    models.PicklistLink,
                    [
                        {
                            "guid": str(uuid4()),
                            "organization_id": org.id,
                            "entity_table": "apartments",
                            "entity_id": apt_id,
                            "picklist_definition_id": definition.id,
                            "picklist_value_id": picklist_value.id,
                            "created_at": now,
                            "updated_at": now,
                        }
                        for apt_id in chunk
                    ],
                )

            print(
                f"org {org.id} — {org.name}: "
                f"{len(apartment_ids)} apartment(s) with no language -> '{VALUE}'"
            )
            grand_total += len(apartment_ids)

        print(
            f"\n{'COMMIT' if args.commit else 'DRY-RUN'}: "
            f"{grand_total} apartment(s) total across {len(orgs)} org(s)."
        )
        if args.commit:
            db.commit()
            print("COMMITTED.")
        else:
            db.rollback()
            print("Dry-run only — nothing was written. Re-run with --commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
