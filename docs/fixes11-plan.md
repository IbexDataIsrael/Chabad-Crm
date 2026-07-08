# Fixes 11 — Technical Implementation Plan

Spec: `docs/fixes11.md` (shliach display polish, contacts list owner
column/filter/sort, buildings dashboard refinements). No DB migration.

## 1. Shliach display

### 1.1 Header suffix
* `dashboard/layout.tsx` — when the logged-in user is a shliach, the header
  brand renders `"{orgName} {t("header.shliach_display_suffix")}"`.
* New seed key `header.shliach_display_suffix` (תצוגת פעילים / Activists view)
  — like every seeded key it is editable on `/dashboard/localization`.

### 1.2 Contact form: buildings hidden, apartments scoped
* **Backend:** plain `GET /api/apartments` is currently unscoped for shliach
  users (only `/list` was scoped) — scope it to their covered apartments via
  the local `_shliach_apartment_ids` helper (also closes a §fixes10-style read
  hole).
* **Frontend `ApartmentPicker`:** for shliach users, skip the buildings fetch
  and hide the building dropdown entirely; load `/api/apartments` (now
  server-scoped) into a single flat apartment select. Inline
  "add apartment" needs a building — hidden for shliach.
* The shliach-type form section (BuildingMultiSelect etc.) is unreachable for
  shliach users since fixes10 (they can only create mekurav) — no change.

## 2. Admin display

### Module A — contacts list (`/dashboard/contacts`)

* **2.1 owner column:** fetch `/api/users` (staff/admin; a shliach's fetch
  403s and the column/filter simply don't render), map
  `assigned_user_id` guid → full name, render an "משויך ל" column.
* **2.2 filter:** assigned-user dropdown — "כל המשתמשים" + one option per org
  user; **defaults to the logged-in user's guid** on first load. Backend
  `/api/contacts/list` already accepts `assigned_user_id` (guid).
* **2.3 sorting:** `/api/contacts/list` gains `sort` (`name` | `created`) +
  `dir` (`asc` | `desc`); the backend default stays `name asc` (no breakage to
  existing callers) while the **page explicitly requests `created desc`** as
  its default presentation, with a sort dropdown + direction toggle.
* Filter/sort changes reset pagination to page 1.
* New localization keys: `filter.by_assigned`, `filter.all_users`,
  `sort.created`, `sort.by_name`.

### Module B — buildings dashboard (`/dashboard/buildings`)

* **2.4 combined coordinates input:** the edit form (and the twin add form)
  drop the separate lat/lng number inputs for one LTR text field in
  **`longitude,latitude`** format (per the spec's example `35.2137,31.7683`).
  Parsing happens on change: two comma-separated floats → numeric lat/lng
  state (anything else → nulls); Google-Places autocompletion refills the
  text. Submission still sends numeric `latitude`/`longitude`.
* **2.5 map overlays:** `BuildingsMap` gains an `areas` prop and draws every
  area's geo-fence polygon (reusing `geoJSONToPath` from `AreasMap`, exported)
  under the building markers, colors from the shared zone palette. The
  buildings page passes its loaded areas.
* **2.6 filter default:** the page boots with **הכל** (all buildings) instead
  of the first area (reverts the fixes8 default for this page only; lazy
  server-side fetch per filter change stays).
* **2.7 geofence warning localization:** **already satisfied** — all three
  strings render via `t()` with seeded keys `geo.outside_area_warning`,
  `geo.check_hint`, `geo.save_anyway` (verified in seed + both forms); they
  are editable on the localization page today. No change needed.

## Tests (`backend/tests/test_fixes11.py`)

1. Plain `GET /api/apartments` as shliach returns only covered apartments;
   admin still sees all.
2. `/api/contacts/list?sort=created&dir=desc` orders by creation (newest
   first); `sort=name` alphabetical; invalid `sort`/`dir` → 422; default
   ordering unchanged (name asc).
3. `assigned_user_id` guid filter on `/list` returns only that user's contacts.

## Execution order

1. Backend: apartments scoping → contacts sort params → seed keys → tests.
2. Frontend: layout suffix → ApartmentPicker → contacts page (column, filter,
   sort) → buildings page (coords input, map areas, default filter).
3. Full suite + tsc + page compiles → commit & push (no migration, no data
   patch — Render/Vercel deploy is the whole prod story).
