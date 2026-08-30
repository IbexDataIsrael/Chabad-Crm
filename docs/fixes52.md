# Task Execution Plan (`plan.md`)
make fixes52-plan.md before you code
## Objectives & Core Directives

Implement UI updates, data grid feature enhancements, layout fixes, and sorting algorithm overviews across the Dashboard routes (`/contacts`, `/apartments`, `/reports`, `/users`).

---

## Task Breakdown

### 1. Contacts View Updates (`dashboard/contacts/[id]`)

* **CSS Alternating Borders for Data Fields**
  * Apply explicit CSS borders to every distinct data container/field component on the single contact page.
  * Alternate border colors sequentially using the primary theme pink (`var(--site-pink, #D81B60)`) and black (`#000000` or `var(--border-dark)`).
  * *Implementation note:* Use a target index selector or custom Tailwind utility / CSS `nth-child` pattern (`:nth-child(odd)` / `:nth-child(even)`).

---

### 2. Apartments View Enhancements (`dashboard/apartments`)

* **Mobile Header Buttons Fix**
  * Match button heights and alignment on mobile screens to mirror the updated styling applied on the `/contacts` layout. Ensure `height` / `min-height` classes match across breakpoint states (`flex-1`, `h-10`, etc.).
* **Data Grid Filtering**
  * Extend text column filters to support dynamically added fields in addition to static schema fields.
  * Ensure dynamic field filter inputs correctly pass search criteria to the query layer.
* **Bulk Edit Expansion**
  * Include all available standard and custom dynamic fields inside the Bulk Edit modal/drawer.
  * Exclude `apartment_name` (or title) and `building` fields from the bulk update interface.
  * Ensure partial payload logic: Empty or unselected fields must be omitted from the update payload so existing database values remain untouched.
* **Building Grouping Re-architecture**
  * **Visual Layout:** Transform grid display so each building renders as an expandable group header row displaying `{Building Name} ({Apartment Count} apartments)`.
  * **Toggle Mechanics:** Add `+` / `-` toggle controls for expanding and collapsing apartment rows under each building group. Set default state to **collapsed** (`-`).
  * **Pagination Integration:** Ensure backend or frontend grouping maintains structure when navigating across grid page numbers.
* **Sticky Column & Header Layout**
  * Enable CSS sticky positioning (`sticky top-0 z-10`) on grid header titles so they remain visible during vertical scrolling.
  * Enable CSS sticky positioning on the primary column (`apartment_name` / first column) so it remains fixed while scrolling horizontally.
  * Support RTL/LTR directionality dynamically (`left-0` for LTR / `right-0` for RTL).
* **Dynamic Field Customization Sync**
  * Fix dynamic schema hook or state store so newly created apartment fields immediately populate inside the "Customize Fields" column visibility menu.

---

### 3. Buildings & Floor Data Handling

* **Floor Model Update & Alphabetical/Numeric Sorting**
  * Add support for a "Floor" record entry per building.
  * Implement custom sort logic for floor identifiers handling the letter `"L"` (Lobby/Level):
    * Treat `"L"` as numerical value `0` (or `-infinity`) so it sorts prior to Floor `1`, `2`, etc.

---

### 4. Reports Updates (`dashboard/reports/create`)

* **PDF Layout Adjustment**
  * Insert a prominent horizontal dividing line (`<hr>` / PDF border stroke) directly underneath the document header row across generated PDF reports.

---

### 5. Users Section Routing (`dashboard/users`)

* **Conditional Redirect for Shliach Contacts**
  * In the `/dashboard/users` view/router, check user metadata upon loading.
  * If `user_type === 'contact_shliach'`, perform an immediate redirect (`router.replace`) to their designated contact profile path (`/dashboard/contacts/[contact_id]`).

---

### 6. General Sorting Engine Fix (Natural Alphanumeric Sorting)

* **Problem Identification**
  * Lexicographical string sorting evaluates `"10"`, `"11"`, `"12"` as preceding `"2"` because character `'1'` comes before `'2'`.
* **Resolution Strategy**
  * Implement **Natural Sort Ordering** across global sort functions for areas, report numbers, contacts, and numeric identifiers.
  * **Frontend / JavaScript Solution:** Use `Intl.Collator` with numeric sensitivity enabled:
    ```javascript
    const naturalCompare = (a, b) => 
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    ```
  * **Backend / Database Solution (SQL):** Cast string columns containing numbers using `ORDER BY CAST(column AS INTEGER)` or apply `ORDER BY LENGTH(column), column` when sorting raw alphanumeric string values.

---

## Verification & Testing Steps

1. Verify alternating dark pink and black borders on `/dashboard/contacts/270`.
2. Test responsive header button heights on mobile devices for `/dashboard/apartments`.
3. Verify building row collapse/expand toggles (`+`/`-`) and pagination retention in apartments grid.
4. Test dynamic field additions and verify immediate inclusion under "Customize Fields".
5. Confirm floor sorting puts `"L"` at index 0 ahead of floor numbers.
6. Generate a PDF from `/dashboard/reports/create` and verify horizontal rule under header.
7. Login as `contact_shliach` and confirm automatic redirect to `/dashboard/contacts/[id]`.
8. Check natural sort behavior (`1`, `2`, `3` ... `10`, `11`, `12`) across areas, reports, and contacts grids.

---

## Status — DONE 2026-08-30 (uncommitted)

Plan written first: `docs/fixes52-plan.md` (per-section readings + judgment
calls below).

- [x] **1** Contact page's 5 section cards already had a flat magenta
  border (fixes51 §1) — changed to alternate `border-status-magenta/30` /
  `border-black/70` by render position, not a new `--site-pink` token (the
  app's one "theme pink" is `status-magenta`, already used everywhere else).
- [x] **2.1** Real bug: the header button row was missing `flex-wrap`
  (Contacts has it, Apartments didn't) and used `py-1.5` where Contacts uses
  `py-2` — both fixed. Verified live: 0px horizontal overflow at 375px width.
- [x] **2.2** New `custom_field_filter` query param (`field_key:query`
  pairs, mirrors the existing `picklist` param) on `/api/apartments/list`,
  `/building-aggregates` and bulk-update; boolean fields match `checked`,
  everything else is an ILIKE contains. Frontend: one filter input per
  non-select custom field (3-state select for boolean).
- [x] **2.3** Bulk Edit rebuilt: every standard field (floor, resident,
  phone, email, report number, jewish/campaign/mezuzah status, language,
  notes) plus every custom picklist/custom field, each with its own
  checkbox. `apartment_name`/`building_id` aren't fields on the new
  `ApartmentBulkChanges` schema at all (not just hidden in the UI — a
  crafted request can't set them either). Backend payload shape changed
  from two `set_*` boolean flags to a nested `changes` object using
  `exclude_unset` semantics (same contract as the single-apartment PATCH) —
  a breaking API change, updated together with the 5 existing
  `test_fixes23.py` bulk-update tests in the same commit.
- [x] **2.4** Building-group rows default collapsed, `+`/`-` toggle per
  building, state keyed by `building_id` (survives paging). Verified live.
- [x] **2.5** Sticky header row (`sticky top-0`) + sticky first column
  (`right-0` in Hebrew/RTL, `left-0` in English/LTR via `lang`). Verified
  live via computed style.
- [x] **2.6** Real bug, same shape fixes50 already fixed once on the Users
  page: `apartments.customFields`/`apartments.customFieldFields` were
  inclusion-lists (`null` = all visible, but the moment one field was hidden
  the array became a *frozen snapshot* of the field_keys that existed then —
  any field created afterward was silently absent = hidden). Flipped to
  hidden-lists (new preference keys, so a stale inclusion-list value is
  never misread as a hidden-list one) — a new field is visible immediately.
- [x] **3** Floor model + CRUD already existed (fixes7) — the actual gap was
  `add_floor`'s auto `sort_order`, which always appended at the end
  regardless of name. Now: a floor named "L" (case-insensitive) with no
  explicit `sort_order` gets `min(existing) - 1` instead, so it always
  sorts first — even ahead of a building whose floors were previously
  manually reordered.
- [x] **4** `drawPdfHeaders`'s pale org-branding hairline already existed
  (fixes26 §1) — added a second, more prominent (darker, thicker) divider
  under the report's *own* title line, which had none.
- [x] **5** `/dashboard/users` already redirected any non-admin to
  `/dashboard` (nav is admin-only, so only a direct URL gets here) — now a
  shliach with a linked contact goes to their own contact profile instead.
  **Found and fixed a real bug while live-driving this**: `GET
  /api/auth/me` never resolved `UserOut.shliach` at all (only `GET
  /api/users/{id}` did) — the frontend field existed but the backend session
  endpoint the frontend actually calls on load never populated it, so the
  redirect had nothing to redirect to. Fixed by reusing `users.py`'s
  `_linked_shliach`/`_shliach_out` in `/me` (same cross-router-helper import
  pattern `search.py` already uses). Also added `shliach` to the frontend
  `User` type (`lib/auth.tsx`), which was missing it even though the API
  already returned it for every *other* caller of `UserOut`.
- [x] **6** `apartments.py`'s existing `_natural()` (fixes17 §3.2) only
  handles whole-value-numeric-vs-not, not a number embedded mid-string —
  moved to `app/core/natural_sort.py` and reused as-is for `contacts.py`
  (paginated, so DB-level sorting is required; this correctly fixes a
  purely-numeric contact `name` but not one with an embedded number, which
  doesn't occur for real names in practice). For `areas.py`/
  `report_numbers.py` (never paginated — full list every time) added a
  proper Python-side natural-sort key (digit/non-digit chunk splitting,
  same behavior as `Intl.Collator({numeric:true})`) and sort there instead —
  this was a real gap caught by testing with realistic names ("אזור 2" vs.
  "אזור 10"), not just the spec's literal pure-numeric example. Frontend:
  new `lib/naturalSort.ts` (`Intl.Collator`, the spec's own snippet) applied
  to `reports/create/page.tsx`'s building-group-key sort, the one existing
  client-side sort of this bug class.

**Evidence:** Backend: `backend/tests/test_fixes52.py` (16 new tests across
7 classes — natural sort, floor "L" placement incl. a manually-reordered-
minimum edge case, expanded bulk update incl. partial-payload and the
apartment_name/building exclusion guard, custom field filter incl. an
unknown-field-key no-op, and the `/me` shliach-resolution fix) plus 6
existing `test_fixes23.py` bulk-update tests updated for the new payload
shape. Full suite: 472 passed (the 4 `test_models.py` failures are the
pre-existing `host.docker.internal`-outside-Docker environment gap noted in
every prior round, untouched by this one). `npx tsc --noEmit` clean (one
real gap surfaced and fixed: `lib/auth.tsx`'s `User` type was missing the
`shliach` field the API already sent). Live-drive (Playwright, throwaway QA
org, real clicks against local Docker+Postgres): mobile header 0px overflow,
Customize Fields panel opens, grouping starts collapsed and expands on
click, sticky header (`position: sticky`) and sticky first column
(`right: 0px`, Hebrew RTL), bulk-edit modal shows every new field and
excludes building/apartment number, contact-page borders alternate
(confirmed via computed `border-color`), and — after the `/me` fix — a
shliach login actually lands on their own contact profile instead of
`/dashboard`. New localization rows (`filter.yes`/`filter.no`/
`action.expand`/`action.collapse`) seeded via the existing idempotent
`seed_localization`, applied automatically on backend startup.