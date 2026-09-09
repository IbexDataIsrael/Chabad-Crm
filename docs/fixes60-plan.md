# Plan: fixes60 — Tasks/Report-Numbers polish, tab splits, global filters, area polygons, apartments/report-builder custom-field gaps, PDF upgrades

## Context

`docs/fixes60.md` bundles 8 unrelated fixes/features across the app. The spec itself says
"make fixes60-plan.md before coding" — this is that plan. I explored the actual current
code for every task (models, routers, frontend pages) before writing any decision below,
rather than trusting the spec's own guesses about what exists.

Several spec items describe something that doesn't quite match reality (wrong page name,
wrong PDF mechanism, fields that don't exist on the target entity). Each is called out
explicitly with the real situation and the call I'm making, same as plan58's format.

## Key architecture decisions (please review — these are judgment calls)

**1. Task 1's "Title/Description/Priority/Due Date" fields don't exist on `Task`, and I'm
not adding them.** `Task` (fixes58) has `campaign_id`, `volunteer_user_id`,
`custom_date_value_id`, `status`, `volunteer_report_summary`, and its `report_numbers`
M2M — a coverage assignment, not a generic to-do item. None of Priority/Due-Date have any
consumer anywhere else in the app (no sort, no filter, no display), so adding them would
be speculative schema for a concept nothing else uses. The "New Task" button opens the
existing `TaskQuickCreateForm` fields instead (Campaign, Volunteer, Report Numbers,
Custom Date, Status) — the same data a task already needs — generalized to let the admin
*pick* the volunteer instead of it being locked to one pre-selected row.

**2. Task 1's "worker report column" is scoped to the activist, not literally per-task —
no new column/migration.** The only report-submission entity in the system,
`ShliachReportCompletion` (status enum `completed|not_completed|partial` + `comments`,
exactly the spec's Status/Notes split already), is keyed by `contact_id` alone — no
`task_id`/`report_number_id`/`campaign_id` anywhere, and nothing in the self-service
submission flow (`ReportCompletionModal`, reached from `/dashboard/activist`) lets an
activist say which task a report is about. Retrofitting real per-task attribution means
a schema change *and* new UI on the activist-facing form. Given most orgs have exactly
one active task per activist (per fixes58's own migration data), I'm resolving the
column as "this task's volunteer's most recently submitted report" — for the common
one-task case this is exactly "this task's latest report"; for an activist juggling two
simultaneous tasks, both rows show the same (their overall latest) submission, an
accepted simplification. Resolved server-side via the existing `resolve_shliach()` helper
(`app/core/shliach.py`), the same one apartment-access resolution already uses — no new
FK, no migration, no activist-facing UI change.

**3. Task 2's endpoint needs a real field added: `task_id`.**
`report_number_campaign_task_status` currently returns `{report_number_id: {campaign_id:
status}}` — a plain string, no id to `PUT` against. Widening the value to `{status,
task_id}` is the one backend change this task needs; everything else (the inline
`<select>`) reuses the exact `InlineEdit` pattern the Tasks page already has. If a report
number has 2+ tasks under the same campaign, the existing endpoint already silently keeps
only the last one iterated (a pre-existing property, not something this change makes
worse) — noted, not fixed here.

**4. Task 5's polygon generation ships as a real, reusable feature (an endpoint + an
admin button), not a rerun of the one-off local script from earlier this session.** The
spec frames it as something the map layer does on an ongoing basis ("compute area
boundaries... overlay on map components"), and the frontend already renders whatever
GeoJSON sits in `Area.area_polygon` with zero changes needed (`AreasMap.tsx`/
`BuildingsMap.tsx` already do this for hand-drawn polygons) — so the real work is a
backend endpoint that computes a convex hull from an area's buildings and saves it via
the existing `area_polygon` field, plus a button to trigger it (single area, and "all
areas" for the one-time backfill this session already previewed). Convex hull, not a
concave/alpha-shape hull — matches the preview already shown to the user and avoids a
much larger geometry dependency for marginal accuracy gain; noted as the known tradeoff
(can overreach into a neighbor's territory for interleaved areas) same as before.

**5. Task 5's marker icons are inline SVG data-URIs, not new binary asset files.** No
building/townhouse icon assets exist anywhere in the repo. Two small inline SVGs (a
building glyph, a house glyph) keep this self-contained — consistent with how this
project already avoids external asset dependencies for one-off UI icons.

**6. Task 6's real bug is that custom-field columns can never be reordered — not a
toggle/visibility bug.** Toggling visibility already works for both custom picklists and
custom fields; only *dragging* them is blocked, by a deliberate `data-sortable-disabled`
that only real `FIELD_KEYS` (built-ins) escape. Fix: extend the persisted field-order
list to a prefixed key scheme (`col:`/`pl:`/`cf:`, mirroring the `GridColumn`/
`gridColumnSortKey` pattern the Users page already uses) covering every active column,
built-in or custom, so the drag/▲▼ reorder UI and its persisted order operate over the
same open set the visibility toggles already do.

**7. Task 7 reuses the Apartments page's own custom-column plumbing rather than
reinventing it.** The report builder's column list is a fully closed, hardcoded tuple,
totally independent of whatever the Apartments grid already fetches for the same
purpose. Fix pulls in the same two sources the Apartments page already uses —
`/api/picklists` (apartment.* beyond the 4 fixed ones) and
`useCustomFieldDefs("apartment")` — and extends `rowValueFor`'s switch to fall through to
`a.picklist_values[key]` / `a.custom_field_values[key]`, which the API responses already
carry today (confirmed — this was never a missing-data problem, only a closed-picker
problem).

**8. Task 8's page-header-per-page fix is NOT the spec's proposed `<thead>` +
`@media print` CSS.** This PDF is built entirely client-side via `jsPDF`/
`jspdf-autotable` — there is no live DOM/browser print pipeline for `@media print` to
apply to. The real bug: the report loops over buildings and calls `autoTable()` once per
building, each with its own `head`, so several small buildings landing on one physical
page each draw a redundant header. Fix: track the page number after each `autoTable()`
call (`doc.internal.getCurrentPageInfo().pageNumber`); pass `head: []` on the next
building's call when it's still the same physical page, `head: [head]` when a new page
was started. This gets the spec's actual visible goal (one header per printed page) using
this codebase's real rendering mechanism instead of the inapplicable one it named.

**9. Task 8's "Report #`<id>`" has no existing referent — using a generated run id.**
Confirmed: there is no persisted "report" entity anywhere in this flow in any of the 3
generation modes (apartments/filters/reports) — each PDF is a one-off client-side build
with no saved identity. Using the currently-selected report number's own name only covers
one of three modes and is often plural. Instead: a short id derived from the generation
timestamp (`Date.now()` last 6 digits), shown as "Report #`<id>` · Page X of Y" in every
mode uniformly — meaningful and unique per generated file without inventing a persisted
entity the spec never asked for elsewhere.

**10. Task 4 does not add a "clear all" button to `/dashboard/shliach-config`.** That
section is a settings *form* (Save/Cancel governs it), not a live filter toolbar like the
other pages — there's no "stale persisted filter" failure mode there for a clear button
to fix. The spec's actual complaint ("resolving area/neighborhood filter persistence") is
already fully solved on Apartments/Contacts, the two pages that historically had that bug
— this task is about extending the same already-proven pattern to Report Numbers, Tasks,
and Users, the 3 pages confirmed to have no clear-all at all today.

## Phase 1 — Backend: Task 1 (worker report resolution) + Task 2 (task_id in status endpoint)

- `backend/app/routers/tasks.py`: `list_tasks` gains, per row, a resolved
  `latest_report_status` / `latest_report_notes` (nullable) — for each task's
  `volunteer_user_id`, resolve via `resolve_shliach()` to a `ContactShliach`, then query
  the newest `ShliachReportCompletion` by that `contact_id` (batch this across the page's
  rows in one query, not N+1, mirroring `_report_numbers_by_task`'s batching style).
- `backend/app/schemas.py`: `TaskOut` gains `latest_report_status: Optional[str]`,
  `latest_report_notes: Optional[str]`.
- `backend/app/routers/report_numbers.py`: `report_number_campaign_task_status` response
  type becomes `dict[int, dict[int, TaskStatusWithId]]` (`{status, task_id}`).
  `backend/app/schemas.py` gains `TaskStatusWithId`.

## Phase 2 — Backend: Task 5 (polygon generation endpoints)

- `backend/app/core/geo.py` (already holds `polygon_ring`) gains a `convex_hull(points)`
  helper (pure Python, same monotone-chain approach as this session's report script — no
  new dependency).
- `backend/app/routers/areas.py`: `POST /api/areas/{id}/generate-polygon` (admin-only) —
  loads the area's buildings with non-null lat/lng, needs ≥3 for a real polygon (400 if
  fewer), computes the hull, closes the ring, saves GeoJSON into `area_polygon`, returns
  the updated `AreaOut`. `POST /api/areas/generate-polygons` (admin-only, bulk) does the
  same for every area in the org with ≥3 geocoded buildings, returns a per-area
  success/skip summary (mirrors the shape of this session's one-off script's report).

## Phase 3 — Backend: Task 6 does not need backend changes (confirmed frontend-only);
Task 7 does not need backend changes (confirmed data already returned); Task 3 does not
need backend changes (confirmed pure client-side tab grouping).

## Phase 4 — Frontend: Task 1 (Tasks page create button + report columns)

- `frontend/components/TaskQuickCreateForm.tsx`: `volunteerUserId`/`volunteerName` become
  optional; when absent, render a searchable activist `<select>` (shliach-role users from
  `GET /api/users`, same client-side role filter the Users page already uses) in their
  place.
- `frontend/app/dashboard/tasks/page.tsx`: a "New Task" button (matching the page's
  existing header/button conventions) opens that form with no volunteer locked;
  `onSaved` reloads the grid. The single "worker report" column splits into two: a
  `StatusBadge` (ported verbatim from `messages-from-activists/page.tsx`, same 3 colors)
  and a Notes cell showing `latest_report_notes`, truncated like other free-text cells.

## Phase 5 — Frontend: Task 2 (inline status toggle on Report Numbers)

- `report-numbers/page.tsx`: `campaignTaskStatus` type widens to carry `task_id`;
  `taskStatusBadge` becomes an `InlineEdit`-wrapped `<select>` (same 3-status editor
  shape the Tasks page already uses) that `PUT`s `/api/tasks/{task_id}` on change, then
  reloads the campaign-task-status map. A cell with no `task_id` (no task at all for that
  report number under that campaign) stays the current plain "—".

## Phase 6 — Frontend: Task 3 (tab split)

- `custom-fields/page.tsx` and `fields/page.tsx`: add a `"shliach"` tab to each, mirroring
  `picklists.tsx`'s existing 5-tab pattern exactly — `tabFor()` gains the
  `contact_shliach → "shliach"` branch, `TABS`/`TAB_ENTITIES` gain the entry (reusing the
  already-present `ENTITY_TYPES`/`ENTITY_LABELS` `contact_shliach` rows), the "contacts"
  tab body drops `contact_shliach` from its own render call now that it has its own tab.

## Phase 7 — Frontend: Task 4 (clear-all + selected-first sort)

- `report-numbers/page.tsx`, `tasks/page.tsx`, `users/page.tsx`: add a `clearAllFilters()`
  covering that page's own filter state, plus the same visible button/label/placement
  convention (`t("filter.clear_all", "נקה את כל הסינונים")`, shown only when any filter
  is active) already proven on Apartments/Contacts.
- `MultiSelectFilter.tsx` and `MultiSelectSearchFilter.tsx`: sort each's `visible` list so
  currently-selected ids float to the top (stable otherwise), at the one identified edit
  point in each file.

## Phase 8 — Frontend: Task 5 (marker icons)

- `BuildingsMap.tsx`: the one `new g.maps.Marker(...)` call gains an `icon` chosen by
  `b.is_town_house` (inline SVG data-URI per decision #5).
- New small "Generate area boundaries" action: a button on the Areas page (single-area
  row action + one "generate for all areas" bulk action) calling the Phase 2 endpoints,
  toast-reporting the result count.

## Phase 9 — Frontend: Task 6 (reorderable custom columns) + Task 7 (report builder fields)

- `apartments/page.tsx`: extend the persisted field-order key scheme to prefixed keys
  covering custom picklists/fields too; drop the `data-sortable-disabled` restriction for
  them so they drag/▲▼-reorder alongside built-ins.
- `reports/create/page.tsx`: fetch `/api/picklists` (apartment.*, beyond the 4 fixed) and
  `useCustomFieldDefs("apartment")`, merge into the selectable-column list; extend
  `rowValueFor` to fall through to `picklist_values`/`custom_field_values` for any key
  outside the original fixed switch.

## Phase 10 — Frontend: Task 8 (PDF upgrades)

- `reports/create/page.tsx`'s PDF generator: per-building `autoTable()` calls track the
  page number before/after each call and pass `head: []` when still on the same physical
  page (decision #8); groups with `< 4` apartments get a smaller inline header and
  reduced spacing instead of the current full section break; after all content is drawn,
  a final pass over `doc.internal.getNumberOfPages()` stamps "Report #`<id>` · Page X of
  Y" in the footer of every page (decision #9).

## Verification

- Backend: `pytest` — new tests for the polygon-generation endpoints (a real 3+-building
  area produces a valid closed GeoJSON ring; a <3-building area 400s), the widened
  `report_number_campaign_task_status` shape, and `TaskOut`'s new report fields resolving
  correctly (including the "no report yet" / "unlinked shliach" null cases).
- `tsc --noEmit` in `frontend/` before calling anything done.
- Live-drive via the local Docker stack: create a task from the new Tasks-page button;
  submit a report as that activist and confirm the Tasks-page status/notes columns show
  it; toggle a task's status inline from Report Numbers and confirm it matches the Tasks
  page; confirm the new "shliach" tab appears (and is populated) on custom-fields/fields;
  confirm "Clear all filters" resets and un-persists Report Numbers/Tasks/Users; generate
  a real area's polygon and confirm it renders on the Areas/Buildings map; toggle a
  townhouse marker and confirm the icon changes; add a brand-new apartment custom field
  and confirm it's both toggleable *and* draggable in Customize Columns, and selectable
  in the report builder; generate a PDF and confirm one header per page and the new
  footer text.

## Progress log

- [x] Phase 1 — Backend: worker report resolution + task_id in status endpoint — `test_fixes60.py` (7 tests), full suite 523 passed
- [x] Phase 2 — Backend: polygon generation endpoints — covered by `test_fixes60.py`; live bulk-run generated real polygons for ~190/203 org-1 areas
- [x] Phase 4 — Frontend: Tasks page create button + report columns — verified live (button, form, split columns)
- [x] Phase 5 — Frontend: inline status toggle on Report Numbers — verified live end-to-end (Active→Completed→reverted, confirmed in DB)
- [x] Phase 6 — Frontend: tab split (custom-fields, fields) — verified live (shliach tab present on both pages)
- [x] Phase 7 — Frontend: clear-all + selected-first sort — verified live (Users page: hidden→appears→clears→hidden)
- [x] Phase 8 — Frontend: marker icons + generate-polygon UI — verified live via screenshots (distinct building/townhouse icons; boundary buttons + real polygons on the map)
- [x] Phase 9 — Frontend: reorderable custom columns + report builder fields — verified live (Apartments: custom field dragged 6 positions, persisted across reload; Report Builder: custom field selectable, PDF generated cleanly)
- [x] Phase 10 — Frontend: PDF upgrades — verified live via rendered PDF screenshot (footer page-count text, single header per page, compact small-building layout)

All 10 phases code-complete and live-verified against the local Docker stack (`docker compose`, org 1, admin account) on 2026-09-09. `tsc --noEmit` and `npm run build` both clean; backend `pytest` 523/523 passed. Not committed/pushed — awaiting explicit ask per this project's standing rule.
