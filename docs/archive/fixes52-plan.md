# Plan — fixes52

Written before coding, per the spec's own instruction (`docs/fixes52.md` line 2).

---

## 1. Contacts — alternating pink/black section borders

**Read:** `app/dashboard/contacts/[id]/page.tsx` already gives all 5 segment
cards (`main`/`visits`/`visitSummary`/`dates`/`donations`) the SAME
`border-2 border-status-magenta/30` (fixes51 §1 — a flat color, not
alternating). The spec's `var(--site-pink, #D81B60)` isn't a real token
anywhere in the app; the app's actual "primary theme pink" everywhere else is
`status-magenta` (`tailwind.config.js` → `#d6006e`, a near-identical shade).
Introducing a second, slightly-different pink hex just for this one page
would fork the palette for no visual gain and fight CLAUDE.md's color-scheme
section (which names Magenta as the one pink accent). Segments render via
`order.map(renderSegment)` — `order` is the user-configurable segment order,
so "alternate sequentially" must key off render position, not a fixed
per-segment color, or reordering would visibly break the alternation.

**Judgment call:** alternate `border-status-magenta` / `border-black`
(full-strength black, not a translucent tint, per the spec's `#000000`)
keyed by each segment's index in `order` (even index → magenta, odd → black)
— computed in JS at the `order.map(...)` call site rather than CSS
`nth-child` (`renderSegment`'s returned `<section>`s aren't the only
children of their parent — the back-link row, suspended-login banner and H1
sit before them — so a raw CSS sibling-index selector would misalign).

**Steps:**
- `renderSegment(key, index)`: compute
  `const borderClass = index % 2 === 0 ? "border-status-magenta/30" : "border-black/70"`
  and use it (with `border-2`) on that segment's `<section>` instead of the
  hardcoded magenta class, for all 5 cases.
- `order.map(renderSegment)` → `order.map((k, i) => renderSegment(k, i))`.

---

## 2. Apartments (`dashboard/apartments`)

### 2.1 Mobile header buttons

**Read:** Contacts page header buttons (`app/dashboard/contacts/page.tsx`
:876-939) are uniformly `px-4 py-2` inside a `flex flex-wrap items-center
gap-2` row. Apartments page header buttons (`apartments/page.tsx` :761-821)
are `px-4 py-1.5` inside a row that is `flex items-center gap-2` — **missing
`flex-wrap`**. That's the actual bug: on narrow screens the apartments
button row overflows horizontally instead of folding, and the buttons are a
touch shorter than the Contacts page's.

**Steps:**
- `apartments/page.tsx` :761 `<div className="flex items-center gap-2">` →
  add `flex-wrap` (matches Contacts).
- Change every header-row button/link's `py-1.5` → `py-2` (clear-filters,
  filters-toggle, fields-toggle, batch-open, "+ הוסף דירה") so heights match
  Contacts' buttons exactly.

### 2.2 Dynamic field text filters

**Read:** Non-select apartment custom fields (`customFieldDefs`, fixes35 §3)
already get a grid column + inline edit, but **no filter row entry at all** —
only the 4 fixed + dynamic *picklist* fields are filterable
(`customFilters`, fixes32 §6). Backend `GET /api/apartments/list` has no
param for them either; `_apply_apartment_filters` only knows `picklist`
(field_key:value repeated pairs). The Users page already solved the same
shape of problem for `contact_shliach` custom fields
(`shliachFieldFilters`, fixes48 §3: boolean → "true"/"false", text/number/date
→ contains-string) — but that page filters a fully-fetched, non-paginated
list client-side. Apartments is server-paginated, so the filter must be
resolved in SQL or `total`/pagination silently corrupt.

**Steps (backend):**
- `apartments.py`: new `_custom_field_text_filter(query, field_key, query_str)`
  — filters `Apartment.id IN (SELECT entity_id FROM custom_field_values JOIN
  custom_field_definitions ON ... WHERE entity_table='apartments' AND
  field_key=... AND value ILIKE %query_str%)` (boolean fields match
  "true"/"false" against `checked`, not `value ILIKE`).
- `_apply_apartment_filters`: new `custom_field_filters:
  Optional[dict[str, str]] = None` kwarg, looped the same way the existing
  `custom_picklists` loop is.
- `list_apartments_enriched` + `building_aggregates`: new
  `custom_field_filter: Optional[list[str]] = Query(None)` param, parsed
  exactly like `picklist` (`"field_key:query"` pairs, `partition(":")`) into
  a dict and passed through.
- `ApartmentBulkUpdate` (§2.3 below) gets the same param for consistency —
  bulk-edit must act on the same rows the grid shows.

**Steps (frontend):**
- `apartments/page.tsx`: new `customFieldFilters` state
  (`usePersistentState<Record<string,string>>("crm.apartments.customFieldFilters",
  {})`); render one input per `orgVisibleCustomFieldDefs` entry in the filter
  row — boolean fields get a 3-state `<select>` (all/yes/no →
  ""/"true"/"false"), text/number/date get a plain text input (debounced like
  `query` is, reusing the existing `debounceRef` pattern per-field would be
  overkill — a single shared debounce keyed by the whole filters object is
  enough, matching how `customFilters` picklist changes already take effect
  immediately without debouncing since those are discrete select changes; a
  text input here debounces the same 300 ms as `onQueryChange`).
- `buildFilterParams()`: append `custom_field_filter=field_key:value` for
  every non-empty entry (respecting `vis(...)` org-hidden guard, same
  pattern as `appendCustomPicklistParams`).

### 2.3 Bulk Edit expansion

**Read:** `BulkEditModal` today only offers report-number + notes, via two
`set_*` boolean flags (`ApartmentBulkUpdate.set_report_number` /
`set_notes`). `_bulk_versioned_update` only knows how to copy real columns
forward (`changes: dict`) — it never touches picklist links, custom fields,
or the multi-select `language` field, unlike the single-apartment path
(`_apply_versioned_update`, which already handles all of that). Extending
with ~9 more `set_x`/`x` boolean-flag pairs would be a lot of repetition for
no benefit — `ApartmentUpdate` (the single-edit schema) already expresses
"touch this field vs. leave it alone" via key-presence
(`payload.model_dump(exclude_unset=True)`), and the frontend fully controls
what keys it sends in a bulk request the same as a single PATCH.

**Judgment call:** replace the two flat `set_report_number`/`set_notes`
fields with one nested `changes: ApartmentBulkChanges` object shaped exactly
like `ApartmentUpdate` minus `apartment_name`/`building_id` (the two fields
the spec explicitly excludes) — key presence = "update this field" (an
absent key is untouched, an explicit `null` clears it), reusing
`_split_picklist_changes`/`_split_custom_field_changes`/
`_validate_picklist_changes`/`_validate_report_number` verbatim from the
single-edit path instead of duplicating flag-handling logic. This is a
breaking change to the bulk-update wire shape, but the endpoint has no
outside consumers (internal CRM, frontend + backend ship together) and the
modal is being substantially rewritten in this same round anyway.
`_bulk_versioned_update` is extended to accept `picklist_changes`/
`custom_field_changes`/`language_values` and apply them per row the same way
`_apply_versioned_update` already does (copy_links → set_value,
copy_values → set_value, set_multi_values) — the two versioned-update
functions become thin wrappers around the same per-row body; not merging
them into one shared helper for a "many rows" vs. "one row" difference only
(one commits per row in a loop, one commits once) — that stays as-is per
CLAUDE.md's no-over-engineering rule (introducing a shared helper spanning
a loop vs. non-loop control-flow difference isn't a clean simplification).

**Steps (backend):**
- `schemas.py`: new `ApartmentBulkChanges(BaseModel)` — `floor`,
  `apartment_notes`, `jewish_status`, `campaign_status`, `mezuzah_status`,
  `language: Optional[list[str]]`, `name`, `phone`, `email`,
  `report_number_id`, `picklist_values: Optional[dict[str, Optional[str]]]`,
  `custom_field_values: Optional[dict[str, CustomFieldValue]]` — no
  `apartment_name`/`building_id` fields at all (schema-level exclusion, not
  just a UI omission — a crafted request can't sneak them in either).
  `ApartmentBulkUpdate`: drop `set_report_number`/`report_number_id`/
  `set_notes`/`apartment_notes`; add `changes: ApartmentBulkChanges =
  ApartmentBulkChanges()`; add filter fields `campaign_status:
  Optional[list[str]]`, `language: Optional[list[str]]`,
  `picklist: Optional[list[str]]`, `custom_field_filter: Optional[list[str]]`
  (mirrors the `/list` query params exactly, so "matching the active
  filters" stays true end-to-end).
- `apartments.py` `bulk_update_apartments`: parse `payload.changes.
  model_dump(exclude_unset=True)` the same way `update_apartment` does;
  `language_values = data.pop("language", None)`; `_split_picklist_changes`/
  `_split_custom_field_changes`/`_validate_picklist_changes`/
  `_validate_report_number` on the result; 400 if nothing came through. Parse
  `picklist`/`custom_field_filter` the same way `list_apartments_enriched`
  does and pass every filter field into `_apply_apartment_filters`.
- `_bulk_versioned_update`: add `picklist_changes`, `custom_field_changes`,
  `language_values` params; inside the loop, after `picklist_utils.
  copy_links(...)`, apply `set_value`/`set_multi_values` and
  `custom_field_utils.copy_values` + `set_value`, matching
  `_apply_versioned_update`'s body.

**Steps (frontend):**
- `BulkEditModal`: replace the report-number/notes-only form with one
  section per bulk-editable field (floor, resident name, phone, email,
  report number, jewish/campaign/mezuzah status, language multi-select, plus
  one row per `orgVisibleCustomDefs`/`orgVisibleCustomFieldDefs`), each with
  its own "update this field" checkbox gating an input — checked fields are
  the only keys included in the `changes` object sent to the API (unchecked
  → key omitted, satisfying "empty/unselected fields must be omitted").
  `apartment_name` and `building` get no row at all.
- `apartments/page.tsx`: the `filters` prop passed to `<BulkEditModal>`
  currently only forwards 5 of the page's ~9 filter dimensions
  (`building_ids`/`area_ids`/`report_number_ids`/`jewish_status`/
  `mezuzah_status`/`q`) — missing `campaign_status`, `language`, custom
  picklist filters and (now) custom field filters, so "bulk-edit applies to
  the visible filtered results" was already silently wrong for those. Reuse
  `buildFilterParams()`'s full field set instead of the current partial
  object literal.

### 2.4 Building grouping — collapse/expand

**Read:** `groupByBuilding` (fixes30 §1a) already renders a header row per
building (`{building} ({area}) ({count} דירות)`) with rows always expanded
underneath — no collapse mechanism exists.

**Steps:**
- New local state `const [expandedBuildings, setExpandedBuildings] =
  useState<Set<number>>(new Set())` (not persisted — a fresh page load
  starts fully collapsed, matching "default state to collapsed").
- Group header `<tr>`: add a `+`/`-` button before the building name that
  toggles `a.building_id` in the set; render `-` when expanded, `+` when
  collapsed.
- Row-rendering: when `groupByBuilding` is on, only render a building's data
  `<tr>`s while `expandedBuildings.has(a.building_id)`.
- Keying the set by `building_id` (not row index/page) means expand state
  naturally survives paging — a building spanning a page boundary keeps its
  state, satisfying "maintains structure across page numbers" with no extra
  bookkeeping.

### 2.5 Sticky header + first column

**Read:** The table sits in `<div className="bg-white rounded-xl shadow-sm
overflow-x-auto">` — horizontal-only scroll container, so `sticky top-0`
already has the right containing block (the page's own vertical scroll) for
the header row; no wrapper restructuring needed.

**Steps:**
- Every `<th>` in `<thead>`: add `sticky top-0 z-10 bg-gray-50` (matches the
  existing `<thead>` background so no transparency gap appears while
  scrolled).
- First column (`apartment_name` `<th>`/each row's first `<td>`): add
  `sticky z-20 bg-gray-50` (th) / `bg-white` (td), plus `${lang === "en" ?
  "left-0" : "right-0"}` computed once as a class fragment — the corner cell
  (first `<th>`) needs `z-20` (above the plain header `z-10`) so it stays on
  top at the intersection while scrolling both directions.

### 2.6 Customize Fields — new fields not appearing

**Read:** `visibleCustomKeys`/`visibleCustomFieldKeys` (`apartments.
customFields`/`apartments.customFieldFields` DB preferences) use an
**inclusion-list** shape: `null` = "show everything" (default, safe), but the
moment an admin hides even one field the stored value becomes the concrete
list of field_keys that existed *at that time* — any field created
afterward is absent from that list, so `visibleCustomKeys.includes(d.
field_key)` evaluates false and the new field defaults to **hidden**. This
is the exact bug class already fixed on the Users page in fixes50
(`hiddenShliachPicklistKeys`/`hiddenShliachFieldKeys`, an **exclusion-list**
— absence from the stored array means "never hidden", i.e. visible by
default like any brand-new built-in column). Per that memory, the same
inclusion-list shape is still live on the Contacts page too, but that page
is out of scope here (fixes52 only names Apartments).

**Steps:**
- `apartments/page.tsx`: rename + flip both preferences to hidden-lists:
  `apartments.customFieldsHidden` (was `apartments.customFields`) and
  `apartments.customFieldFieldsHidden` (was `apartments.customFieldFields`),
  default `[]`. New field is absent from an empty/short hidden-array →
  visible immediately, no reload needed.
- `visibleCustomDefs`/`visibleCustomFieldDefs`: `d => !hidden.includes(d.
  field_key)` instead of the current `visibleKeys === null ||
  visibleKeys.includes(...)`.
- `toggleCustomField`/`toggleCustomFieldColumn`: toggle membership in the
  hidden array instead of the previous "current ?? all-visible-keys" dance.
- Renaming the preference keys (not reusing the old ones) means an existing
  admin's prior customization is dropped rather than misread as a hidden-list
  — same reasoning fixes50 used for the identical migration on Users.

---

## 3. Floor "L" natural sort (`Building`/`Floor`)

**Read:** `Floor` (with `sort_order`) + full CRUD already exist (fixes7) —
"Add support for a Floor record" is already done, nothing to build there.
New-building floor generation (`buildings/add/page.tsx` :102-106) only ever
creates purely numeric names ("1".."n"); the only way a floor gets a
non-numeric name like "L" is `FloorsEditor.add()` on the building-edit page,
which POSTs `{name}` with **no `sort_order`** — the backend
(`buildings.py::add_floor`) then always appends:
`sort_order = (b.floors[-1].sort_order + 1) if b.floors else 0`. So adding an
"L" floor to a building that already has floors 1-8 places it *after* floor
8, not before floor 1 — the actual bug. There is no drag/▲▼ reorder UI for
floors at all (unlike fields/segments elsewhere in the app), so this
auto-placement is the only lever that exists to fix it.

**Steps:**
- `buildings.py::add_floor`: when `payload.sort_order is None` (caller
  didn't pin a position), branch: if the stripped name (case-insensitive)
  is `"L"`, `sort_order = min((f.sort_order for f in b.floors), default=0) -
  1` (always strictly before whatever currently sorts first, robust even if
  floors were previously reordered/renumbered); otherwise keep today's
  append-at-end behavior unchanged.

---

## 4. Reports PDF — divider under the header

**Read:** `lib/pdfRtl.ts::drawPdfHeaders` already draws a pale
(`#D1D5DB`) 1pt hairline under the *org branding* row (name + logo) on every
page (fixes26 §1, line 98) — that one's already there. The *document's own*
title ("דוח ריכוז דירות", `reports/create/page.tsx` :447-454) has no divider
under it at all — that's the actual gap the verification step ("verify
horizontal rule under header") is pointing at, and needs to visibly read as
distinct/"prominent" rather than duplicate the existing pale org hairline.

**Steps:**
- `reports/create/page.tsx`, right after the title `doc.text(...)` call and
  before `y += 34`: draw `doc.setDrawColor(31, 41, 55); doc.setLineWidth(1.2);
  doc.line(MARGIN, y + 16, pageW - MARGIN, y + 16); doc.setLineWidth(0.2);`
  (dark gray, thicker than the org hairline — visually "prominent" and
  distinguishable from it) — then continue at the existing `y += 34`
  (already clears the line).

---

## 5. Users routing — redirect a shliach's own contact profile

**Read:** `/dashboard/users` already gate-redirects any non-admin:
`if (!loading && !isAdmin) router.replace("/dashboard")` (`users/page.tsx`
:239) — the nav link is admin-only too, so the only way here is a direct
URL. The spec's `user_type === 'contact_shliach'` isn't a real field
(role is `user.role: "admin"|"staff"|"shliach"|"superadmin"`); the
concrete equivalent already on the session is `me.role === "shliach"` +
`me.shliach.contact_id` (`OrgUser.shliach: Shliach | null`, `Shliach.
contact_id: number`, populated by `/api/auth/me`).

**Steps:**
- `users/page.tsx` :238-240: when redirecting a non-admin, prefer the
  shliach's own contact profile over the generic dashboard when one exists:
  ```
  if (!loading && !isAdmin) {
    router.replace(
      me?.role === "shliach" && me.shliach?.contact_id
        ? `/dashboard/contacts/${me.shliach.contact_id}`
        : "/dashboard",
    );
  }
  ```
  (dependency array gains `me`).

---

## 6. Natural sort engine

**Read:** `apartments.py::_natural(col, db)` (fixes17 §3.2) already
implements exactly the SQL pattern the spec describes
(`(is_numeric ? LENGTH(col) : 0, col)` — non-numeric first, numeric ascending
by digit-length then value) — proven correct, dialect-aware (regex on
Postgres, GLOB on SQLite tests). It's local to `apartments.py` and unused
elsewhere. `areas.py` (`order_by(Area.area_name)`), `report_numbers.py`
(`order_by(ReportNumber.name)` — report numbers are literally numeric
strings, the textbook "10 sorts before 2" case) and `contacts.py` (two sites:
the plain list :833 and the paginated list :968-972) all sort with a bare
column, lexicographically. Frontend: `reports/create/page.tsx` :484-485
client-sorts building group keys with plain `localeCompare` (no
`numeric: true`) — the one clear client-side instance of the same bug class
(street addresses like "רחוב 10" vs. "רחוב 2").

**Steps (backend):**
- New `app/core/natural_sort.py`: move `_natural` there verbatim as
  `natural_sort_keys(col, db)` (same dialect-aware body). `apartments.py`
  imports it instead of defining its own; behavior unchanged (verified by
  existing apartment sort tests).
- `areas.py::list_areas`: `order_by(*natural_sort_keys(models.Area.
  area_name, db))`.
- `report_numbers.py::list_report_numbers`: `order_by(*natural_sort_keys(
  models.ReportNumber.name, db))`.
- `contacts.py`: both `Contact.name` order-by sites → natural sort; the
  paginated one keeps its `dir` toggle (`.desc()`/`.asc()` applied to each
  key in the tuple, same as apartments' `primary`/`secondary` pattern).

**Steps (frontend):**
- New `lib/naturalSort.ts`: `export const naturalCompare = (a: string, b:
  string) => a.localeCompare(b, undefined, { numeric: true, sensitivity:
  "base" })` (the exact snippet the spec gives).
- `reports/create/page.tsx` :484-485: `buildingKeys.sort(naturalCompare)`
  instead of the raw `localeCompare(b, "he")` call.

**Revision (found while writing `test_fixes52.py`):** `natural_sort_keys`
(the SQL version above) only distinguishes *whole-value* numeric vs.
non-numeric — it can't reorder a number embedded mid-string ("אזור 2" vs.
"אזור 10" are both non-numeric as whole values, so it falls back to plain
lexicographic and gets it wrong; a live test with real area names caught
this immediately). `Intl.Collator({numeric:true})` on the frontend doesn't
have this limitation — it detects the embedded digit run and compares it
numerically. Rather than attempt a portable (Postgres + SQLite) SQL
embedded-number natural sort, added `natural_sort_key(value)` to
`app/core/natural_sort.py` — a Python key splitting the string into
digit/non-digit chunks (`re.findall(r"\d+|\D+", value)`), comparing digit
chunks as ints — and switched `areas.py`/`report_numbers.py` to fetch their
(never-paginated, always-full) result set and `sorted(...)` it in Python
with that key, which is both correct and cheap since nothing there uses
LIMIT/OFFSET. `contacts.py` stays on the SQL-level `natural_sort_keys`
helper (paginated — sorting in Python there would mean fetching the whole
table before paging, a much bigger and riskier change) — it correctly
handles a purely-numeric `name` (the spec's literal "10"/"2" example, the
"numeric identifiers" case) but not a number embedded in a real name, which
essentially never occurs for a person's name in practice.

---

## Sequencing

1. §6 natural-sort helper first (`app/core/natural_sort.py`) — §2's
   nothing depends on it, but doing the shared plumbing before the areas/
   report_numbers/contacts one-line callers keeps that part trivial.
2. §1 (border), §5 (users redirect), §3 (floor "L"), §4 (PDF line) — small,
   independent, no schema changes.
3. §2.6 (customize-fields hidden-list flip) — small, no backend.
4. §2.1 (mobile header), §2.4 (grouping collapse), §2.5 (sticky) — apartments
   page CSS/state, no backend.
5. §2.2 (custom field text filters) — backend filter param + frontend inputs.
6. §2.3 (bulk edit expansion) — the largest single piece (schema reshape +
   `_bulk_versioned_update` rewrite + modal rewrite), done last since it
   touches the most surface area and benefits from §2.2's filter plumbing
   already being in place.

Backend test coverage: `backend/tests/test_fixes52.py`, one test class per
numbered section above (natural sort ordering, floor "L" placement, bulk
update field expansion + partial-payload semantics, custom field filter).
Live-drive verification (Playwright against local Postgres) for the
frontend-only pieces (borders, sticky columns, grouping collapse, mobile
button layout, redirect) afterward, per house rule.
