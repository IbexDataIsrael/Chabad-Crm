"""One-time enrichment: geocode buildings that have an address but no
latitude/longitude, by concatenating whatever locality text is needed to make
the address unambiguous, then calling the existing `geocode_address()` helper
(the same Google Geocoding API call the app already makes for contacts).

Two ways to pick the suffix:
- `_SUFFIXES`: hand-curated per-building-id overrides, for a small, reviewed
  batch (the original use of this script — fixes59's 12-building local run).
- `--default-suffix`: applied to every remaining bare address (no comma in
  the stored value — i.e. no city/locality already present) that isn't in
  `_SUFFIXES`. Meant for a large, uniform batch once a spot-check has
  confirmed every address in it really is missing the same thing (e.g. an
  entire org's addresses are bare Brooklyn streets).

Only ever touches buildings with `latitude IS NULL` — an already-geocoded
building is left untouched, so a re-run after a partial failure just picks
up where it left off. Dry-run by default; prints one row per building
(address used, resulting lat/lng or failure) whether or not `--commit` is
passed, so the report is the same either way. Commits incrementally every
`--batch-size` rows (default 50) instead of one giant transaction, so a
large run's progress survives a mid-run connection hiccup — re-running with
the same flags after an interruption resumes from whatever is still NULL.
One retry (after a short pause) on a failed geocode, since a single bad
response is more likely a transient network blip than a genuinely
ungeocodable address at this volume.

Run inside the backend container:
    python -m scripts.geocode_missing_buildings --org-id 1 [--commit]
    python -m scripts.geocode_missing_buildings --org-id 1 \
        --default-suffix ", Brooklyn, NY" [--commit]
"""
import argparse
import sys
import time

from app import models
from app.core.geocode import geocode_address
from app.database import SessionLocal

# (building_id, suffix to append to the stored address before geocoding —
# "" when the stored address is already unambiguous on its own). Chosen by
# hand after reviewing each address: bare Brooklyn street addresses get
# ", Brooklyn, NY"; an address that already names a city needs only its
# country/state to disambiguate; a full Tel Aviv address geocodes fine as-is.
_SUFFIXES: dict[int, str] = {
    14: "",  # "הרצל 12, תל אביב" — city already present
    15: "",  # duplicate of 14
    16: ", NY",  # "770 Eastern Pkwy, Brooklyn" — borough present, state isn't
    43: ", Brooklyn, NY",
    44: ", Brooklyn, NY",
    45: ", Brooklyn, NY",
    46: ", Brooklyn, NY",
    47: ", Brooklyn, NY",
    48: ", Brooklyn, NY",
    49: ", Brooklyn, NY",
    50: ", Brooklyn, NY",
    51: ", Brooklyn, NY",
}


def _suffix_for(building, default_suffix: str | None) -> str | None:
    """None means "skip this building" — only reachable when neither a
    curated override nor a default-suffix run covers it."""
    if building.id in _SUFFIXES:
        return _SUFFIXES[building.id]
    if default_suffix is not None and "," not in (building.building_address or ""):
        return default_suffix
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--org-id", type=int, required=True)
    ap.add_argument(
        "--default-suffix",
        default=None,
        help="applied to every remaining bare (comma-free) address not in _SUFFIXES",
    )
    ap.add_argument("--batch-size", type=int, default=50, help="commit every N rows")
    ap.add_argument("--limit", type=int, default=None, help="process at most N buildings")
    ap.add_argument("--commit", action="store_true", help="persist (default: dry-run)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        query = db.query(models.Building).filter(
            models.Building.organization_id == args.org_id,
            models.Building.latitude.is_(None),
        )
        if args.default_suffix is None:
            query = query.filter(models.Building.id.in_(_SUFFIXES.keys()))
        query = query.order_by(models.Building.id)
        if args.limit:
            query = query.limit(args.limit)
        buildings = query.all()
        if not buildings:
            print("No matching buildings still need geocoding.")
            return 0
        print(f"{len(buildings)} building(s) to process.\n")

        ok = 0
        failed = 0
        skipped = 0
        since_commit = 0
        for i, b in enumerate(buildings, 1):
            suffix = _suffix_for(b, args.default_suffix)
            if suffix is None:
                skipped += 1
                continue
            full_query = f"{b.building_address}{suffix}"
            coords = geocode_address(full_query)
            if coords is None:
                time.sleep(1.0)
                coords = geocode_address(full_query)  # one retry
            if coords:
                ok += 1
                status = f"{coords[0]:.6f}, {coords[1]:.6f}"
                if args.commit:
                    b.latitude, b.longitude = coords
                    since_commit += 1
            else:
                failed += 1
                status = "FAILED"
            print(f"[{i}/{len(buildings)}] building {b.id}: {full_query!r} -> {status}")

            if args.commit and since_commit >= args.batch_size:
                db.commit()
                since_commit = 0
            time.sleep(0.2)  # stay well under the Geocoding API's QPS limits

        if args.commit and since_commit:
            db.commit()

        print(
            f"\n{'COMMIT' if args.commit else 'DRY-RUN'}: "
            f"{ok} geocoded, {failed} failed, {skipped} skipped (no rule matched), "
            f"out of {len(buildings)}."
        )
        if not args.commit:
            db.rollback()
            print("Dry-run only — nothing was written. Re-run with --commit.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
