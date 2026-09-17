# Import Plan: `docs/data2.xlsx` (corrections/additions)

Source spec: `docs/data_import2.md`. Same base logic as `backend/scripts/import_apartment_data.py`
(per `docs/apartment_data_import_plan.md`), reused wholesale, with the two modifications the spec
calls out. Target: org 1 (שליחות בשיפסיידביי), local Docker Postgres only — no prod/Neon writes.

Script: `backend/scripts/import_data2.py`. Sheet «תיקונים» ("corrections"), 844 rows (843 with data),
same column layout A–M as the original import, plus a new **Column N** ("שורה בקובץ הראשי" — row
number in the original file), which is a traceability pointer only and isn't written anywhere.

## What this file actually is

Column C is **"בית מחולק" (divided town house) on all 843/843 rows** — no variation. Every one of the
394 distinct (street, number) addresses in this file **already exists** in org 1's `buildings` table
(all 394 are exact `building_address` string matches — zero fuzzy/normalized-key matches, so no
address-collision risk). Their current `building_type_id` split:

| current building_type_id | count | floors | apartments (is_display) |
|---|---:|---:|---:|
| `town_house` | 326 | 0 | 1 each |
| `building` (default, never explicitly set) | 59 | 0 | 1 each |
| `divided_town_house` (already correct) | 9 | 0 | 2–3 each |

The 59 `building`-typed matches are indistinguishable in shape from the 326 `town_house`-typed ones
(0 floors, exactly 1 apartment) — they just never had `is_town_house` set at creation time (predates
`building_type` / fixes63, or came from an earlier import path), so the fixes63 migration's backfill
(which only touches rows where `is_town_house = TRUE`) skipped them. This file's job is clearly to
correct exactly this: buildings that were entered as a single unit actually have multiple real
apartments (the data adds apartment #1, #2, sometimes #3 per address with real Jewish-status/contact
data), so they should be reclassified as `divided_town_house`.

## Modification 1 — Column C override

Per the spec, `building_type_id` is **not** derived via the original script's
`is_building_type()` substring rule for this file. Every row's building (new or existing) is forced
to `building_type_id = "divided_town_house"`, `is_town_house = True`. Since 100% of rows already read
"בית מחולק", this is effectively unconditional for this file — implemented as a flat override rather
than a conditional branch, since this is a one-off script for this one file (not a shared general-
purpose importer).

## Modification 2 — existing records

Per the spec: **do not create a duplicate building** when one already matches (reusing the original
script's exact-address / normalized-`(number, street)` dedup, unchanged) — but the override in
Modification 1 still applies to the *matched* building, since 0/394 addresses need a new building
created at all; if the override applied only at creation time this file would be a no-op, which can't
be the intent of a dedicated corrections file. Concretely, for a matched existing building:
* If its `building_type_id` isn't already `divided_town_house`, update it in place (and set
  `is_town_house = True`) — never insert a second building row for the same address.
* Every match (whether reclassified or already correct) is counted and the address is logged in the
  run summary — the "note" the spec asks for.

This is safe here specifically because all 385 buildings being reclassified (`town_house` + `building`
→ `divided_town_house`) currently have **0 floors**, so no floor-based UI/data structure is disturbed;
this reasoning does not generalize to a building that actually has floors, and the script does not
touch `building_type_id` on any building found with `floors > 0` at load time (defensive guard, logged
as a warning + left untouched rather than silently reclassified, in case a future re-run of this
script sees a real apartment building).

## Decisions carried over unchanged from `import_apartment_data.py`

* Report number (Col A), area (Col B) lookup/create — identical.
* Floor (Col F) lookup/create when present — identical (a handful of rows here do carry a floor
  label, e.g. `"1 (קומת קרקע)"`; kept even though the building is a divided town house, since the
  source data provided it and floors are just free-text labels, not a hard building-type constraint).
* Jewish status (Col H) / language (Col I) via the same picklists, same prefix-match fallback for
  messy variants, same custom `mezuzah_notes` field (Col M is empty in this file — 0/843 — so this is
  a no-op here, kept only for parity/robustness).
* Apartment identity: Col G (apartment #) is populated on 843/843 rows, so the original's "-th"
  fallback path (blank Col G) never triggers here — kept in the code anyway for parity/robustness.
* **Apartment dedup is in-file only** (same `(building, floor_raw, apt_raw)` key as the original) —
  this script does **not** cross-check against apartments already in the DB for a matched building.
  This matches the original script's own scope (which also never checked pre-existing apartments
  under the 9 buildings it matched from the earlier `data3` import). Concretely: the existing single
  apartment already on each of these 394 buildings is left as-is; this run adds the corrections
  file's apartment(s) (#1, #2, sometimes #3) as new, additional `Apartment` rows alongside it. Not
  deleting/merging the old single apartment is a deliberate choice — that would be a destructive,
  unrequested action on live data — so it's called out in the run summary as an informational count,
  not auto-fixed.

## Execution

1. Dry-run (no `--commit`) against local Docker Postgres, review the summary (buildings
   matched/reclassified, apartments created, warnings) for sanity.
2. If clean, re-run with `--commit`.
3. Spot-check a couple of reclassified buildings (e.g. `Haring St 2125`) in the DB.
4. Append a "Result" section to `docs/data_import2.md` per this repo's spec-closeout convention.
