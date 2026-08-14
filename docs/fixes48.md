# CRM Requirements & Feature Specification
make plan.md before code
## 1. Custom Fields & Picklists (`dashboard/custom-fields`, `dashboard/picklists`)
- **Deletion Guard & Cascade Warning:**
  - When a user attempts to delete a custom field or picklist option, check if dependent data exists in relevant tables.
  - If associated data exists, trigger a confirmation modal with the prompt:
    > "יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?"
  - **Confirmation Action:** If the user confirms deletion, remove the custom field/picklist definition and purge all associated data/value entries from connected tables.
- **Localization:**
  - Add theHebrew warning text (`יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?`) and its English equivalent to the i18n/localization files.

---

## 2. Contacts Module (`dashboard/contacts`)
- **Quick / Inline Edit:**
  - Add fast inline editing support directly from the table/view for the **"Admin Area"** and **"Buildings"** fields.
- **Column Reordering:**
  - Implement drag-and-drop handles in the **"Customize Columns"** menu/modal to allow all custom column sequence ordering.
- **Table Cell Text Flow:**
  - Apply CSS overflow wrapping rules (`text-overflow: ellipsis`, `word-break: break-word`, or constrained maximum widths) to all grid columns to prevent excessively wide table cells.

---

## 3. Users Module (`dashboard/users`)
- **Action Fix - "Clear Assignments":**
  - Update the "Clear Assignments" action to **only** wipe/reset the report numbers assigned to `contact_shliach`. 
  - Do **NOT** clear or reset the assigned `area` value.
- **Filtering Capabilities:**
  - Add column header filtering across all standart or dynamic custom fields and picklists
- **Column Reordering:**
  - Implement drag-and-drop handles in the **"Customize Columns"** feature to allow reordering all user grid columns.

---

## 4. Single User View (`dashboard/users/[id]`)
- **Edit History & Reversion:**
  - Align the history drawer/view behavior with the **Apartments** module.
  - Allow users to review prior edit history states and click to revert/restore previous field values.

---

## Status (see `plan.md` for the full design/research notes)

All 4 sections DONE, live-drive verified, UNCOMMITTED (no commit/push without
an explicit ask). 450 backend tests passing (436 pre-existing + 14 new in
`backend/tests/test_fixes48.py`), `tsc --noEmit` clean.

### 1. Custom Fields & Picklists — deletion guard [x]
Scoped to the *hard* delete action only (soft delete/deactivate was already
reversible and non-destructive, out of scope). New `GET .../usage` endpoints
(`custom-fields/{id}/usage`, `picklists/{id}/usage`,
`picklists/definition/{id}/usage`) report dependent-record counts; the
frontend checks usage before hard-deleting and shows the new Hebrew warning
(`יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?`, localization key
`cf.dependent_data_confirm`, English row seeded alongside) only when
something would actually be purged. Confirming now genuinely purges:
- A hard-deleted select-type custom field cascades its auto-provisioned
  `PicklistDefinition`/`PicklistValue`/`PicklistLink` rows (previously left
  fully orphaned — a real pre-existing bug).
- A hard-deleted non-select custom field purges its `CustomFieldValue` rows
  (previously left orphaned).
- A hard-deleted picklist value now purges the `PicklistLink` rows pointing
  at it instead of 409-blocking and silently falling back to soft-delete
  (the old behavior — `test_hard_delete_in_use_purges_dependent_links` in
  `backend/tests/test_picklists.py` updated to match).

Live-drive evidence: created a text custom field, attached a value to a
contact, hard-deleted it — the dependent-data confirm text appeared, and the
field was gone after confirming.

### 2. Contacts Module [x]
- **Inline edit (Admin Area / Buildings):** `ContactOut` now exposes the raw
  `admin_area_id`/`apartment_id` (previously only the display-name strings —
  not enough to drive an editor's current value). The grid reuses
  `ContactView.tsx`'s exact, already-proven editor patterns (native `<select>`
  for admin area, `ApartmentPicker` for building). Live-drive: clicking the
  admin-area cell produces an inline `<select>`.
- **Column reordering:** found the drag-and-drop handle only ever covered the
  fixed columns — admin-added custom picklist/field columns were pinned in a
  fixed tail position with no relative order of their own. Unified all three
  into one draggable list (`GridColumn` + a persisted `columnOrder`
  permutation), reusing the existing `useSortableList`/▲▼-fallback mechanism
  unchanged.
- **Cell text overflow:** grid `<td>`s used `w-px whitespace-nowrap` (grow to
  fit, never wrap) — replaced with `max-w-[14rem] break-words` on the
  dynamic-column cells. Wrapping instead of `truncate`/ellipsis deliberately:
  `overflow:hidden` would clip several inline editors' floating dropdowns
  (the fixes47 fix depends on them overflowing their own `<td>`).

### 3. Users Module [x]
- **"Clear Assignments" bug — real root cause found:** the endpoint was
  literally named `/shliach/clear-areas` and cleared `area_ids` — it was
  never touching `report_numbers` at all, the exact inverse of what's
  wanted. Renamed to `/shliach/clear-report-numbers`
  (`ShliachClearReportNumbersIn/Result`) and fixed to clear
  `report_numbers`, leaving `area_ids` completely untouched. Old test
  (`TestClearShliachAreas` in `test_fixes43.py`) rewritten as
  `TestClearShliachReportNumbers`; new regression coverage in
  `test_fixes48.py` asserts areas survive. Live-drive: clicked "ניקוי
  שיבוצים" on a shliach with both an area and a report number assigned —
  report number cleared, area intact.
- **Column header filtering:** added for `report_numbers` (new
  `MultiSelectFilter`) and every active `contact_shliach` custom
  picklist/field (`areas` was already filterable via the existing geo
  filters). Boolean fields get a tri-state select, text/number/date get a
  substring filter — all client-side (the page already filters its fully
  fetched row set client-side, so no backend changes were needed here).
- **Column reordering:** same unified mechanism as Contacts §2.
- **Cell text overflow:** same `max-w-[14rem] break-words` treatment.

### 4. Single User View [x]
New `POST /api/users/{user_id}/shliach/restore-field` (mirrors apartments'
`restore-field` exactly — new active version carrying just the restored
field back). Restorable: `full_name`/`email`/`phone`/`notes` (plain column
copy) plus `areas`/`report_numbers` (re-applied via the existing
`set_shliach_areas`/`set_shliach_report_numbers` helpers, reading the
historical version's linked rows). The detail page's flat read-only history
list was replaced with the Apartments-style flow: pick a version → read-only
snapshot card → a "שחזר" button per field. Live-drive: history section
present, version picker populated, 6 restore buttons rendered, restoring a
field showed the success toast.
