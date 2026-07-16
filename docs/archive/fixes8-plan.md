# Fixes 8 — Technical Implementation Plan

Spec: `docs/fixes8.md` (building floors defaults, apartment sorting, initial-filter +
pagination performance, login deep-linking). No new tables and no DB migration —
everything rides on the existing `floors` / `apartments` schema from fixes7.

## 1. Building floors & apartment sorting (spec §1)

### 1A. Default 8 floors on building creation
* `backend/app/schemas.py` — `BuildingCreate.floors` default changes from `[]` to
  `["1".."8"]` (via `Field(default_factory=…)`). Omitting the key ⇒ 8 floors are
  auto-created by the existing creation hook in `routers/buildings.py`; sending an
  explicit list (including `[]`) overrides.
* `frontend/app/dashboard/buildings/add/page.tsx` — the "מספר קומות" input's state
  defaults to `"8"` so the user sees and can override the baseline before saving.
* No change to `create_building` itself — it already materializes `payload.floors`.

### 1B. Post-creation floor editing
* Already shipped in fixes7: `FloorsEditor` inside the inline `BuildingEditor` on
  `/dashboard/buildings` (add / rename / delete floor, persisted immediately via
  `/api/buildings/{id}/floors*`). **No code change needed** — verified present.

### 1C+1D. Apartment display sorting (server-side, works with pagination)
* `backend/app/routers/apartments.py` — `GET /api/apartments/list` gains
  `sort` (`floor` | `label` | `resident` | `building`, default `floor`) and
  `dir` (`asc` | `desc`, default `asc`).
* Default hierarchy per spec: **floor first, apartment number second** (then
  building id as a stable tiebreaker).
  * Floor key: `LEFT JOIN floors ON floors.building_id = apartments.building_id
    AND floors.name = apartments.floor` ⇒ order by `floors.sort_order`
    (nulls last), falling back to a natural sort of the free-text floor.
  * "Apartment number" (`apartment_name`) uses a cross-DB **natural sort**:
    `(value IS NULL, LENGTH(value), value)` so `2 < 10` (tests run on SQLite,
    prod is PostgreSQL — no regex/casts allowed).
* `frontend/app/dashboard/apartments/page.tsx` — sort dropdown + asc/desc toggle
  wired to the query params; default = floor ascending.

## 2. Initial filtering + pagination (spec §2)

### 2A+2B. Default pre-filter & lazy loading
* Apartments page boot sequence becomes:
  1. fetch `/api/areas` (small); pick `areas[0]` as the active area filter;
  2. fetch `/api/buildings?area_id=<first>` for the building dropdown;
  3. fetch the **first page** of `/api/apartments/list?area_id=<first>&…`.
  * If no areas exist, fall back to the first building (`/api/buildings` first row),
    else unfiltered (empty org — trivially small).
  * Shliach users skip the default filter: their list is already server-scoped to
    the apartments they cover (small by construction) and a default area could hide
    all of them.
* New backend filter: `area_id` on `GET /api/apartments/list` (join `buildings`).
* Changing the area re-fetches the building dropdown **for that area only** and
  page 1 of the list; nothing else is eager-loaded. Search (`q`) keeps operating
  within the active filter.
* `/dashboard/buildings` gets the same treatment: default `filterArea = areas[0]`
  and buildings fetched via `/api/buildings?area_id=…` (server-side) instead of
  loading the org's entire building table and filtering client-side. An explicit
  "הכל" option remains for users who ask for everything.

### 2C. Server-side pagination
* `GET /api/apartments/list` gains `page` (≥1, default 1) and `page_size`
  (**20 | 50 | 100**, default 20; anything else ⇒ 422). Response shape changes from
  a bare array to an envelope:
  `{ "items": [...], "total": <count>, "page": n, "page_size": n }`.
* Enrichment (`_enrich`) now runs on ≤100 rows per request instead of the whole org.
* Callers updated:
  * `frontend/app/dashboard/apartments/page.tsx` — reads `.items`, renders a pager
    (prev/next + "x–y מתוך z") and a page-size dropdown (20/50/100). Filter/search
    changes reset to page 1.
  * `frontend/app/dashboard/apartments/[id]/page.tsx` — currently pulls the whole
    building's enriched list to find one row's linked contact. New `apartment_id`
    filter on `/list` returns exactly that row (shliach scoping preserved), so the
    detail page fetches one enriched row instead of a full building.
* Plain `GET /api/apartments` (inline building panels, editor dropdowns) is
  unchanged — those are already building-scoped.

## 3. Login deep-linking (spec §3)

* `frontend/components/RequireAuth.tsx` — when redirecting an unauthenticated user,
  capture `window.location.pathname + search` and send them to
  `/?redirect=<encoded>` (reading `window.location` inside the effect avoids the
  `useSearchParams` Suspense requirement in the dashboard layout).
* `frontend/app/page.tsx` (login) — resolve the post-login destination from the
  `redirect` query param in three places: the already-authenticated effect, the
  password `signIn` path, and the Google sign-in path.
  * **Open-redirect guard:** the target is honored only if it starts with `/` and
    not `//` (rejects absolute/protocol-relative URLs); otherwise `/dashboard`.
  * Read via `window.location.search` at navigation time (no `useSearchParams`,
    no Suspense restructure of the login page).

## Localization additions (seed, he/en)

Append to `LOCALIZATION` in `backend/app/seed.py` (backfilled on startup re-seed):
`sort.label` (מיון / Sort), `sort.floor` (קומה / Floor), `sort.by_label`
(תווית דירה / Apartment label), `sort.resident` (שם דייר / Resident),
`sort.building` (בניין / Building), `sort.asc` (עולה / Ascending), `sort.desc`
(יורד / Descending), `pager.prev` (הקודם / Previous), `pager.next` (הבא / Next),
`pager.range` (…מתוך… / of), `pager.page_size` (בעמוד / per page),
`filter.all_areas` (כל האזורים / All areas). Frontend uses `t(key, fallback)` so
the UI is correct even before re-seeding.

## Tests (backend/tests/test_fixes8.py, pytest in Docker)

1. **Floors default:** POST `/api/buildings` without `floors` ⇒ floors `1..8`;
   with `floors: []` ⇒ none; with an explicit list ⇒ exactly that list.
2. **Default sort:** apartments on floors `2/10` with labels `2/10` come back
   floor-ascending, numerically (`2` before `10`), labels numeric within a floor.
3. **Sort params:** `sort=label&dir=desc` reverses; bad `sort`/`dir` ⇒ 422.
4. **area_id filter:** two areas, apartments in both ⇒ filtered list only contains
   the requested area's rows; combined with `q`.
5. **Pagination:** 25 apartments, `page_size=20` ⇒ page 1 has 20, page 2 has 5,
   `total == 25`; `page_size=37` ⇒ 422.
6. **apartment_id filter:** returns exactly the one enriched row.
7. **Envelope shape:** `items/total/page/page_size` keys present.

(§3 is client-side routing only — no backend surface to test.)

## Execution order

1. Backend: schemas (`BuildingCreate.floors`, `ApartmentPageOut`) → apartments
   router (filters, sort, pagination) → seed localization rows.
2. Backend tests (`test_fixes8.py`) — run the suite in Docker.
3. Frontend: types (`ApartmentPage` envelope) → apartments page (default filter,
   sort, pager) → apartment detail (`apartment_id` fetch) → buildings pages
   (default area filter, 8-floor default) → RequireAuth + login redirect.
4. Frontend build/lint + manual smoke via the running Docker stack.
