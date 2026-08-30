# Task Execution Plan (`plan.md`)
make fixes53-plan.md before coding!
## Objectives & Core Directives

Implement UI updates, data grid feature enhancements, layout fixes, calculated column metrics, activist workflow features, and multi-level sorting algorithms across the Dashboard routes (`/contacts`, `/apartments`, `/reports`, `/report-numbers`, `/areas`, `/users`, `/shliach-config`, `/messages-from-activists`).

---

## Task Breakdown

### 1. Contacts View Updates (`/dashboard/contacts/[id]`)

* **CSS Alternating Borders for Data Fields**
  * Apply explicit CSS borders to every distinct data container/field component on the single contact page.
  * Alternate border colors sequentially using primary theme pink (`var(--site-pink, #D81B60)`) and black (`#000000`).

---

### 2. Apartments View Enhancements (`/dashboard/apartments`)

* **Mobile Header Buttons Fix**
  * Match button heights and layout on mobile screens to mirror `/contacts`.
* **Data Grid Filtering**
  * Support filtering on dynamic text fields.
  * Add support for selecting/filtering **"Empty"** text fields (Excel-style blank selection).
* **Bulk Edit Expansion**
  * Include all available standard and custom dynamic fields inside the Bulk Edit modal/drawer.
  * Exclude `apartment_name` (or title) and `building` fields.
  * If a field is left empty, leave existing database values untouched.
* **Building Grouping Adjustments**
  * Remove `+` / `-` expansion toggles from building aggregation headers.
  * Fix apartment count calculations displayed on building headers.
* **Sticky Column & Header Layout**
  * Enable CSS sticky positioning (`sticky top-0 z-10`) on grid header titles during vertical scroll.
  * Enable CSS sticky positioning on `apartment_name` (first column) during horizontal scroll (RTL/LTR compliant).
* **Dynamic Field Customization Sync**
  * Ensure newly created apartment fields immediately appear in the "Customize Fields" selection menu.
* **Mandatory Grid Hierarchy Sorting**
  * Enforce default multi-level sorting order across all applied filters or aggregations:
    1. `Report Number` (Ascending)
    2. `Building` (Ascending)
    3. `Floor` (Ascending, with `"L"` treated as `0` / first)

---

### 3. Report Numbers & Areas Updates (`/dashboard/report-numbers`, `/dashboard/areas`)

* **Calculated Columns**
  * **Number of Jews** (`מספר יהודים`): Calculated count based on apartment Jewish status matching `Yid`, `Yid and Goy`, `Frum`, `Engaged Yid`, or `Engaged Yid and Goy`.
  * **Number of Engaged Jews** (`מספר יהודים מעוניינים`): Calculated count based on apartment status matching `Engaged Yid` or `Engaged Yid and Goy`.
* **Activist Navigation**
  * Add **"Name of Activist"** (`שם הפעיל`) column linking directly to their contact page (`/dashboard/contacts/[id]`).
* **Grid Controls & Linking**
  * Add "Customize Fields" support matching contacts/apartments grids.
  * Enable column sorting by Activist Name, Number of Jews, and Number of Engaged Jews.
  * On `/dashboard/report-numbers`, add a direct link to `/dashboard/apartments` filtered to show only apartments for the selected report number.

---

### 4. Jewish Status Calculation Rules

| Metric | Matching Status Values | Logic / Display |
| :--- | :--- | :--- |
| **Number of Jews** (`מספר יהודים`) | `Yid`, `Yid and Goy`, `Frum`, `Engaged Yid`, `Engaged Yid and Goy` | Shows `V` if match, else `X`; aggregated as total sum per report/area. |
| **Number of Engaged Jews** (`מספר יהודים מעוניינים`) | `Engaged Yid`, `Engaged Yid and Goy` | Shows `V` if match, else `X`; aggregated as total sum per report/area. |

---

### 5. Buildings & Floor Data Handling

* **Floor Model & Sort Logic**
  * Add support for a "Floor" record per building.
  * Implement custom sort logic for floor values containing `"L"` (Lobby/Level) so `"L"` is treated as numeric `0` and listed first.

---

### 6. Reports Updates (`/dashboard/reports/create`)

* **PDF Layout Adjustment**
  * Add a visible horizontal line (`<hr>` / PDF border rule) directly beneath the main header line on generated PDF reports.

---

### 7. User Routing & Contact Shliach Workflow

* **Shliach Conditional Redirect & Self-Service Edit**
  * If user role is `contact_shliach`, redirect directly to their contact profile page on `/dashboard/users`.
  * Make this edit page the default screen upon initial system entry.
  * Add button **"Edit your data"** (`עריכת המידע שלך`) allowing activists to edit personal profile fields, while blocking edits to `Email`, `Report Numbers`, and `Areas`.
* **Report Completion Action**
  * Add button **"Report completed"** (`דיווח על השלמת הדוח`) opening a modal with 3 choices:
    1. **Report completed** (`דוח הושלם`)
    2. **Report not completed** (`דוח לא הושלם`)
    3. **Report partially completed** (`דוח הושלם חלקית`)
  * Prompt for text input labeled **"Comments"** (`הערות`) upon selection.
* **System Comments Action**
  * Add button **"Comments about the system"** (`הערות על המערכת`).
* **Persistence Layer**
  * Save completion statuses, comments, and system feedback into new dedicated SQL tables.

---

### 8. Activist Configuration (`/dashboard/shliach-config`)

* Add UI toggle controls for admins to lock or unlock field-level editing permissions for activists.

---

### 9. Messages from Activists (`/dashboard/messages-from-activists`)

* Create new dashboard page and sidebar menu item: **"Messages from activists"** (`הודעות מהפעילים`).
* Render submitted completion logs and comments with status badge colors:
  * **Report completed:** Green (`#2e7d32`)
  * **Report not completed:** Red (`#d32f2f`)
  * **Report partially completed:** Orange (`#ed6c02`)

---

### 10. General Natural Alphanumeric Sorting Fix

* **Issue:** Alphanumeric sorting sorts `"10"`, `"11"`, `"12"` before `"2"`.
* **Fix Target:** Apply **Natural Sorting** across Areas, Report Numbers, and Contacts:
  * **Frontend:** Implement `a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })`.
  * **Backend (SQL):** Apply natural ordering using `ORDER BY CAST(...)` or equivalent database-level natural sort functions.

---

## Verification & Testing Steps

1. Verify alternating dark pink and black borders on `/dashboard/contacts/270`.
2. Test responsive header button heights on mobile for `/dashboard/apartments`.
3. Confirm dynamic text field filtering, empty option selection, and sticky headers/columns on `/dashboard/apartments`.
4. Validate calculation logic for "Number of Jews" and "Number of Engaged Jews" on `/dashboard/report-numbers` and `/dashboard/areas`.
5. Test floor sorting logic ensuring `"L"` displays before numeric floors.
6. Verify PDF output on `/dashboard/reports/create` includes visible dividing line under header.
7. Login as `contact_shliach` and confirm direct routing to self-edit form, field restrictions, report completion modal submission, and SQL table persistence.
8. Check `/dashboard/messages-from-activists` displays color-coded status badges (Green, Red, Orange).
9. Confirm natural sort order (`1`, `2`, `3` ... `10`, `11`, `12`) across areas, reports, and contacts grids.

---

## Progress Log

### 2026-08-30 — §2 Building Grouping: apartment count bug (user-flagged)

User explicitly flagged: "the number given on apartment 'group by building' is
wrong." Investigated and fixed both §2 bullets it's tied to. **Nothing else
in this plan (§1, §3–§10) has been started yet** — see each section above,
still pending.

- [x] **§2 "Fix apartment count calculations displayed on building headers"**
  — root cause confirmed by reproduction, not guessed: grouped view
  paginated by *apartment row* (`page_size` = 20/50/100 rows) while the
  header badge came from a separate `/building-aggregates` call that always
  returned each building's **full** filtered count regardless of page. A
  building bigger than one page (e.g. building 48, 288 real apartments —
  confirmed directly against Postgres) got split mid-list, so the header
  said "288" over however few of its rows fit before the page cut off (19,
  on page 1). Fixed in `backend/app/routers/apartments.py`
  (`list_apartments_enriched`, `/api/apartments/list`): when
  `sort="building"`, pagination now operates on the **distinct buildings**
  matching the filters (`page`/`page_size` address buildings, not rows) and
  every apartment for each building on the page is returned together —
  never split across a page boundary. Added `ApartmentPageOut.total_buildings`
  (`backend/app/schemas.py`) so the frontend pager can page through buildings
  correctly; it's `null` unless `sort="building"`. Frontend
  (`frontend/app/dashboard/apartments/page.tsx`) no longer calls
  `/building-aggregates` at all — each header's count is now derived
  directly from the returned rows sharing that `building_id`, the exact
  same array being rendered, so it can never disagree with what's on
  screen. Pager text/last-page math switches to a building basis
  (`pager.range_buildings`, new seeded localization row) while grouped;
  apartment-level `total` (bulk-edit dialog, "create report from filtered
  results") is untouched.
- [x] **§2 "Remove `+`/`-` expansion toggles from building aggregation
  headers"** — a natural consequence of the fix above: since a building's
  full row set now always arrives and renders together, the old per-group
  collapse toggle (added in fixes52) had nothing left to hide. Removed the
  `expandedBuildings` state, the toggle button, and its conditional
  row-rendering gate.

**Not done (this round only touched §2's two building-grouping bullets):**
§1 (contact borders), §2's other bullets (mobile header buttons, dynamic
text-field/"Empty" filtering, bulk-edit field expansion, sticky
column/header, custom-field-sync, mandatory Report-Number→Building→Floor
sort), §3–§10 in full. All still pending.

**Evidence:**
- Reproduced the original bug against the live local Postgres dataset before
  fixing: `select building_id, count(*) from apartments where is_display
  group by building_id` for building 48 = 288, matching the (correct,
  unfiltered) `/building-aggregates` response — but `/api/apartments/list?
  sort=building&page=1&page_size=20` returned only 19 of those 288 rows on
  page 1, i.e. exactly the mismatch being reported.
- After the fix: filtered grouped `/list` (`jewish_status=jewish`) diffed
  against `/building-aggregates` for the same filter across every building
  returned — 0 mismatches. Page 1 vs. page 2 (20 buildings each) share zero
  `building_id`s — a group never splits across a page boundary, ascending or
  descending.
  New backend tests: `backend/tests/test_fixes30.py::TestListGroupedByBuilding`
  (a building's rows are never split across a page, `page_size` counts
  buildings not rows, `total_buildings` stays `null` for non-grouped sorts)
  plus an updated `test_fixes8.py::test_envelope_and_pages` (new
  `total_buildings` envelope key). Full backend suite (re-run clean after
  those additions): **482 passed, 0 failed**.
- `npx tsc --noEmit` clean.
- Live-drive (Playwright, headless Chromium, local Docker+Postgres, real
  admin login against the ~25.8k-apartment org-1 dataset): toggled
  group-by-building, counted every rendered header badge against its actual
  rendered row count — 18/18 groups matched exactly; confirmed 0 remaining
  `+`/`-` toggle buttons; confirmed the pager reads "בניינים 21–40 מתוך
  8291" and clicking "next" advances to a genuinely different set of
  buildings (no overlap with the previous page).
- New localization row `pager.range_buildings` seeded via the existing
  idempotent `seed_localization`, applied automatically on backend restart
  (confirmed via `docker restart` + log inspection).
- `backend/app/routers/apartments.py`'s `/building-aggregates` endpoint
  itself was left in place (still covered by its own passing tests) even
  though the frontend no longer calls it — nothing else in the codebase
  uses it, and removing it was out of scope for this single-bug fix.