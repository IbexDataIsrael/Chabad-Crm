# Plan: fixes48 (docs/fixes48.md)

Research notes + concrete plan for the 4 spec sections. Written before code per
the spec's own "make plan.md before code" instruction.

## 1. Custom Fields & Picklists — deletion guard + cascade purge

**Current state (read from code, not the spec):**
- Every definition (custom field / picklist option / picklist list) already has
  a *soft* delete ("מחק" → `is_active=false`, reversible, no data loss — left
  untouched by this round) and a separate *hard* delete ("מחק לצמיתות", only
  reachable once soft-deleted).
- `custom_fields.py::delete_definition(hard=true)` just does `db.delete(row)` —
  it does **not** purge `CustomFieldValue` rows for that definition, and for a
  `field_type=="select"` definition it doesn't touch the auto-provisioned
  `PicklistDefinition`/`PicklistValue`/`PicklistLink` rows at all. Real orphan
  bug.
- `picklists.py::delete_option(hard=true)` already checks usage
  (`picklist_utils.count_usage`) but **blocks** with a 409 instead of asking —
  frontend catches the 409 and silently falls back to soft-delete. No cascade
  purge ever happens.
- `picklists.py::delete_definition` (whole list) already cascades
  (PicklistLink → PicklistValue → PicklistDefinition) unconditionally, no
  dependent-data check/confirmation at all today.

**Plan — scope this to the *hard* delete path only** (soft delete/deactivate
stays a no-confirmation, reversible action; it never loses data, so it's out
of scope for a "dependent data" warning).

Backend:
- `GET /api/custom-fields/{def_id}/usage` → `{count}`. For `field_type=="select"`,
  count `PicklistLink` rows for the derived `system_name`; otherwise count
  `CustomFieldValue` rows for `definition_id`.
- `GET /api/picklists/{picklist_id}/usage` → `{count}` (thin wrapper over the
  existing `count_usage`).
- `GET /api/picklists/definition/{def_id}/usage` → `{count}` (sum of usage
  across every value under the definition).
- `custom_fields.py::delete_definition(hard=true)`: purge before deleting —
  `CustomFieldValue` rows by `definition_id` (new `custom_field_utils.
  delete_values_by_definition`), or for select-type the associated
  PicklistLink+PicklistValue+PicklistDefinition rows (reuse the same cascade
  `picklists.py::delete_definition` does). Then delete the row. No more silent
  orphaning.
- `picklists.py::delete_option(hard=true)`: replace the 409-block with a
  purge — delete `PicklistLink` rows pointing at this value, then the value
  row. Drop the now-unused "in use" `HTTPException` path.
- `picklists.py::delete_definition`: unchanged (already cascades); the
  frontend gates the confirmation message on the new usage endpoint.

Frontend (`dashboard/custom-fields`, `dashboard/picklists`):
- Before calling hard-delete, GET the usage count.
  - count > 0 → confirm with the new Hebrew string
    `יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?` (detail: the count).
  - count == 0 → keep today's existing lightweight confirm text (no data at
    risk).
  - Confirmed → call the hard-delete endpoint (now purges for real).
- Applies to: `DefRow`/`CustomFieldRow` hard-delete (custom-fields page +
  picklists page's non-select section), `OptionRow` hard-delete, and
  `DefinitionEditor`'s list-delete.

Localization (seed.py `LOCALIZATION`, RULE: every Hebrew string needs a row):
- `cf.dependent_data_confirm` — "יש נתונים הקשורים לשדה זה האם למחוק בכל זאת?"
  / "This field has related data — delete it anyway?"

Tests: `backend/tests/test_fixes48.py` — usage endpoints report correctly;
hard-delete purges CustomFieldValue / PicklistLink+PicklistValue+
PicklistDefinition / PicklistLink as appropriate; soft-delete path unchanged.

---

## 2. Contacts Module

**Inline edit — Admin Area & Buildings:**
- Gap: `ContactOut` (used by both list endpoints) only exposes
  `admin_area_name`/`building_name` (display strings), not the raw
  `admin_area_id`/`apartment_id` an inline editor needs as its current value.
  `ContactDetailOut`'s nested `mekurav` object has them, but the grid uses
  `ContactOut` rows, not full detail fetches.
- Add `admin_area_id`/`apartment_id: Optional[int]` to `ContactOut`; factor the
  existing building/area/admin-area name enrichment in `_list_item` into a
  shared `_apply_mekurav_geo()` helper and call it from both `_list_item` and
  `_build_detail` (so a PATCH response — merged straight into the grid row —
  carries fresh names too, not just the raw ids).
- Frontend: mirror `ContactView.tsx`'s existing, already-proven patterns
  exactly (no new interaction model):
  - `admin_area`: `InlineEdit` with `commitOnBlur={false}` + a plain
    `<select>` over the already-loaded `adminAreas` state, `commit()` on
    change.
  - `building`: `InlineEdit` (default blur-commit) wrapping the existing
    `ApartmentPicker` component (`value`=`apartment_id`), saving
    `{ mekurav: { apartment_id: v } }`.
  - Both gated the same as today's column availability (`!isShliach`).
  - Add `"admin_area", "building"` to `EDITABLE_COLUMN_KEYS` so the row's
    navigate-on-click is suppressed for these cells like the other inline
    ones.
  - `types.ts`: add `admin_area_id`/`apartment_id` to the `Contact` interface.

**Column reordering — extend drag-and-drop to custom columns:**
- Gap found: `useSortableList` + the "⠿" drag handle + ▲/▼ buttons already
  work, but **only** for the fixed `COLUMN_KEYS`. Custom picklist columns
  (`orgVisibleCustomPicklistDefs`) and custom field columns
  (`orgVisibleCustomFieldDefs`) are rendered as plain, non-draggable toggle
  chips (`data-sortable-disabled`) always pinned after the fixed ones, and the
  table body always appends them in a fixed tail order — there's no ordering
  relationship between a fixed column and a custom one, or between two custom
  columns.
- Plan: introduce one unified ordered key list covering fixed + custom
  picklist + custom field columns (custom keys prefixed, e.g. `pl:<field_key>`
  / `cf:<field_key>`, to keep them unambiguous inside one array). Persist it
  alongside (or replacing) today's `columns` DB preference. The Customize
  Columns panel renders every chip (fixed + custom) inside the **same**
  `useSortableList` container — no more `data-sortable-disabled` split.
  Table header/body iterate this single ordered list once, calling `cell()`for
  a fixed key or the existing `inlineCustomPicklistCell`/`inlineCustomFieldCell`
  for a custom one.
- Same shape change on the Users page (§3) — share the "unified ordered
  columns" approach so both pages behave identically.

**Table cell text overflow:**
- Every data `<td>` currently uses `w-px whitespace-nowrap` (grow-to-fit,
  never wrap) — a long free-text value (notes, address, a custom text field)
  can blow the row out arbitrarily wide. Only the name cell already has
  `max-w-[11rem] truncate`.
- Replace `w-px whitespace-nowrap` with a shared `max-w-[14rem] truncate`
  (ellipsis) on the generic per-column `<td>`s (fixed columns loop, custom
  picklist loop, custom field loop) in both Contacts and Users tables. Leave
  the fixed-width icon/action `<td>`s (call/WhatsApp/email/visit buttons) as
  they are — they're short and not text-driven.

---

## 3. Users Module

**"Clear Assignments" bug — wrong field:**
- Root cause confirmed in `contacts.py::clear_shliach_areas` (endpoint
  `POST /api/contacts/shliach/clear-areas`): it calls
  `set_shliach_areas(db, new, [], ...)`, i.e. it wipes **areas**, never
  touches `report_numbers`. The URL/schema names (`clear-areas`,
  `ShliachClearAreasIn/Result`) match the current (wrong) behavior exactly —
  this was fixes43's original intent inverted from what's now being asked.
- Fix: swap the body to call `set_shliach_report_numbers(db, new, [], ...)`
  and skip-if-empty on `shliach.report_numbers` instead of `.areas`. Rename
  the route/schemas to `clear-report-numbers` /
  `ShliachClearReportNumbersIn/Result` so the code isn't self-contradicting
  (only two callers total: this router + the Users page — grepped repo-wide).
  `area_id` must be left completely untouched.
- Frontend: update the one call site (`clearAssignments()` in
  `dashboard/users/page.tsx`) to the new URL; reword the confirm/success
  strings from "שיבוצים" (assignments/areas) to be explicit about report
  numbers if needed.

**Column header filtering — custom fields & picklists (+ report_numbers):**
- Users page already filters client-side against the full fetched row set
  (`allRows` → `sorted`), unlike Contacts' server-side `/list` filtering — so
  this is pure frontend work, no new backend query params needed.
- `areas` is already effectively filterable via the existing geo filters
  (`areaIds`/`buildingIds` — same field). Gap is:
  - `report_numbers`: no filter today. Add a `MultiSelectFilter` (reusing
    `reportNumbers` state already loaded) filtering rows whose
    `shliach.report_number_ids` intersects the selection.
  - Custom picklist columns (`shliachPicklistDefs`): mirror Contacts'
    `customPicklistFilters` pattern exactly — one `MultiSelectFilter` per
    active def, client-side `Set`-intersection against
    `contact.picklist_values[key]`.
  - Custom fields (`shliachCustomFieldDefs`, non-select): boolean → tri-state
    (any/yes/no) select; text → substring-contains input. Keep it to these two
    widgets — no over-built numeric/date range pickers unless a field of that
    type actually exists in test data.
- All filters persisted the same way as the page's existing filter state
  (`usePersistentState`/`useDbPreference`, matching whichever the analogous
  Contacts filter uses).

**Column reordering:** same unified fixed+custom ordered-list approach as
§2 — Users' `COLUMN_KEYS` (email/phone/notes/areas/report_numbers/created)
plus `shliachPicklistDefs`/`shliachCustomFieldDefs` all become draggable
inside one `useSortableList` container.

**Table cell text overflow:** same `max-w truncate` treatment as §2, applied
to Users' grid `<td>`s.

---

## 4. Single User View (`dashboard/users/[id]`)

**Current state:** the page already shows a flat, read-only history list
(fixes47) — no way to preview a specific historical snapshot or restore a
field, unlike Apartments' `dashboard/apartments/[id]`, which has: pick a
version from a `<select>` → read-only snapshot card → a per-field "שחזר"
(Restore) button next to each row that creates a new active version carrying
just that one field back.

**Backend — new restore endpoint**, mirroring `apartments.py`'s
`POST /{apartment_id}/restore-field` (`ApartmentRestoreField` schema, admin
only, itself a versioned edit):
- `POST /api/users/{user_id}/shliach/restore-field` in `routers/users.py`
  (reuses `_linked_shliach`, `apply_shliach_versioned_update`,
  `set_shliach_areas`, `set_shliach_report_numbers`, `_user_out` — all already
  imported/defined there). New schema `ShliachRestoreField {version_id, field}`.
- Restorable fields: `full_name`, `email`, `phone`, `notes` (plain column
  copy, like apartments' scalar fields) plus `areas`/`report_numbers` (special
  — pull the historical version's linked `ContactShliachArea`/
  `ReportNumberContactShliach` rows and re-apply via the `set_*` helpers,
  mirroring how apartments' restore handles its picklist fields).
- Validates the requested `version_id` belongs to the same lineage
  (`root_id`/`id` match, same query shape `shliach_edit_history` already
  uses) and 404s otherwise.
- Response: `UserOut` (not `ContactDetailOut`) — the page already knows how to
  consume it (`setUser(saved)`, identical to `patchUser`'s contract); unlike
  apartments, `User.id` never changes on a shliach edit, so no redirect is
  needed.

**Frontend (`dashboard/users/[id]/page.tsx`):** replace the flat history list
with the Apartments-style flow:
- `snapshot` state + a `<select>` of `history` versions (same label format:
  editor name — timestamp).
- A read-only snapshot card (full_name/email/phone/notes/areas/report_numbers)
  with a per-field "שחזר" button next to each row (reuse/adapt Apartments'
  `SnapRow` component shape), calling the new restore endpoint and merging the
  returned `UserOut` back into `user` state (+ a success toast).
- Keep the section admin-gated and empty-state exactly like Apartments'
  ("אין גרסאות קודמות").

Tests: extend `backend/tests/test_fixes48.py` with restore-field coverage
(each restorable field, cross-lineage 404, non-admin 403).

---

## Execution order

1. Backend for §1 (usage/purge endpoints) + its tests.
2. Backend for §3's clear-assignments fix + its tests.
3. Backend for §4's restore-field endpoint + its tests.
4. Backend for §2's `ContactOut` admin_area_id/apartment_id enrichment.
5. Frontend §1 (custom-fields + picklists pages).
6. Frontend §2 (Contacts: inline edit, unified column reorder, cell overflow).
7. Frontend §3 (Users: clear-assignments URL, column filters, unified column
   reorder, cell overflow) — steps 6/7 share the reorder mechanism, build it
   once and apply to both pages.
8. Frontend §4 (Users detail page restore UI).
9. `pytest` (Docker, real Postgres) + `tsc --noEmit` + a live-drive smoke pass
   (Playwright/bundled Chromium per the standing rule) on all four areas.
10. Update `docs/fixes48.md` per the spec-closeout rule: each item checked off
    with evidence, or explicitly marked not done.

No commit/push without an explicit ask (standing rule).
