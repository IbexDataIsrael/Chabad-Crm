# Feature & Bug Fix Specifications

This document outlines the technical tasks, bug fixes, UI/UX improvements, and new feature implementations across the application modules.
make fixes38-plan.md/g/
---

## 1. Contacts Module

### 1.1 UI & Navigation Enhancements
* **Manager Areas Relocation:** Move the **"Manager Areas"** section/component into the Contacts section.
* **Visible Columns Drag & Drop Fix:** Fix the broken drag-and-drop reordering functionality within the "Visible columns" selector.
* **Filter Toggle Behavior:** When toggling the filter section on/off, exclude the "Visible columns" control panel so it remains independent of the filter state collapse.

---

### 1.2 New Feature: "Summary of Visits" Report
Add a new report under the Contacts area titled **"Summary of Visits"**.

#### Requirements & Features:
1. **Date Range Picker:**
   * Include a date range selector to filter visit records by date.
   * **Default Value:** Current week (Sunday/Monday to Saturday/Sunday based on app locale).
2. **Filtered Metrics & Breakdown:**
   * **Total Visits Count:** Display the total number of visits within the selected date range.
   * **Action Breakdown (per Mivtzoim category):**
     * Item Counts (e.g., total count of Tefillin laid, Mezuzot checked, etc.).
     * List of individual visit items.
     * Clickable Links: Each visit item in the list must link directly to its associated contact page (`/dashboard/contacts/[id]`).
3. **Column Visibility:** Respect hidden columns configuration (do not render columns marked as hidden).
4. **Permissions & Scope Filtering:**
   * **Standard User:** Display visit data strictly for contacts assigned to the logged-in user.
   * **Admin Role:** Provide an option/toggle to view all visits across all contacts system-wide.

---

### 1.3 New Feature: "Visit Summary" Section in Contact Detail Page
Add a dedicated **"Visit Summary"** section to individual contact detail pages.

#### Requirements:
* Functions identically to the **"Summary of Visits"** report, but scoped strictly to the current contact's records.
* Integrate this section into the configurable **"Display Order"** layout settings for contact pages.

---

## 2. Apartments Module

### 2.1 UI & Column Controls Fixes
* **Visible Columns Drag & Drop Fix:** Fix the broken drag-and-drop reordering within the "Visible columns" selector in the Apartments view.
* **Filter Toggle Isolation:** Ensure toggling the filter section leaves out the "Visible columns" panel so it is not affected by filter visibility state.

---

## 3. Manage Fields (`/dashboard/fields`)

### 3.1 Field & Action Visibility Controls
Add granular visibility configuration toggles for Contacts fields:
* **Action Icons Visibility:** Add options to show/hide quick action icons for:
  * Phone call
  * Email
  * WhatsApp
* **System Field Hiding:** Enable toggles to hide standard system fields:
  * First visit (`first_visit`)
  * Created at (`created_at`)

---

## 4. Reports Module

### 4.1 Report Description Relocation
* **Migration:** Move the **"Report Description"** input section from the global/admin configuration page directly to the individual Report page.
* **Persistence:** Ensure the description field syncs and saves properly to the database.

---

### 4.2 Top Toolbar Column Customization Tool
Add a configuration tool section at the top of the Report page providing:

1. **Column Selection:** Ability to choose which columns to include/display.
2. **Custom Column Subheadings / Descriptions:**
   * Option to enter a custom text description for each active column.
   * Render this text as a second line directly below the main column header title.
3. **Column Width Percentage Allocation:**
   * Allow users to specify a target width percentage (`%`) for each selected column.
   * Use these custom percentages when generating or rendering the final report view.

---

### 4.3 Column Width Validation & Hebrew Localization
* **Validation Rule:** Prevent users from setting the sum of all active column widths above 100%.
* **Validation Error Message:**
  * **Hebrew (Primary):** `סך הרוחב של העמודות אינו יכול להיות יותר ממאה אחוז`
  * **English:** "The total width should not be over 100%"

---

### 4.4 Settings Persistence
* Save all user column configurations (selected columns, custom subtext descriptions, and width percentages) in the database per report/user.
* Automatically load these saved settings as defaults when opening the report in future sessions.

---

## Status: DONE (2026-07-31, uncommitted)

Plan: `docs/fixes38-plan.md`. Zero DB schema changes / zero Alembic
migrations in this round — every feature rides existing tables
(`field_settings`, `user_preferences`, `organizations.report_notes`,
`visit_history`).

- [x] **§1.1 Manage Areas relocation** — `admin-areas` nav entry moved from
      the Places group into the Contacts/People group
      (`frontend/app/dashboard/layout.tsx`).
- [x] **§1.1/§2.1 Visible-columns drag & drop fix** — root-caused two
      distinct bugs (not guesswork): Apartments' `moveField` splice math was
      direction-dependent (a rightward drag landed the chip *after* the drop
      target, a leftward drag landed it *before* — same gesture, opposite
      result); Contacts had no drag-and-drop at all, and its `activeColumns`
      iterated the fixed `COLUMN_KEYS` array instead of the ordered `columns`
      preference, so reordering couldn't have rendered even if added. Fixed
      the index math (direction-independent "insert before target" now, both
      pages) and added full native-HTML5 drag-and-drop to Contacts, mirroring
      Apartments' pattern. Live-verified via Playwright `drag_to()` (real
      native drag, not a mouse-move) on both pages: Contacts phone→created
      forward-drag and Apartments resident→area forward-drag both land the
      dragged chip immediately before the target, both directions.
- [x] **§1.1/§2.1 Filter-toggle isolation** — the "Visible columns"/"Visible
      fields" button + panel moved out of the `{filtersOpen && ...}` fragment
      on both pages; live-verified the panel stays open after collapsing
      filters on both Contacts and Apartments.
- [x] **§1.2 "Summary of Visits" report** — new page
      `frontend/app/dashboard/contacts/visit-summary/page.tsx` (nav entry
      under Contacts), new backend endpoint `GET /api/visits/summary`
      (`backend/app/routers/visits.py`): date-range params (component
      defaults to the current week, Sunday-start he / Monday-start en),
      total count + per-Mivtzoim-category breakdown with clickable
      `/dashboard/contacts/{id}` links, respects each category's Manage
      Fields visibility toggle, and scopes to the caller's assigned contacts
      unless `contact_id` is given or the caller is an admin who opted into
      `scope_all`.
- [x] **§1.3 Contact-page "Visit Summary" section** — added to
      `SEGMENT_KEYS` in `frontend/app/dashboard/contacts/[id]/page.tsx`,
      reusing the same `VisitSummary` component scoped by `contactId`; rides
      the existing Display Order drag controls for free.
- [x] **§3.1 Manage Fields: action icons + created_at** — 4 new
      `TOGGLEABLE_FIELDS` entries (`backend/app/field_registry.py`):
      `contacts.action_call`, `contacts.action_whatsapp`,
      `contacts.action_email`, `contacts.created_at`. Wired `vis()` guards
      around the phone/WhatsApp/email icons on both the contacts list and
      contact detail pages; `ContactView.tsx`'s two `created_at` rows changed
      from an always-shown `null` key to the new toggleable key (same pattern
      `contact_mekurav.first_visit` already used).
- [x] **§4.1 Report Description relocation** — removed from
      `app/dashboard/settings/page.tsx`; added (admin-only) to
      `app/dashboard/reports/create/page.tsx` with its own Save button,
      still backed by the same `organizations.report_notes` column via
      `PUT /api/organizations/me`.
- [x] **§4.2 Column customization toolbar** — new toolbar at the top of the
      Reports page: per-column checkbox (include/exclude), subheading text
      input, width-% number input, for all 6 existing report columns (floor,
      apartment number, Jewish status, mezuzah, language, notes). Subheadings
      render as a second header line in the generated PDF (`\n` in the
      autotable head cell); widths convert from % to points of the usable
      page width and replace the old hardcoded `COLUMN_WIDTHS`.
- [x] **§4.3 Width validation** — sum of active columns' widths is computed
      live; over 100% shows the exact bilingual message specified
      (`validation.report_width_over_100` — "סך הרוחב של העמודות אינו יכול
      להיות יותר ממאה אחוז" / "The total width should not be over 100%") and
      disables Generate PDF. Live-verified: pushing all 6 columns to 50%
      each shows the message and disables the button.
- [x] **§4.4 Settings persistence** — no new backend model needed; reuses
      the existing per-user `UserPreference`/`useDbPreference` mechanism
      (same one Contacts/Apartments already use for column selections) under
      key `reports.apartmentColumns`. Live-verified across two separate
      script runs in this session: a value written by one run (curl) was
      loaded as the default in the next (Playwright) — real cross-session
      persistence, not just an in-memory state check.
- [x] Backend: 370/370 pytest passing (362 pre-existing + 8 new, in
      `backend/tests/test_fixes38.py`: visits-summary date filtering,
      category breakdown, standard-user/admin/scope_all/contact_id scoping,
      the 4 new field-registry keys and their show/hide round-trip).
- [x] Frontend: `tsc --noEmit` clean.
- [x] Live verification: full docker-compose stack (Postgres + backend +
      frontend) brought up and driven end-to-end with a real browser
      (Playwright, headless Chromium) — 18/18 checks passed, covering every
      item above against the actual running app, not just unit tests.

**Not done:** not committed/pushed (standing rule: only on explicit ask); not
deployed (Neon/Render are already several fixes rounds behind per project
notes — should ship in the same batch).

### Correction (same day): drag-and-drop still didn't work on a real trackpad

The first pass above fixed a real bug (the direction-dependent splice-index
math) and verified the reorder via Playwright's `drag_to()` — but the user
reported drag-and-drop still did nothing at all on their laptop trackpad,
for both Contacts and Apartments. Root cause: native HTML5 drag-and-drop
(`draggable` / `dragstart` / `dragover` / `drop`) depends on the browser's
own separate "is this really a drag gesture" heuristic layered on top of the
raw pointer input — on many Windows trackpads that heuristic never fires at
all, so `dragstart` never happens and nothing visibly happens, even though
the underlying reorder logic was already correct. My original Playwright
verification used a synthetic `drag_to()` that engaged the native drag path
successfully in headless Chromium, which is why it didn't catch this class
of failure — a real trackpad gesture doesn't reliably do the same.

- [x] Replaced native HTML5 drag-and-drop entirely with a Pointer-Events
      implementation (`frontend/lib/useChipReorder.ts`, shared by both
      `contacts/page.tsx` and `apartments/page.tsx`): `pointerdown` +
      `setPointerCapture`, `pointermove` for live hover feedback (via
      `document.elementFromPoint`), `pointerup` to commit the reorder. This
      only depends on the same low-level pointer events every input device
      (mouse, trackpad, touch) already produces reliably — no native-drag
      heuristic involved.
- [x] Added a movement-distance guard (>4px) so a plain click/tap isn't
      misread as a drag, plus a click-suppression flag so a genuine drag
      doesn't also fire the chip's own show/hide toggle on release.
- [x] `tsc --noEmit` clean.
- [x] Re-verified live against the same running docker-compose stack with an
      instrumented Playwright script driving a real step-by-step manual
      mouse sequence (down → 12 incremental moves with pauses → up, not the
      high-level `drag_to()` helper): confirmed `pointerdown`/`pointermove`
      ×12/`pointerup` all fire and the reorder lands correctly (Apartments:
      resident moved from position 2 to immediately before "area"); separately
      confirmed a plain click with no movement still toggles a column
      on/off normally (4/4 checks) and did not regress any of the original
      18 live checks (re-ran: still 18/18).

### Second correction (same day): still intermittent — added a non-gesture fallback

Even after the Pointer-Events rewrite, the user reported the drag "still only
works sometimes." That's consistent with the underlying problem being at the
OS/trackpad-driver level — whether a given trackpad gesture is ever reported
to the browser as a sustained press-and-move is not something any in-page
code can fully guarantee, regardless of which web API reads it. Rather than
keep chasing driver-level gesture reliability, added a **click-only**
fallback that has no gesture-detection step at all:

- [x] `moveActiveField`/`moveActiveColumn` (adjacent-swap, one call each) plus
      ▲/▼ buttons next to every active chip, on both Contacts and Apartments —
      the exact same one-step arrow-button pattern already proven elsewhere
      in this codebase for the contact page's "Display Order" settings
      (`moveSegment`). A plain click is unambiguous; there is no drag
      heuristic for a browser or OS to get wrong.
- [x] Caught and fixed a real bug in my own first implementation of this via
      live testing, not assumption: the two stacked arrow buttons used a
      Tailwind `-space-y-1` negative margin to sit tightly together, which
      made them visually overlap — `document.elementFromPoint` at the "move
      down" button's own on-screen center resolved to the "move up" button
      instead, silently swallowing the click. Confirmed via a Playwright
      script that compared a real coordinate-based click (failed) against a
      bypassed direct DOM `el.click()` call (succeeded) — proof the button's
      own `onClick` logic was correct all along and the bug was purely a CSS
      overlap. Fixed by dropping the negative margin.
- [x] Re-verified with genuine (non-bypassed) clicks after the CSS fix: both
      pages' arrow buttons correctly reorder (5/5 checks), the disabled state
      at each boundary is correct, plain-click toggle still works (4/4), and
      the full original 18-check suite still passes unchanged (18/18) — all
      on the same running docker-compose stack.