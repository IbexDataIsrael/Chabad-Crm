# Implementation Plan: importdata3 — XLSX Apartment Import

Implements `docs/importdata3.md`. Source: `docs/data3.xlsx`, sheet «גיליון1»,
1087 data rows (rows 2–1088), columns A–J. Importer:
`backend/scripts/import_data3.py` (same pattern as `import_data1.py`: dry-run by
default, `--commit` to persist, run inside the backend container).

## Target

- **Organization 1 — «שליחות בשיפסיידביי»** (the streets — Batchelder St,
  Avenue Z, Avenue Y — are Sheepshead Bay; same org as every previous import).
- Local DB first (`crm_local_dev` via the running backend container). Prod
  (Neon) run is a separate explicit step with the same script.

## Actual file columns

The spec describes A–G and I; the file also carries **H `NAME`** and
**J `PHONE`**. The `apartments` table natively has resident `name` / `phone`
columns, so those map straight onto the apartment row — no separate Contact
records are created (the spec's step list ends at apartment creation and
defines no contact-creation steps).

| Col | Header | → |
|-----|--------|---|
| A | REPORT NUMBER | upsert `report_number` by org+name; FK `report_number_id` |
| B | STREET NAME | building composite key (with C) |
| C | STREET NUMBER | building composite key (with B) |
| D | FLOOR | upsert `floors` per building; `apartments.floor` = floor name |
| E | APARTMENT NO | `apartments.apartment_name` (raw, e.g. "1O") |
| F | JEWISH STATUS | `apartments.jewish_status` (picklist mapping below) |
| G | LANGUAGE | `apartments.language` (picklist mapping below) |
| H | NAME | `apartments.name` (resident, raw) |
| I | COMMENTS | `apartments.apartment_notes` |
| J | PHONE | `apartments.phone` (raw trimmed string) |

Numeric cells (A, C, D can be ints) are normalized to their string form.

## Row pipeline (strictly sequential, spec §2)

1. **Report** — cache key = normalized col A (e.g. `264`, `272 ג`). Look up
   org-scoped `report_number.name`; create if missing. 31 distinct in file;
   org 1's existing `101`/`202` are untouched.
2. **Building** — composite key (street name, street number). Look up by
   org-scoped `building_address == "{number} {street}"` (US convention, e.g.
   `2555 Batchelder St`); create if missing with `building_name=NULL`,
   `is_town_house=False`, and `area_id` = the import area (below). 9 distinct
   buildings in file; none collide with existing org-1 buildings.
3. **Floor** — per-building upsert by name (col D as string). `sort_order` =
   int(name) for numeric floors (`0`–`8`), `-1` for `BSMT` (sorts below
   ground). Empty floor cell (6 rows): no floor row, apartment gets
   `floor=NULL`.
4.–8. **Apartment** — plain insert (`is_display=True`, `root_id=NULL` — a
   fresh versioning lineage): `building_id`, `report_number_id`, `floor`
   (name string), `apartment_name`=E, `jewish_status`=F-mapped,
   `language`=G-mapped, `name`=H, `phone`=J, `apartment_notes`=I (plus
   language-overflow note, below).

## Area (schema requires it; spec doesn't mention it)

`buildings.area_id` is NOT NULL. Org 1's existing areas (`????`, `אזור 1`,
`אזור 2`) don't fit. The import creates **one new area «שיפסיידביי»** (spelled
as in the org name) and puts all 9 buildings in it.

## Picklist mappings

`apartments.jewish_status` / `language` are constrained by per-org
`picklist_values`. Stored values stay technical English; Hebrew is
presentation (CLAUDE.md rule).

**`apartment.Jewish_status`** (col F; 248 empty → NULL):

| File value | Stored value |
|---|---|
| יהודי | `jewish` |
| יהודי מעוניין | `jewish_interested` |
| יהודי וגוי | `jewish_gentile` |
| יהודי מעוניין וגוי | `jewish_interested_gentile` |
| יהודי שתומ"צ | `jewish_shtumtz` |
| גוי | `gentile` — **new option** («גוי» / "Gentile", sort_order 6) |

**`apartment.language`** (col G; 715 empty → NULL). Exact matches:
רוסית→`russian`, אנגלית→`english`, עברית→`hebrew`; the four spelling variants
of Russian+English (`רוסית ואנגלית`, `רוסית אנגלית`, `אנגלית רוסית`,
`אנגלית ורוסית`) → `russian_english` — **new option** («רוסית ואנגלית» /
"Russian & English", sort_order 4). Anything else (parentheticals, multi-way
combos, `רוסית?` …) falls back to substring detection — both
רוסית+אנגלית→`russian_english`, else first of רוסית/אנגלית/עברית/אידיש|יידיש
found, none→NULL — **and the original text is preserved** by appending
`שפה: <original>` to `apartment_notes`, so the messy source value is never
lost.

Both new options are inserted by the importer for the target org only (admins
could equally have added them in the UI; the localization table is untouched —
option labels live in `picklist_values`).

## Safety

- **Dry-run default** — prints per-entity creation counts, per-building floor
  sets, picklist mapping tallies, language fallbacks, and warnings; rolls
  back. `--commit` persists.
- **Re-run guard** — aborts if any of the 9 composite building addresses
  already exists in the org (the import evidently ran); `--force-rerun`
  overrides.
- Report/building/floor caches are seeded from the DB and updated as rows are
  created, so within-run lookups never duplicate.
- No deletes, no updates to existing rows anywhere in the script.

## Verification (after `--commit`)

- SQL counts: +1 area, +9 buildings, ~66 floors, +31 report numbers,
  +1087 apartments (org 1).
- Spot-check `/dashboard/apartments` in the UI: building filter shows the new
  buildings, report-number filter shows e.g. `272 ג`, apartment `2555
  Batchelder St / 1B` shows status «יהודי מעוניין ביהדות», language «רוסית»,
  and the notes text.

## Result — executed 2026-07-20 (local DB `crm_local_dev`, org 1)

- Dry-run then `--commit`: 1087 rows → 1087 apartments, 0 warnings.
- Created: area «שיפסיידביי», 9 buildings, 70 floor rows, 31 report numbers,
  2 picklist options (`gentile`, `russian_english`).
- Tallies (sum-checked against the file's distinct counts): jewish_status
  {jewish_interested 400, gentile 214, jewish 131, jewish_interested_gentile
  47, jewish_gentile 37, jewish_shtumtz 10} + 248 empty = 1087 ✓; language
  {russian 188, english 136, russian_english 44, hebrew 4} + 715 empty =
  1087 ✓; 23 messy language texts preserved in notes; 140 resident names,
  25 phones.
- SQL verification: org-1 apartments 52 → 1139; per-building apartment counts
  match the file's street-number distribution exactly; spot rows (2555
  Batchelder St 1B/1D) carry correct status/language/notes/report FK.
- API verification (minted local admin JWT): `GET /api/apartments/list` → 200,
  total 1115 active; `q=Batchelder` → 748 (= file's Batchelder row count).
- **Prod (Neon) run — 2026-07-20**, user-authorized (URL pasted in-chat): same
  script via `docker exec -e DATABASE_URL=<neon>`, org 1 «חבד שיפסד-ביי».
  Pre-import dump: `backups/neon_backup_pre_data3import_20260720.sql` (PG18
  throwaway-container recipe; the local PG15 client mismatches). Dry-run
  output was identical to local; after commit: org-1 apartments 37 → 1124,
  9 buildings with per-building counts matching the file exactly, report
  numbers 2 → 33. Note: prod org id happens to also be 1, but always confirm
  via the dry-run's printed org name. Data is live in Neon; visibility in the
  app still requires the owner to resume the suspended Render backend.
