# CRM Requirements & Bug Fixes Specification
make plan before code!

Status: DONE 2026-08-13, UNCOMMITTED. 430 backend tests pass; frontend `tsc --noEmit` clean; all 4 items verified live via a headless-Chrome CDP drive against the local Docker stack (results below).

## 1. Users Module (`dashboard/users`)
- [x] **Layout Parity:** Aligned `dashboard/users`'s table CSS to `dashboard/contacts`'s exact pattern — header `bg-gray-50 text-gray-600 text-right`, `px-3 py-1.5 font-medium w-px whitespace-nowrap` cells, trailing full-width filler column so data columns condense to the start.
- [x] **Inline Editing:** `full_name` and `email` are now inline-editable (via `InlineEdit` + `PUT /api/users/{id}`) for every real login row, matching the contacts page's click-to-edit mechanism. `phone` is inline-editable the same way.
  - Root cause found along the way: `User.phone` was already a real, synced column (kept in sync with a linked shliach contact by the existing `PUT /api/users/{id}` handler) but was never exposed on `UserOut` — the page instead re-derived phone by matching contacts by email, which silently broke whenever the area/building filter excluded the matching contact. Fixed by adding `phone` to `UserOut` (`backend/app/schemas.py`) and reading it directly.
- [x] **Handling Unlinked/Missing Data:** For a `kind:"user"` row with no linked contact (`contactId == null` — i.e. admin/staff, or a shliach whose email didn't match a fetched contact), phone shows "-" (unchanged existing fallback) and `InlineEdit`'s `disabled` prop is set so it can't be clicked into.
  - Verified live: `/dashboard/users` renders 8 rows, no runtime errors, inline-editable name cell present (CDP check: `tbody tr td span[role="button"]` found).

## 2. Contacts Module (`dashboard/contacts`)
- [x] **Mobile Responsive Actions Bar:** Added `flex-wrap` to the button-row div (New Contact, bulk edit, bulk email, columns, filters toggle) in `app/dashboard/contacts/page.tsx`.
  - Verified live at a 375px viewport via CDP: `flexWrap: "wrap"`, `scrollWidth === clientWidth` (343 = 343, not overflowing) — previously (no `flex-wrap`) this row would have overflowed horizontally.

## 3. Visit Logging: Mivzoim (`Add Visit`)
- [x] **Mivzoim Selection:** `components/CustomFieldsEditor.tsx` now renders a real `<input type="checkbox">` per item (was a whole-button name-click toggle with no checkbox element at all). Shared by both `VisitForm` (Add Visit) and `VisitDetails`.
- [x] **Visual Styling:** Each Mivtzoim label is now a colored tag/badge, cycling through the app's 5 status colors (`lib/colors.ts`: magenta/green/yellow/darkred/orange) by index.
  - Verified live on `/dashboard/visits/add`: 7 checkboxes rendered (5 seeded Mivtzoim + 2 org-custom ones), first badge computed style `borderColor: rgb(214, 0, 110)` (`#d6006e`, status-magenta), `borderRadius: 9999px` (pill).

## 4. Picklists Management (`dashboard/picklists`)
- [x] **Bug Investigation & Fix — root cause documented:**
  - `dashboard/picklists` reads/writes exactly one data model: `PicklistDefinition` + `PicklistValue` (`GET/POST/PUT/DELETE /api/picklists*`) — real option *lists* (contact.area, contact.pipeline_status, contact.color_tag, contact.potential_next_step, checklist.torah_thought, interaction.category, visit.type, apartment.*, plus any admin-added list including `select`-type custom fields, which `routers/custom_fields.py` auto-provisions into this same table).
  - `קשר לרבי` ("Connection to the Rebbe") and the 5 Mivtzoim checkboxes (tefillin/tzedakah/shabbat_candles/torah_pamphlet/letter_in_torah) are **not** picklist values at all — they're `CustomFieldDefinition` rows (`entity_type="visit"`, `field_type="text"`/`"boolean"`), seeded by `seed_visit_mivtzoim_custom_fields` in `backend/app/seed.py` and managed via the separate `/api/custom-fields` API + `dashboard/custom-fields` admin page. Two genuinely different data models (a list-of-options vs. a single field), each with its own admin page — `dashboard/picklists` simply never queried the second one, so anything living there (any non-`select` custom field, on any entity) was invisible from it.
  - **Fix:** `dashboard/picklists/page.tsx` now also fetches `/api/custom-fields` and renders a "שדות (לא רשימת בחירה)" section per tab (contacts/visit/apartment, same `entity_type`→tab mapping already used for real picklists) listing that tab's non-`select` custom fields, editable in place (label, activate/deactivate, hard-delete — same actions as `dashboard/custom-fields`'s own row) via a new `CustomFieldRow` component, plus a link to the full Custom Fields page for adding a new one. `select`-type custom fields are excluded from this new section since they already appear as ordinary picklists.
  - Verified live: `/dashboard/picklists` → visit tab renders both "קשר לרבי" and the new "שדות (לא רשימת בחירה)" heading/hint text (CDP text-content check).

## Files touched
- `backend/app/schemas.py` — `UserOut.phone`
- `backend/app/seed.py` — 3 new `pl.*` localization rows
- `frontend/app/dashboard/users/page.tsx`
- `frontend/app/dashboard/contacts/page.tsx`
- `frontend/app/dashboard/picklists/page.tsx`
- `frontend/components/CustomFieldsEditor.tsx`

## Verification
- `pytest` (Docker backend container): 430 passed, 0 failed.
- `tsc --noEmit` (frontend): clean.
- Live CDP drive against the running Docker stack (localhost:3001/8001), logged in as the demo admin — see per-item notes above.
