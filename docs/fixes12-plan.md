# Fixes 12 — Technical Implementation Plan

Spec: `docs/fixes12.md`. No DB migration; one new backend endpoint
(paginated buildings list); the rest is frontend routing + localization.

## 1. Title regression

* **Root cause:** `TitleManager` applies the computed title only when the
  config/user changes — but the Next.js App Router re-stamps the static
  `metadata.title` ("Jewish Points CRM") on **every client-side navigation**,
  so the computed title survives only until the first route change.
* **Fix:** add `usePathname()` to `TitleManager` and re-apply the title on
  navigation (runs after Next's own title stamp in the same commit).
  Template/fallback seeds and logic from fixes9 already match the spec.

## 2. Apartments — dedicated routes

1. **Index:** default filter becomes **Show All** (drop the fixes8 first-area
   default; lazy per-filter fetching stays).
2. **`/dashboard/apartments/add`** — standalone page wrapping
   `ApartmentEditor` (new optional `initialBuildingId` prop). Accepts
   `?building=<id>` (preselect) and `?return=<path>` (internal-only redirect
   back after save/cancel; default `/dashboard/apartments`).
3. **`/dashboard/apartments/edit/[id]`** — standalone edit page: loads the
   apartment, wraps `ApartmentEditor`, honors `?return=`.
4. **`/dashboard/apartments/[id]`** — becomes a clean read-only reference view:
   the inline edit toggle is replaced by a link to the new edit route.
   (Static `add` and nested `edit/[id]` segments take precedence over `[id]`.)

## 3. Buildings

* **3.1 localization + modal:**
  * `page.show_apartments`, `page.hide_apartments`, `apt.delete_confirm` were
    **never seeded** — English users see Hebrew. Add seed rows (he+en); the
    seeder backfills missing keys + blank English on restart.
  * New reusable `ConfirmModal` component (styled, localized) replaces
    `confirm()` for apartment deletion (buildings page rows, the new edit
    page, the apartment detail page).
* **3.2 detail page:** add a prominent **"Edit building"** button →
  `/dashboard/buildings/edit/[id]`.
* **3.3 pagination:** new `GET /api/buildings/list` returning the standard
  `{items,total,page,page_size}` envelope (20/50/100; `area_id` filter; route
  declared before `/{building_id}`); plain `GET /api/buildings` untouched for
  the many pickers. Buildings page gets the pager + page-size dropdown.
* **3.4 edit page `/dashboard/buildings/edit/[id]`:** the inline
  `BuildingEditor` + `FloorsEditor` move to a dedicated page with an
  associated-apartments section: edit → `/dashboard/apartments/edit/{id}?return=…`,
  add → `/dashboard/apartments/add?building={id}&return=…`, delete via the
  localized modal. The list page's "ערוך" button routes here (inline editor
  removed). Save returns to the buildings list; apartment flows return to the
  edit page via the `return` param (spec allows clean redirects).

## Localization additions (seed, he/en)

`page.show_apartments`, `page.hide_apartments`, `apt.delete_confirm`,
`confirm.title` (אישור פעולה / Confirm action), `action.confirm` (אישור /
Confirm), `page.edit_building_title` (reuse `page.edit_building`),
`page.back_to_building` (← חזרה לבניין / Back to building),
`apt.new_apartment_title` (דירה חדשה / New apartment).

## Tests

* `test_fixes12.py`: buildings `/list` envelope + paging + area filter +
  bad page_size 422. (Everything else is frontend routing.)

## Execution order

1. Backend endpoint + seeds + tests.
2. TitleManager fix.
3. ApartmentEditor prop + new apartment routes + index default.
4. ConfirmModal + buildings list page (pagination, no inline editor) +
   building edit page + detail button.
5. Full suite, tsc, page compiles, commit & push (auto-deploy).
