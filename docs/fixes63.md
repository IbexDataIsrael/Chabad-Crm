# Migration & Update: Building Type

**Status (2026-09-17): done locally, not deployed/pushed.** Backend only — no
frontend UI changes were needed (the existing "בית פרטי" checkbox still
drives creation; `building_type_id` is derived from it server-side).

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