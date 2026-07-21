# Feature Implementation & Bug Fix Tasks (Claude CLI Specification)

## Overview
This document details system enhancements, bug fixes, UI/UX reorganizations, schema refactoring, and localization requirements across multiple modules (Area, Apartments, Picklists, Manage Fields, Settings, and Reports).
make fixes33-plan.md before starting
---

## 1. General Requirements

### 1.1 Internationalization & Localization (i18n)
* **Task:** Extract all user-facing strings and Hebrew UI text into the central localization table / translation files.
* **Requirements:**
  * No hardcoded string literals should remain in UI components or backend API responses.
  * Ensure right-to-left (RTL) support is properly maintained for all newly added Hebrew strings and confirmation modals.

---

## 2. Area Module (`/dashboard/areas` or equivalent)

### 2.1 Enable Area Deletion (Bug Fix)
* **Issue:** Area deletion is currently broken / non-functional.
* **Fix:** Fix deletion handler and API endpoint to safely enable area deletion.

### 2.2 Cascading Deletion Logic & User Confirmation
* **Condition Check:** When a user initiates deletion of an Area, check if there are linked buildings (`buildings.area_id == area.id`).
* **Prompt UI:** If linked buildings exist, present a confirmation modal with the following Hebrew text:
  > **"לאזור זה יש בניינים האם למחוק את הבניינים?"**  
  > *(English translation: "This area has buildings. Do you wish to delete the buildings?")*
* **Behavior Matrix:**
  * **Option A: User selects YES (Delete Buildings)**
    * Perform a cascading delete: Delete all associated **Buildings** AND all **Apartments** assigned to those buildings.
    * Delete the target **Area**.
  * **Option B: User selects NO (Keep Buildings)**
    * Do NOT delete the buildings or their associated apartments.
    * Update all associated buildings: Set `area_id = NULL` (unassign area).
    * Delete the target **Area**.

### 2.3 Schema Refactoring
* **Database Task:** Remove the direct `area_id` field/column from the **Apartment** schema/table.
* **Notes:** Apartments link to Areas strictly through their parent Building (`Apartment -> Building -> Area`). Update any queries, backend models, ORM mappings, or UI components relying on `apartment.area_id`.

---

## 3. Apartments Module (`/dashboard/apartments`)

### 3.1 Custom Picklist Columns in Table Customization
* **Task:** Integrate custom picklist fields into the "Customize Fields / Column Selector" dialog for Apartments.
* **Requirements:**
  * Allow users to select custom picklist fields as visible columns in the main Apartments data table.
  * Dynamically fetch picklist value labels for display in table cells.

### 3.2 Filtered Search Report Generation
* **Task:** Add a button/action to generate export reports based on active search filters.
* **Requirements:**
  * Add "Create Report from Filtered Results" option in the Apartments UI.
  * Ensure the report engine receives current filter criteria, query parameters, or selected record IDs.

---

## 4. Picklists Management (`/dashboard/picklists`)

### 4.1 Tabbed Interface Reorganization
* **Task:** Restructure `/dashboard/picklists` into a 3-tab layout:
  1. **Contacts Picklists**
  2. **Visit Picklists**
  3. **Apartment Picklists**
* **Requirements:**
  * Re-categorize and relocate all existing picklist configurations into their respective domain tab.
  * Update navigation/router state so switching tabs preserves user context.

---

## 5. Manage Fields (`/dashboard/fields`)

### 5.1 Picklist Field Management
* **Task:** Add dynamic picklist fields to the Field Management grid/configuration view.

### 5.2 Field Visibility Logic (`hidden` status)
* When a field is configured as **Hidden** in `/dashboard/fields`, automatically enforce the following across the application:
  1. **CRUD Forms:** Omit the field from Create, Read, Update, and Delete forms/modals.
  2. **Table Filters:** Remove the field from advanced search bar and table filter panels.
  3. **Column Selector:** Hide the field from the "Selected columns to display" customization list.

---

## 6. System Settings (`/dashboard/settings`)

### 6.1 Report Notes Configuration
* **Task:** Add a new configurable text input / text area field under System Settings:
  * **Field Label (Hebrew):** `הערות לדוח` *(Notes for Report)*
  * **Field Name / Key:** `report_notes` (or equivalent setting key)
* **Purpose:** Stores generic disclaimer text, footers, or header notes to be injected into generated PDF/Excel reports.

---

## 7. Reports Engine

### 7.1 Include Report Notes Header
* **Task:** When generating any new report, pull the stored `report_notes` (`הערות לדוח`) value from Settings and insert it at the **beginning (top section)** of the report document.

### 7.2 Multi-Report Formatting (Page Breaks)
* **Task:** When triggering batch report creation containing multiple report numbers/ids:
  * Force each distinct report section / report number to start on a **new page** (page break CSS / document break).
  * Ensure page numbering or header sections reset or adjust cleanly per report.

---

## Checklist for Implementation & Testing

- [x] Add Hebrew translation keys for modal text (`לאזור זה יש בניינים האם למחוק את הבניינים?`) and setting label (`הערות לדוח`). — seeded in `app/seed.py` (`areas.delete_has_buildings_confirm`, `settings.report_notes`, + supporting keys); confirmed present via `seed_localization` re-run and used live in the drive below.
- [x] Test Area deletion with zero buildings (direct delete). — `test_fixes33.py::TestAreaDeleteNoBuildings`, plus live curl/PowerShell against the real local Postgres.
- [x] Test Area deletion with attached buildings (Option A: Cascade delete buildings + apartments). — `test_fixes33.py::TestAreaDeleteWithBuildings::test_mode_cascade_...`, live Postgres API call, **and** a full headless-Chrome click-through of the actual cascade-choice modal (building confirmed gone via API after clicking "מחק בניינים ודירות").
- [x] Test Area deletion with attached buildings (Option B: Nullify `area_id` on buildings, retain apartments). — `test_fixes33.py::TestAreaDeleteWithBuildings::test_mode_unassign_...` + live Postgres API call confirming the building and its apartment both survive with `area_id: null`.
- [x] Run migration to drop `area_id` from `apartments` schema. — **N/A, already done in an earlier round**: verified directly against the real Postgres table (`\d apartments`) that no `area_id` column exists; `Apartment` links to `Area` only via `building_id` → `Building.area_id`. Nothing to migrate this round.
- [x] Verify picklist fields are available in Apartment table column selector. — the dynamic filter/column wiring itself pre-dated this round (fixes32); this round's actual gap was that those columns couldn't be individually hidden. Fixed with a new `apartments.customFields` preference + toggle chips in "התאמת שדות"; verified live (toggle chip appears, hiding/showing works).
- [x] Verify "Create Report" uses current apartment filters. — new "צור דוח מהתוצאות המסוננות" button carries the exact filter-param set into `/dashboard/reports/create?from=apartments-filtered&...`; verified end-to-end via headless drive (button → filters-mode landing → generated PDF).
- [x] Verify `/dashboard/picklists` renders 3 distinct tabs and routes fields correctly. — Contacts/Visit/Apartment tabs, field_key-prefix routed (`apartment.*` / `visit.*`,`checklist.*`,`interaction.*` / everything else); verified live (all 3 tabs render and switch, a custom picklist added from the Apartment tab lands correctly).
- [x] Test hiding a field in `/dashboard/fields` and confirm auto-removal from CRUD, Filters, and Column Pickers. — this round's real gap was **custom picklists** (no field-settings row existed for them at all) and the **Apartments list page** (never consulted field visibility for its filters/columns). Both fixed; verified live: hid a custom apartment picklist from Manage Fields → confirmed absent from the Apartments page's filters, columns and column-selector panel; re-shown → reappears everywhere including as a selectable column-selector chip. Built-in field CRUD-form hiding (Contacts, Apartment add/edit/detail) already worked before this round and was left untouched.
- [x] Verify `report_notes` setting saves and renders at the start of generated reports. — saved via Settings (new textarea) and confirmed rendering directly under the report title in the generated PDF (see drive screenshots/PDF below).
- [x] Test multi-report export and verify page breaks between report numbers. — generated a real 2-report-number PDF: report "דוח א" filled page 1 (with the report-notes header), "דוח ב" cleanly started on page 2 — inspected the actual PDF bytes to confirm.

---

## Closeout (2026-07-22)

All items above are **DONE**. Verified via: full backend pytest (340/340
passing — 327 pre-existing + 13 new in `backend/tests/test_fixes33.py`),
`tsc --noEmit` + `next build` (both clean), and a headless-Chrome drive of
the real local app (registered throwaway orgs, screenshots + a downloaded
PDF inspected byte-for-byte) exercising every item above against the actual
running Postgres-backed dev stack — not just the SQLite pytest DB, which
matters here (see below). Nothing committed or pushed — per standing
project rule, that's the user's call.

### Real bugs found and fixed along the way
- **The actual "area deletion does nothing" root cause**: `contact_shliach_area`
  rows (an area's direct shliach-coverage assignments) have no ORM
  relationship declared on `Area`, so `db.delete(area)`'s cascade never
  touched them — the FK `RESTRICT` on that table fired on *every* delete of
  an area with a direct coverage assignment, buildings or not, and the
  frontend had no try/catch so it silently did nothing. Fixed by explicitly
  clearing those rows before the delete, regardless of the buildings choice.
  **This was invisible to the entire existing pytest suite** — the SQLite
  test engine never gets `PRAGMA foreign_keys=ON`, so FK `RESTRICT` never
  fires there — which is why this had to be verified against the real local
  Postgres dev DB via direct API calls, not just pytest green.
- A second, subtler bug in the fix's first draft: setting
  `building.area_id = None` in Python and then calling `db.delete(area)`
  silently **deleted** the "unassigned" buildings anyway. Cause:
  `SessionLocal` runs `autoflush=False` project-wide (a documented gotcha
  from a prior round), so the pending `area_id = None` UPDATE never reached
  the DB before the delete-cascade's lazy-load of `area.buildings` re-queried
  it — that query still found the buildings under the old `area_id` and
  cascade-deleted them. Fixed with an explicit `db.flush()`. Caught by
  `test_fixes33.py`, not by inspection.
- `buildings.area_id` becoming nullable (required for Option B) surfaced two
  latent NULL-handling bugs: `BuildingOut.area_id` was a non-optional `int`
  in the Pydantic schema (would 500 on any unassigned building), and
  `GET /api/areas/{id}/eligible-buildings` filtered with
  `Building.area_id != area.id`, which in SQL's three-valued logic silently
  *excludes* NULLs (`NULL != x` is `NULL`, not `TRUE`) — an unassigned
  building would never be offered back to any area. Both fixed.
- The buildings list's `sort=area` used an inner `join(Area, ...)`, which
  would have silently dropped unassigned buildings from that page's results
  even though the reported `total` still counted them. Changed to an
  `outerjoin`.
- "Create report from filtered results" with **zero active filters** (i.e.
  viewing the unfiltered apartments list) produced an empty query string
  indistinguishable from a plain visit to `/dashboard/reports/create` — the
  page silently fell back to the wrong (classic report-number) mode instead
  of the filtered-apartments mode. Fixed with an explicit `from=` marker
  param, independent of whether any actual filter values are present.

### Scope note on §1 (general i18n)
Every new/changed string introduced this round has a `field_localization`
seed row (Hebrew + English) — verified by cross-checking every new `t(...)`
key against `app/seed.py`. A full audit of the *pre-existing* codebase for
stray hardcoded strings was out of scope for this round (the spec's §1 is a
standing requirement, not a specific defect list, and re-auditing the whole
app is a separate, much larger effort).