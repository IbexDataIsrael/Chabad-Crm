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

### 2026-08-30 (same day, later) — the rest of the plan, in full

User: "yes implement all changes on fixes53.md." Went through every
remaining section. Some were **already satisfied by prior rounds** (verified
by reading the live code, not assumed from memory) — those are marked as
such below rather than re-touched. Everything else is new this round.

- [x] **§1 CSS Alternating Borders** — already done (fixes52 §1):
  `frontend/app/dashboard/contacts/[id]/page.tsx`'s `renderSegment` already
  alternates `border-status-magenta/30` / `border-black/70` by render
  position across all 5 page segments. No changes needed.
- [x] **§2 Mobile Header Buttons Fix** — already done (fixes52 §2.1, code
  comment literally says "matches the Contacts page's header button heights
  exactly").
- [x] **§2 Sticky Column & Header Layout** — already done (fixes52 §2.5:
  `sticky top-0 z-20`/`z-10` header row + sticky first column, RTL/LTR-aware
  via `firstColStickySide`).
- [x] **§2 Bulk Edit Expansion** — already done (fixes52 §2.3): every
  standard field + every custom picklist + every custom field is a row in
  `BulkEditModal`; `apartment_name`/`building` are absent from
  `BULK_STANDARD_FIELDS` by construction.
- [x] **§2 Data Grid Filtering — dynamic text fields** — already done
  (fixes52 §2.2). **"Empty" selection — new this round**:
  `EMPTY_FIELD_SENTINEL` (`apartments.py`) — a null-byte-wrapped string no
  real search text can collide with — sent as the `custom_field_filter`
  value; `_custom_field_text_filter` matches apartments with no
  `CustomFieldValue` row *or* one explicitly cleared to `""` (the
  `custom_field_utils.set_value` contract: only `None` deletes the row).
  Frontend: an "☐ ריק" checkbox next to each non-boolean custom-field filter
  input, mutually exclusive with the text box.
- [x] **§2 Dynamic Field Customization Sync** — verified already correct,
  not a bug: `useCustomFieldDefs`/the picklist-defs fetch are both
  fetch-on-mount effects, and Next.js App Router remounts the page component
  on every navigation to it — a field created on `/dashboard/fields` (or via
  the API) is visible on `/dashboard/apartments` on the very next visit, no
  hard refresh needed. Live-verified: created a field via the API, loaded
  `/dashboard/apartments` in a fresh browser context, and its filter input
  (and Customize Fields toggle) were present immediately.
- [x] **§2 Mandatory Grid Hierarchy Sorting — new this round**: added
  `sort=hierarchy` to `/api/apartments/list` — Report Number (natural sort,
  nulls last) → Building (`building_address`) → Floor (`_floor_rank()`, "L"
  already first via fixes52 §3) → apartment number, always ascending
  regardless of `dir` (enforced server-side, not just hidden client-side).
  Made it the new default `sort` value (existing users' saved preference is
  untouched — `usePersistentState` only applies a new default to fresh
  state). The direction toggle button is replaced with a static "↑ עולה"
  indicator while this mode is active.
- [x] **§3/§4 Calculated Columns + Activist Navigation + Grid Controls** —
  new `app/core/jewish_status.py`: the 5 real `apartment.Jewish_status`
  technical values map 1:1 onto the spec's category names (`jewish`→Yid,
  `jewish_gentile`→Yid and Goy, `jewish_shtumtz`→Frum,
  `jewish_interested`→Engaged Yid, `jewish_interested_gentile`→Engaged Yid
  and Goy — matches the 5 real Hebrew picklist labels exactly); "Number of
  Jews" = any of the 5, "Number of Engaged Jews" = the 2 "interested" ones
  (a subset). New `GET /api/report-numbers/jewish-counts` and
  `GET /api/areas/jewish-counts` (org-scoped, shliach-scoped like their
  plain list siblings), reusing the *already-existing*
  `/api/report-numbers/shliach-assignments` and `/api/areas/shliach-
  assignments` endpoints (fixes43) for "Name of Activist" — no new coverage
  data needed. Both `/dashboard/report-numbers` and `/dashboard/areas` grew
  from a plain card/row list into a real grid: sortable `<th>` columns
  (client-side — both lists are already fetched in full; natural/locale
  compare via the existing `naturalCompare` helper for name/activist,
  numeric compare for the counts), a Customize Fields toggle for the new
  optional columns, and (`/dashboard/report-numbers` only) a "הצג דירות"
  link to `/dashboard/apartments?report_number_ids=<id>` — a new one-shot
  deep-link effect on the apartments page reads that param once on mount,
  clears every other filter, and applies it (there was no existing "filter
  applied via URL" path into that page before now). The Areas page keeps
  its map, cascade-delete-with-buildings modal, and area multi-select
  filter unchanged — only the list-of-cards became a table.
- [x] **§5 Floor Model & Sort Logic** — already done (Floor model +
  fixes52 §3's "L" = `min(sort_order) - 1` trick, reused as-is by the new
  hierarchy sort's `_floor_rank()`).
- [x] **§6 PDF Layout Adjustment** — already done (fixes52 §4: a 1.2pt-wide
  dark divider directly under the report's own title, explicitly described
  in its own code comment as "distinct from drawPdfHeaders' pale
  org-branding hairline").
- [x] **§7 Shliach Conditional Redirect & Self-Service Edit**:
  `/dashboard/users` already redirected a shliach to their own contact
  (fixes52 §5); **new this round**: `/dashboard/page.tsx` (the real
  post-login landing page) now does the same — a shliach with a linked
  contact lands on `/dashboard/contacts/{id}` directly, making it "the
  default screen upon initial system entry" as asked, not just a page they'd
  reach if they happened to visit Users. "Edit your data" button: the
  contact page renders fully read-only for a shliach viewing their own
  profile until they click it (reuses `ContactView`'s existing `!onPatch` →
  plain-display path, no new prop needed for that half); once clicked,
  `ContactView` gets new `isSelfEdit`/`lockedFieldKeys` props — Email,
  `shliach.areas`, `shliach.report_numbers` are hard-coded always-locked
  (`MANDATORY_SELF_EDIT_LOCKS`), rendered with a 🔒 hint instead of the
  normal click-to-edit. **Enforced server-side too**, not just hidden in the
  UI: `contacts.py`'s `update_contact` strips `email`/
  `shliach.area_ids`/`shliach.report_number_ids` from the payload whenever
  the editor is a shliach editing their own linked contact, regardless of
  what a raw API call sends.
- [x] **§7 Report Completion Action** + **System Comments Action** +
  **Persistence Layer**: two new tables via Alembic migration
  `6c7d8e9f0a1b` — `shliach_report_completions` (status + optional comments)
  and `shliach_system_comments` (free text), both keyed by `contacts.id`
  (deliberately *not* `contact_shliach.id`, which is versioned and would
  orphan old submissions on the next profile edit — see fixes45). New router
  `app/routers/shliach_messages.py`: `POST` self-scoped (resolves the
  caller's own shliach contact via `resolve_shliach`, 403s a non-shliach),
  `GET` admin-only, for `/dashboard/messages-from-activists`. Two buttons +
  modals on the self-edit page ("דיווח על השלמת הדוח" — 3 radio choices +
  a comments textarea; "הערות על המערכת" — free text), both available
  regardless of whether "Edit your data" mode is on.
- [x] **§8 Activist Configuration field-level locks**: `shliach_view_config`
  (already a free-form JSON blob on `organizations`, no migration needed)
  grew a `self_edit_locked_fields: string[]` key. New section on
  `/dashboard/shliach-config`: checkboxes for name/last_name/phone/
  `shliach.notes` plus every admin-added `contact_shliach.*` picklist/custom
  field — Email/Areas/Report Numbers deliberately don't appear here (they're
  the mandatory, non-configurable floor, not something an admin can
  *unlock*). Enforced server-side for the 4 static fields (same
  `update_contact` code path as the mandatory locks); the dynamic
  picklist/custom-field locks are enforced client-side only (`ContactView`'s
  `isLocked()`) — a scope decision, not an oversight, since tracing an
  arbitrary field_key through the picklist/custom-field storage layer for a
  guardrail aimed at less-technical activists (not a hard security
  boundary) wasn't worth the added complexity this round.
- [x] **§9 Messages from Activists**: new `/dashboard/messages-from-
  activists` page (admin-only) + a new nav entry in the Reports group
  (hidden for shliach, like its siblings). Two lists — report completions
  and system comments — each linking the activist's name to their contact
  page. Status badges use the spec's *exact* hex values (`#2e7d32`/
  `#d32f2f`/`#ed6c02`) via inline styles, deliberately not this app's own
  (different-shade) `status-green`/`status-darkred`/`status-orange` theme
  tokens — confirmed live: a submitted "not completed" badge's computed
  `background-color` is `rgb(211, 47, 47)`, i.e. `#d32f2f` exactly.
- [x] **§10 General Natural Alphanumeric Sorting Fix** — already done
  (fixes52 §6): backend `natural_sort_key`/`natural_sort_keys`
  (`app/core/natural_sort.py`) applied to Areas, Report Numbers, and
  Contacts; frontend `naturalCompare` (`lib/naturalSort.ts`, the spec's own
  `localeCompare(..., {numeric:true})` snippet) already used in
  `reports/create`, Users, admin-areas, Localization. This round's two new
  grids (Report Numbers, Areas) reuse `naturalCompare` for their new
  client-side sortable columns, so the "10 before 2" bug can't reappear
  there either.

**Evidence:**
- New backend tests: `backend/tests/test_fixes53.py` now holds 16 tests
  across 6 classes (`TestListGroupedByBuilding` from the earlier building-
  count fix, `TestHierarchySort`, `TestEmptyFieldFilter`, `TestJewishCounts`,
  `TestShliachSelfEditLocks`, `TestShliachMessages`) — all passing. Full
  backend suite: **498 passed, 0 failed**. `npx tsc --noEmit` clean
  throughout.
- Independent SQL cross-check: `report_number_id=2048`'s "jews" count from
  the new endpoint (17) matched a hand-written raw-SQL count over
  `picklist_links`/`picklist_values`/`picklists` exactly.
- Live-drive (Playwright, headless Chromium, local Docker+Postgres, real
  logins — admin and freshly-created throwaway shliach contacts):
  - Report Numbers grid: Jews/Engaged/Activist columns render; clicking the
    "Number of Jews" header re-sorts the rows; "הצג דירות" navigates to
    `/dashboard/apartments?report_number_ids=<id>` and the apartments page
    actually applies that filter (confirmed via URL + network params).
  - Areas grid: same calculated/activist columns; the "New area" admin
    button, per-row edit action, and (implicitly, unchanged code) the
    cascade-delete modal and polygon map all still present after the
    card→table rewrite.
  - Apartments: default sort selector reads "hierarchy" on a fresh session;
    an "Empty" checkbox is present next to a real non-boolean custom field's
    filter input.
  - Shliach self-service, full round trip: login → lands on
    `/dashboard/contacts/{own id}` (confirmed the 2-hop redirect chain
    completes in ~2.5s, not instant — a slow first check that doesn't wait
    long enough will incorrectly read this as broken); "Edit your data"
    click reveals exactly 3 🔒 icons (email, areas, report numbers) and
    every other field shows the normal ✎ edit affordance; clicking the
    locked email field opens no input (0 `<input>` elements appear);
    submitted a "not completed" + comment and a system comment; both then
    appeared on the admin's `/dashboard/messages-from-activists` with the
    activist's real name linked to their contact page and the exact
    `#d32f2f` badge color.
  - `shliach_view_config.self_edit_locked_fields` round-tripped through
    `/dashboard/shliach-config`'s new UI and was verified to actually block
    edits server-side (locked "phone" via the admin panel → the shliach's
    own PATCH silently left `phone` unchanged).
- All of this session's temporary/throwaway test contacts and orgs live only
  in the local dev Postgres container — nothing was touched in any deployed
  environment, and per house rule no commit/push happened without an
  explicit ask.