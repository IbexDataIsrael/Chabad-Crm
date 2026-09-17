# Migration & Update: Building Type

**Status (2026-09-17): done locally, not deployed/pushed.**

- [x] `building_type` table created + seeded (`building` / `town_house` /
  `divided_town_house`) — Alembic migration `b3c4d5e6f7a8`
  (`backend/alembic/versions/b3c4d5e6f7a8_fixes63_building_type.py`), plus
  `seed_building_types()` in `backend/app/seed.py` so a fresh dev DB gets the
  same rows without running migrations.
- [x] `buildings.building_type_id` FK added; existing buildings backfilled by
  the same migration from `is_town_house` + their current apartment set (an
  is_town_house building with exactly one apartment named "...-th" →
  `town_house`; anything else with `is_town_house=true` →
  `divided_town_house`; everything else → `building`).
- [x] "-th" suffix cleaned up: the migration strips it from every version of
  the single apartment on each `town_house`-classified building, and
  `POST /api/buildings` no longer appends it to newly created town houses
  (the type column is now the source of truth instead of a name-string
  heuristic). `backend/app/routers/buildings.py`'s old `_townhouse_flags()`
  string-matching helper was removed; `Building.is_townhouse` is now a plain
  Python property (`building_type_id == "town_house"`) exposed via
  `BuildingOut`/`BuildingListItemOut` on every endpoint (previously only
  `/api/buildings/list` populated it).
- [x] Going forward: adding a second apartment unit to a `town_house`
  building (`POST /api/apartments`) flips it to `divided_town_house`
  (`backend/app/routers/apartments.py` `create_apartment`) — otherwise the
  new column would go stale exactly the way the old string heuristic did.
- Tests: updated `backend/tests/test_fixes19.py`'s `TestTownHouse` for the
  new no-suffix behavior, added `backend/tests/test_fixes63.py` covering the
  building/town_house/divided_town_house classification and the split
  transition. Full backend suite: **528 passed, 0 failed** (started
  Docker + `docker-compose.local-db.yml`'s `local_postgres`, re-ran — the
  earlier session's 5 `test_models.py` failures were purely because Docker
  wasn't running yet — that file talks to the real `app.database.engine`
  instead of the isolated SQLite the rest of the suite uses). Frontend
  `tsc --noEmit` clean.
- Migration `b3c4d5e6f7a8` verified end-to-end against real local Postgres
  (the ~25k-apartment import dataset, not just SQLite/pytest): backfilled
  844 `building` / 7796 `town_house` / 147 `divided_town_house`, and
  confirmed zero remaining "-th" suffixes anywhere afterward.

## Follow-up: display + filter on the buildings page

User request: "the building type should be displayed on buildings page +
filter for building type."

- [x] `GET /api/buildings/types` (new, read-only, any authenticated user) —
  the 3-row `building_type` registry in a fixed display order (`building` →
  `town_house` → `divided_town_house`; the table has no `sort_order`
  column, matching the spec'd schema exactly).
- [x] `GET /api/buildings/list` gained `building_type_ids` (repeated
  params, same pattern as `area_ids`) — filters the page server-side.
- [x] `/dashboard/buildings`: a `MultiSelectFilter` next to the area filter
  ("סנן לפי סוג בניין:"), persisted like the other filters
  (`crm.buildings.buildingTypeIds`); each row now shows a badge with the
  building's type name (בניין / בית פרטי / בית מחולק) picked in the
  current UI language from the registry's `name_he`/`name_en` (mirrors
  `lib/picklists.ts`'s `displayPicklistValue`) — added because the type
  badge is the only way to tell a `divided_town_house` apart from a plain
  `building` in the list (the small-house icon only marks `town_house`).
- [x] `backend/tests/conftest.py`'s `_setup_db` fixture now also seeds
  `building_type` (only `roles` was seeded before) — SQLite doesn't enforce
  the FK so building creation "worked" anyway pre-fix, but
  `GET /api/buildings/types` legitimately needs the rows to exist.
- [x] Added `TestBuildingTypeRegistryAndFilter` to `test_fixes63.py` (types
  order/labels, filter-by-one-type, filter-by-two-types). Full suite: 530
  passed. `tsc --noEmit` clean.
- [x] Live-verified in a real browser (Playwright against a throwaway local
  org, backend on :8001 / frontend on :3001 pointed at `crm_local_postgres`):
  created a plain building + a town house, confirmed both badges render,
  the dropdown lists all 3 Hebrew labels, and filtering by "בית פרטי" shows
  only the town house — screenshots taken, throwaway org deleted via the
  superadmin API afterward.

**Not done / accepted limitations:**
- No manual admin UI to reclassify a building's type after creation (e.g.
  un-diving a `divided_town_house` back to `town_house`, or converting a
  regular building into one) — out of scope; the type is fully derived from
  existing signals.
- Reassigning an existing apartment's `building_id` onto a `town_house`
  building via `PUT /api/apartments/{id}` (rather than creating a new one)
  does not trigger the divided-transition — narrow edge case, not wired up.
- ~~Migration backfill not verified against real Postgres~~ — resolved:
  started Docker + `local_postgres`, ran `alembic upgrade head` against the
  real local DB (the ~25k-apartment import), confirmed the backfill counts
  and suffix cleanup above, then reran the full suite against it (528
  passed). Not yet run against Neon prod — do that at deploy time.

---

This task adds a new `building_type` table, populates it with default seeds, assigns the appropriate `building_type_id` across existing buildings, and cleans up the `th` suffix on town houses.

---

## 1. Create and Seed `building_type` Table

Execute the following SQL migration script to set up the reference table and seed initial records.

```sql
-- Create reference table
CREATE TABLE IF NOT EXISTS building_type (
    id VARCHAR(50) PRIMARY KEY,
    name_en VARCHAR(100) NOT NULL,
    name_he VARCHAR(100) NOT NULL
);

-- Seed values
INSERT INTO building_type (id, name_en, name_he) VALUES
    ('building', 'Building', 'בניין'),
    ('town_house', 'Town house', 'בית פרטי'),
    ('divided_town_house', 'Divided town house', 'בית מחולק')
ON CONFLICT (id) DO NOTHING;