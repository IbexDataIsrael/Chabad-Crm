"""One-time data patch: set the "to_knock" apartment custom field (docs/
fixes70_street_v2.md) from each apartment's Jewish-status picklist value —
true when the status affirmatively indicates a Jewish/potentially-Jewish
household, or when no status is set at all; false for an explicit
"not_jewish"/"gentile"/"na" status.

Judgment call, flagged for review: org 1's real picklist_values has
"not_jewish" labeled "לא יהודי", which literally contains the substring
"יהודי" ("Jewish") too — a naive label-substring match would wrongly mark
it true. NO_KNOCK_VALUES is therefore a technical-*value* exclusion list,
not a label substring check. Everything else whose label affirmatively
starts with "יהודי" (jewish, jewish_interested, jewish_gentile,
jewish_interested_gentile, jewish_shtumtz) maps to true, matching the
"should an activist knock here" intent of the flag.

Direct bulk read/write against custom_field_values (not
custom_field_utils.set_value's one-row-at-a-time upsert) — this is a
one-time backfill across ~26k rows, not an admin edit that needs its own
history entry (same reasoning as rename_townhouse_apartments.py). Dry-run
by default.

Run inside the backend container:
    python -m scripts.backfill_to_knock --org-id 1 [--commit]
"""
import argparse
import sys

from app import models
from app.database import SessionLocal

FIELD_KEY = "to_knock"
JEWISH_STATUS_KEY = "apartment.Jewish_status"
NO_KNOCK_VALUES = {"not_jewish", "gentile", "na"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--org-id", type=int, required=True, help="organization to patch")
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        org = db.get(models.Organization, args.org_id)
        if org is None:
            print(f"ERROR: no organization with id {args.org_id}")
            return 1

        definition = (
            db.query(models.CustomFieldDefinition)
            .filter(
                models.CustomFieldDefinition.organization_id == org.id,
                models.CustomFieldDefinition.entity_type == "apartment",
                models.CustomFieldDefinition.field_key == FIELD_KEY,
            )
            .first()
        )
        if definition is None:
            print(f"ERROR: no '{FIELD_KEY}' custom field definition for org {org.id}")
            return 1

        apartment_ids = [
            row[0]
            for row in db.query(models.Apartment.id)
            .filter(
                models.Apartment.organization_id == org.id,
                models.Apartment.is_display.is_(True),
            )
            .all()
        ]
        print(f"org {org.id} — {org.name}: {len(apartment_ids)} active apartment(s)")
        if not apartment_ids:
            return 0

        # One query for every apartment's jewish_status (picklist_links) —
        # avoids a per-row lookup across tens of thousands of apartments.
        status_by_apt: dict[int, str] = dict(
            db.query(
                models.PicklistLink.entity_id,
                models.PicklistValue.value,
            )
            .join(
                models.PicklistDefinition,
                models.PicklistDefinition.id == models.PicklistLink.picklist_definition_id,
            )
            .join(
                models.PicklistValue,
                models.PicklistValue.id == models.PicklistLink.picklist_value_id,
            )
            .filter(
                models.PicklistLink.entity_table == "apartments",
                models.PicklistLink.entity_id.in_(apartment_ids),
                models.PicklistDefinition.system_name == JEWISH_STATUS_KEY,
            )
            .all()
        )

        # One query for any existing to_knock rows, so we update rather than
        # duplicate (uq_customval_entity_def would reject a duplicate anyway).
        existing_by_apt: dict[int, models.CustomFieldValue] = {
            row.entity_id: row
            for row in db.query(models.CustomFieldValue).filter(
                models.CustomFieldValue.entity_table == "apartments",
                models.CustomFieldValue.entity_id.in_(apartment_ids),
                models.CustomFieldValue.definition_id == definition.id,
            )
        }

        target_true = target_false = created = updated = unchanged = 0

        for apt_id in apartment_ids:
            status = status_by_apt.get(apt_id)
            target = status is None or status not in NO_KNOCK_VALUES
            if target:
                target_true += 1
            else:
                target_false += 1

            existing = existing_by_apt.get(apt_id)
            if existing is not None:
                if existing.checked == target:
                    unchanged += 1
                else:
                    existing.checked = target
                    updated += 1
            else:
                db.add(
                    models.CustomFieldValue(
                        organization_id=org.id,
                        entity_table="apartments",
                        entity_id=apt_id,
                        definition_id=definition.id,
                        checked=target,
                        value=None,
                    )
                )
                created += 1

        print(f"  target to_knock=true:  {target_true}")
        print(f"  target to_knock=false: {target_false}")
        print(f"  writes: {created} new, {updated} updated, {unchanged} already correct")

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
