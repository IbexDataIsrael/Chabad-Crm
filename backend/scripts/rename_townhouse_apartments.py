"""One-time data patch: a plain (undivided) town house building's single
apartment currently carries the building's own address as its
`apartment_name` (e.g. "E 15th St 2169") instead of a generic label — this
sets it to "house" instead, since the address is already shown separately
via the building.

Only `building_type_id == 'town_house'` buildings are touched (a
`divided_town_house` — one that's since been split into multiple units — is
left alone, since its apartments are genuinely distinct units, not "the
whole house"). Only the active version of each apartment (`is_display=True`)
is renamed; historical versions keep whatever they had, same convention as
the language-backfill script. A building whose active-apartment count isn't
exactly 1 is reported and skipped rather than guessed at, since that would
mean the town-house data itself is unexpectedly inconsistent.

Direct bulk UPDATE, not the versioned apply_versioned_update path — this is
a one-time backfill across potentially thousands of rows, not an admin edit
that needs its own history entry (same reasoning as
backfill_apartment_missing_language.py). Dry-run by default.

Run inside the backend container:
    python -m scripts.rename_townhouse_apartments --org-id 1 [--commit]
"""
import argparse
import sys

from app import models
from app.database import SessionLocal

NEW_NAME = "house"


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

        building_ids = [
            row[0]
            for row in db.query(models.Building.id)
            .filter(
                models.Building.organization_id == org.id,
                models.Building.building_type_id == "town_house",
            )
            .all()
        ]

        # One query for every active apartment across all town_house
        # buildings, grouped in Python — avoids a per-building lazy-load
        # query (N+1) across what can be thousands of buildings.
        active_apts = (
            db.query(models.Apartment)
            .filter(
                models.Apartment.building_id.in_(building_ids),
                models.Apartment.is_display.is_(True),
            )
            .all()
            if building_ids
            else []
        )
        by_building: dict[int, list[models.Apartment]] = {}
        for a in active_apts:
            by_building.setdefault(a.building_id, []).append(a)

        renamed = 0
        already = 0
        skipped_bad_count: list[int] = []

        for b_id in building_ids:
            active = by_building.get(b_id, [])
            if len(active) != 1:
                skipped_bad_count.append(b_id)
                continue
            apt = active[0]
            if apt.apartment_name == NEW_NAME:
                already += 1
                continue
            apt.apartment_name = NEW_NAME
            renamed += 1

        print(f"org {org.id} — {org.name}: {len(building_ids)} town_house building(s)")
        print(f"  {renamed} apartment(s) to rename -> \"{NEW_NAME}\"")
        print(f"  {already} apartment(s) already \"{NEW_NAME}\" (skipped)")
        if skipped_bad_count:
            print(
                f"  {len(skipped_bad_count)} building(s) skipped — active apartment "
                f"count != 1, needs a look: building ids {skipped_bad_count[:20]}"
                + (" ..." if len(skipped_bad_count) > 20 else "")
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
