# fixes39 — Implementation Plan

Source spec: `docs/fixes39.md`. Four independent work items.

## 1. Mivtzoim → real custom fields (DB schema)

### Current state (verified by reading the code, not assumed)
`visit_history` has 6 hardcoded columns: `tefillin`, `tzedakah`,
`shabbat_candles`, `torah_pamphlet`, `letter_in_torah` (all boolean) and
`connection_to_rebbe` (text). The generic custom-field infrastructure
(`CustomFieldDefinition` / `CustomFieldValue`, `entity_type="visit"`) already
exists and already renders alongside these hardcoded fields today — org 1
(production) already has org-added custom fields like "mezuzah" and
"chinoch" living in the exact same UI section. fixes38 even found and
deactivated 6 *duplicate* custom-field rows that shadowed these native
columns (ids 2,4,5,6,7,9 — `Kesher_Larabi`, `tfilin`, `nerot`, `alon`,
`dvar_torah`, `ot`); those stay deactivated (dead legacy artifacts with
non-standard field_keys) and are **not** reused — the migration creates
fresh rows keyed by the same names as today's columns instead.

Critically, `CustomFieldValueInput`/`CustomFieldsEditor`/the visit
form/detail generic-custom-field loops (`visitCustomFieldDefs` — any
non-select non-boolean field) and the legacy boolean+note sub-resource
(`/api/visits/{id}/custom-fields`, driving `CustomFieldsEditor`) are already
fully wired and already used for org-added visit checklist items. Once the
6 native fields become `CustomFieldDefinition` rows, **no new frontend
rendering code is needed for them** — they fall into the same generic paths
"mezuzah"/"chinoch" already use today. This is the main risk-reducer for
this round.

### Design
- 5 boolean fields → `field_type="boolean"` custom fields (render via the
  existing checkbox+note `CustomFieldsEditor`, same as "mezuzah").
- `connection_to_rebbe` → `field_type="text"` custom field (renders via the
  existing generic `visitCustomFieldDefs` text/number/date loop).
- `torah_thought` is **not** in scope — it already lives on `PicklistLink`
  (`checklist.torah_thought`), untouched by this round.
- Idempotent seeding helper `seed_visit_mivtzoim_custom_fields(db, org_id)`
  in `app/seed.py`: for each of the 6 keys, look up an existing
  `CustomFieldDefinition` row by `(org_id, entity_type="visit",
  field_key=<name>)`; update it in place if found (label/type/sort_order/
  reactivate), insert if not. Never creates a duplicate — satisfies the
  spec's "never seeded twice" constraint.
  - Wired into `provision_org()` (new-org default, per spec: "Set as default
    values for any new organisation created") and into `seed_all()`'s
    existing per-org idempotent backfill loop (the same pattern
    `seed_picklist_definitions` already uses to reach every existing org on
    every boot, including org 1 in production).
- Alembic migration (`down_revision` = current head `b1c2d3e4f5a6`):
  1. Create the 6 `custom_field_definitions` rows (raw SQL, one row per
     existing organization) — self-contained, mirrors the fixes35 migration's
     style (no import of `app.*` into a migration).
  2. Copy data: for every `visit_history` row, insert a `custom_field_values`
     row for each boolean flag that is `TRUE` (`checked=true`), and for
     `connection_to_rebbe` where non-null/non-empty (`value=<text>`,
     `checked=false`) — mirrors `custom_field_utils.set_value`'s own storage
     convention (absence = unchecked/empty, so falsy values need no row).
  3. Drop the 6 columns from `visit_history`.
  - Downgrade: re-add columns, best-effort backfill from
    `custom_field_values` (structure-only guarantee, matching this repo's
    established downgrade convention — see fixes25/fixes35 migrations).

### Backend code changes
- `models.py`: remove the 6 `Column(...)` lines from `VisitHistory`.
- `schemas.py`: remove the 6 fields from `VisitCreate`/`VisitUpdate`/
  `VisitOut`. `VisitSummaryCategory` gains `hebrew_label`/`english_label`
  (frontend no longer has a fixed key set to localize against).
- `routers/visits.py`:
  - `_out()`: drop the 6 `getattr` lines (now flow through the existing
    `custom_field_values` dict / legacy `/custom-fields` sub-resource,
    already returned).
  - `visits_summary` (§2 below): rewritten to be dynamic.
  - `_MIVTZOIM_FLAGS` tuple deleted.
- `routers/contacts.py`: `_MITZVAH_COLUMNS`, the `mitzvot` param and
  `has_mitzvot` currently do `getattr(VisitHistory, col)` against the
  hardcoded columns — this breaks once the columns are dropped. Final split
  (revised once while implementing, after finding real, distinct test
  coverage for each — see below): the named-list `mitzvot` param (AND
  across a caller-given key list) is mechanistically identical to the
  existing generic `custom_fields` param once tefillin etc. are ordinary
  boolean custom fields, so it's removed and folds into `custom_fields`
  (zero frontend callers left once the Contacts page change below lands).
  `has_mitzvot` (ANY active mitzvah checked — a *different* quantifier,
  with its own dedicated passing test, `TestMitzvotFilter` in
  `test_fixes15.py`) is kept and generalized to "any active
  entity_type='visit' boolean custom field is checked" — dropping it would
  have been a silent feature regression, not a cleanup. `connection_to_rebbe`'s
  ilike filter repoints from the dropped column to `CustomFieldValue.value
  ILIKE` (definition scoped to field_key="connection_to_rebbe") — this one
  keeps its own param name since it's a free-text search, not a
  boolean-checked lookup, so it has no existing generic equivalent to fold
  into.
- `field_registry.py`: remove the 5 flag + `connection_to_rebbe`
  `TOGGLEABLE_FIELDS` entries (lines ~105-109, 111). **Keep**
  `visits.torah_thought` (untouched, out of scope). Visibility for the 6
  migrated fields is now controlled the same way "mezuzah" already is —
  `CustomFieldDefinition.is_active` via the custom-fields admin UI, not
  `field_settings`.
- `seed.py`: `_seed_sample_data`'s demo visit (`tefillin=True, tzedakah=True`
  kwargs) switches to `custom_field_utils.set_value(...)` calls after the
  definitions are seeded.

### Frontend code changes
- `lib/types.ts`: remove `MIVTZOIM_FLAGS`/`MivtzoimFlag`, the 6 fields off
  `Visit`; `VisitSummaryCategory.key` becomes `string` and gains
  `hebrew_label`/`english_label`.
- `components/VisitForm.tsx` / `VisitDetails.tsx`: delete the
  flags-state/rebbe-textarea special-case block. The existing generic
  `customFields` (boolean, loaded from `/api/visits/{id}/custom-fields`) and
  `visitCustomFieldDefs` (text/number/date) loops pick the 6 fields up for
  free once seeded — no new rendering code.
- `components/VisitSummary.tsx`: render `cat.hebrew_label`/`english_label`
  (per `lang`) instead of `t(\`visits.${cat.key}\`, cat.key)`; drop the
  `vis(\`visits.${c.key}\`)` filter (server now only returns active defs).
- `app/dashboard/contacts/page.tsx`: `MITZVAH_KEYS`/`CF_PREFIX` split
  collapses — once tefillin etc. are ordinary visit custom fields, they
  arrive through the same `useCustomFieldDefs("visit")` list "mezuzah"
  already uses, so the dedicated `MIVTZOIM_FLAGS` import and the
  `visits.*`-keyed `vis()` checks for these 5 flags are deleted (the
  `cf:`-prefixed generic path already handles everything).

### Tests
81 existing references to these fields/params across 13 test files. Update
call sites to seed/assert via `CustomFieldDefinition`/`CustomFieldValue`
instead of `VisitHistory` kwargs; keep `mitzvot`/`has_mitzvot`/
`connection_to_rebbe` request-level test coverage (same params, new backing
store). Add `test_fixes39.py` for: idempotent seeding (no duplicates across
two `seed_all()` runs), migration data-copy correctness, dynamic breakdown
(admin-added boolean field appears in `/api/visits/summary` automatically).

---

## 2. Dynamic Visit Breakdown

`visits_summary` (`GET /api/visits/summary`) currently loops a hardcoded
5-item tuple. Rewritten to query active `CustomFieldDefinition` rows
(`entity_type="visit"`, `field_type="boolean"`, `is_active=True`,
`order_by(sort_order, id)`), then bulk-fetch matching `CustomFieldValue`
rows (`checked=True`) for the visits in range and group by
`definition_id`. This is a direct consequence of §1 — once the 6 native
flags are custom fields, this endpoint's existing per-key loop just needs
to iterate real rows instead of a fixed tuple, and it automatically also
starts covering any admin-added boolean visit field (e.g. "mezuzah") that
never appeared in the breakdown before. Category labels come from
`hebrew_label`/`english_label` on the definition row (no localization
table lookup needed). `VisitSummary.tsx` update is covered under §1 above
(same component).

---

## 3. Mobile Drag-and-Drop (SortableJS)

### Scope check
Only two chip-reorder UIs exist in the app: the Contacts "Visible columns"
panel and the Apartments "Visible fields" panel
(`frontend/app/dashboard/contacts/page.tsx`,
`frontend/app/dashboard/apartments/page.tsx`) — both flat lists (no nested
containers anywhere in the codebase). The spec's "Nested Structure Snippet"
is reference material for complex layouts in general; there is no nested
list here, so only the core initializer applies to both pages.

### Current implementation (context for the change)
Both pages currently use a hand-rolled Pointer-Events drag hook
(`lib/useChipReorder.ts`) **plus** ▲/▼ arrow buttons as a fallback. That
fallback was added after three separate live-user-report correction rounds
in fixes38: native HTML5 drag-and-drop's `draggable`/`dragstart` never
fires on many Windows trackpads, and even the Pointer-Events rewrite was
reported "intermittent" — see `docker-stale-code-watcher`-adjacent memory
`trackpad-drag-unreliable`. This history is why the arrow buttons stay.

### Change
- `npm install sortablejs @types/sortablejs` in `frontend/`.
- New `frontend/lib/useSortableList.ts`: a small hook wrapping
  `Sortable.create` on a container ref, using exactly the spec's config
  (`animation: 150, ghostClass, chosenClass, dragClass, fallbackTolerance: 3,
  delay: 300, delayOnTouchOnly: true`) **plus `forceFallback: true`** — this
  app's own trackpad already proved native HTML5 DnD unreliable (fixes38),
  and `forceFallback` makes SortableJS use its own pointer/touch simulation
  instead of the browser's native-drag heuristic, which is the actual fix
  for that failure mode (not just a config nicety). `onEnd` computes the new
  order from `evt.oldIndex`/`evt.newIndex` and calls back into the page's
  existing `setColumns`/`setFields`-style state setter (array move) —
  standard, well-established React+SortableJS integration pattern.
- Replace `useChipReorder` usage on both pages' active-chip containers with
  this hook. **Keep the ▲/▼ arrow-button fallback** — per-item, no-gesture,
  already proven to work, cheap insurance given this exact feature's history.
- Delete `lib/useChipReorder.ts` once both call sites are migrated (dead
  code — grep confirms no other usage).

### Verification
Live-drive via the `run` skill / headless browser: emulate a touch/mobile
viewport, perform a real touch-drag (not a synthetic high-level helper) on
both pages' column chips, confirm reorder + persistence; confirm the arrow
buttons still work; confirm desktop mouse drag still works.

---

## 4. Reports Page — permanent Save button

Currently the report-notes textarea has its own small "Save" button
(`PUT /api/organizations/me`), the column-config toolbar (§4.2-4.4 of
fixes38) auto-saves through `useDbPreference`'s 400ms-debounced background
write, and the mode/report-number/apartment **selection** itself
(`mode`, `selectedIds`, `selectedAptIds`) is plain component state — not
persisted at all today, lost on navigation/refresh.

Add one permanent, prominent "Save" button near the top of
`app/dashboard/reports/create/page.tsx` that, on click:
1. Persists `report_notes` (admin-only, same endpoint as today).
2. Forces an immediate (non-debounced) write of the column config
   (`reports.apartmentColumns` preference) instead of waiting on the
   background timer.
3. Persists the current selection (`mode` unless URL-deep-linked into
   "filters" mode, `selectedIds`, `selectedAptIds`) under a new preference
   key `reports.selection`, loaded as the default on the next visit — same
   `useDbPreference` mechanism the column config already uses, extended to
   cover the one remaining unsaved input on the page.
4. Shows a success/error toast, matching every other save action in the app.

This directly satisfies "explicitly persist all data inputs inserted by the
user on the report screen" — today "all data inputs" is actually three
separate/partial mechanisms (one visible button, one invisible debounce, one
that doesn't persist at all); this consolidates them behind one visible,
explicit action while keeping the individual autosaves as-is underneath (no
regression if the user forgets to click Save before generating a PDF).

---

## Order of implementation
1. §1/§2 backend (models → schema → migration → routers → seed) — the
   highest-risk, most interconnected change; verify with `pytest` before
   touching the frontend.
2. §1/§2 frontend (types → VisitForm/VisitDetails/VisitSummary → contacts
   page filter chips) — `tsc --noEmit` clean.
3. §3 SortableJS (independent of §1/§2).
4. §4 Reports save button (independent, smallest).
5. Full backend test suite + `tsc --noEmit` + live docker-compose drive
   covering all four items.
6. Update `docs/fixes39.md` with a `## Status` closeout section per the
   project's spec-closeout rule.
