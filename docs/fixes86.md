# fixes86 — clone by whole buildings; drop unrelated areas / report numbers

Requested 2026-10-01.

- [x] The clone form keeps one building-level limit: **apartments**. Remove
      the "buildings" limit.
- [x] An apartments limit X selects **whole buildings**, adding buildings
      until the apartment count reaches X (rounded up, never splitting a building).
- [x] Only the selected buildings, the areas those buildings are in, and the
      report numbers their apartments use are cloned; other areas, buildings
      and report numbers are dropped (rows referencing them follow the existing
      rule: required FK → dropped, nullable → NULL).

## Closeout

- `core/org_clone.py::_whole_building_selection`: newest buildings first,
  counting displayed apartments until ≥ X; clones every version of those
  buildings' apartments (root_id chains intact), their areas and the report
  numbers those apartments use. An apartments cap replaces any buildings cap.
  With no apartments cap, clone behaves as before.
- Clone page: the "בניינים" limit is removed; the apartments field explains the
  whole-building rounding.
- Test `test_clone_apartment_limit_takes_whole_buildings_and_related_only`
  replaces the old "keeps the N most recent apartments" test (that rule is
  gone). test_org_clone → 9 passed. `tsc --noEmit` clean.
- Real local Postgres, org 1, cap 100: 29 whole buildings, 100 displayed
  apartments (103 rows incl. versions), 2 of 220 areas, 10 of 646 report
  numbers, 0 orphans; 5.6s (was ~34s). Probe clone deleted.

Not committed or pushed.
