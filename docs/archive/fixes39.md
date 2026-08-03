# 📋 Application Updates & Bug Fixes

## 1. Database Schema & Seeding (Mivtzoim Migration)
make fixes39-plan.md before
### 🚨 Critical Constraint
Organisation with `id=1` already contains these values. Ensure the script drops existing custom fields with `entity_type = 'visit'` and recreates them, or implements a conflict-check to ensure data is **never seeded twice**.

### 📉 Step 1: Table Cleanup
Remove the following hardcoded **Mivtzoim fields** from the `visits` table:
1. `tefillin`
2. `tzedakah`
3. `shabbat_candles`
4. `torah_pamphlet`
5. `letter_in_torah`
6. `connection_to_rebbe`

### 🌾 Step 2: Custom Fields Data Seeding
Instead of hardcoded columns, seed custom fields using the existing production database data where:
* `entity_type = 'visit'`
* `organisation_id = 1` (Set as default values for any new organisation created)

---

## 📊 2. Dynamic Visit Breakdown

When displaying visits in the **Single Contact view** or on the **Contacts / Visit-Summary page** (refer to `fixes38.md`), calculate the summary breakdown dynamically:

* **Query Logic:** Dynamically fetch all active custom fields where `entity_type = 'visit'`.
* **Aggregation:** Generate the summary count metrics based on these custom field data sets.
* **Localization:** Display the item names using their respective **Hebrew label / English label** configuration.

---

## 📱 3. Mobile Drag-and-Drop Configuration

### ⚠️ Current Issue
The current drag-and-drop implementation for sorting **Contacts columns** and **Apartments** looks broken and messy on mobile viewports. Because the target users primarily access the application via mobile devices, this requires a mobile-first overhaul.

### 🛠️ Solution Implementation
Integrate the **SortableJS** library to handle reordering seamlessly on touch screens. 

#### Core JS Initializer Snippet
```javascript
// Example implementation for standard lists/columns
new Sortable(columnsContainer, {
    animation: 150,
    ghostClass: 'sortable-ghost',   // Class name for the drop placeholder
    chosenClass: 'sortable-chosen',  // Class name for the chosen item
    dragClass: 'sortable-drag',      // Class name for the dragging item
    fallbackTolerance: 3,            // Allows for minor finger movement before triggering drag (crucial for mobile)
    delay: 300,                      // 300ms long-press delay to prevent accidental dragging while scrolling
    delayOnTouchOnly: true           // Apply long-press delay restriction exclusively to mobile/touch screens
});
```

#### Nested Structure Snippet (For Complex Layouts / Apartments)
When handling nested sortable blocks, apply these configuration properties to prevent layout breaking:
```javascript
new Sortable(nestedApartmentContainer, {
    group: 'nested',
    animation: 150,
    fallbackOnBody: true,    // Appends the cloned DOM element to the body during drag to prevent container clipping
    swapThreshold: 0.65      // Lower threshold allows for easier item evaluation on tight mobile viewports
});
```

---

## 📈 4. Reports Page Update

* **Feature Request:** Add a permanent **"Save" button** directly to the report page.
* **Behavior:** Clicking this button must explicitly persist all data inputs inserted by the user on the report screen.

---

## Status: DONE (2026-07-31, uncommitted)

Plan: `docs/fixes39-plan.md`. One new Alembic migration (`c2d3e4f5a6b7`),
already applied to the local dev Postgres DB (backend auto-runs `alembic
upgrade head` on boot) — a full pre-migration backup was taken first
(`backend/backups/fixes38_full_backup_20260731_060459.json`, 31 tables /
7385 rows).

- [x] **§1 Mivtzoim → real custom fields** — `visit_history` lost its 6
      hardcoded columns (tefillin/tzedakah/shabbat_candles/torah_pamphlet/
      letter_in_torah/connection_to_rebbe); they're ordinary
      `entity_type="visit"` custom fields now (5 boolean, 1 text), the same
      mechanism org-added checklist items ("mezuzah") already used —
      **zero new frontend rendering code was needed** for them, they fall
      straight into the existing generic checkbox/note and text/number/date
      loops. New idempotent `seed_visit_mivtzoim_custom_fields` (backend/app/
      seed.py) wired into both `provision_org` (new orgs) and `seed_all`'s
      existing per-org boot-time backfill loop (reaches every existing org,
      including the demo org — matches `seed_picklist_definitions`'s own
      pattern). Migration `c2d3e4f5a6b7`: creates the 6 definitions per org
      (conflict-checked, never duplicated — verified 252 rows = 42 orgs x 6
      on the local dev DB, matching exactly), copies only truthy
      boolean/non-empty-text values into `custom_field_values` (38 rows
      migrated from 75 existing visits), then drops the columns. Old
      `mitzvot` contacts-filter param folded into the already-generic
      `custom_fields` param (mechanistically identical once these are
      ordinary custom fields); `has_mitzvot` kept and generalized to "any
      active boolean visit custom field checked" (real, distinct
      ANY-vs-ALL-semantics test coverage existed for it — dropping it would
      have been a silent regression, not a cleanup, caught and reverted
      mid-implementation). `connection_to_rebbe`'s contains-filter repoints
      to `CustomFieldValue.value ILIKE`.
- [x] **§2 Dynamic Visit Breakdown** — `GET /api/visits/summary` now queries
      active boolean `entity_type="visit"` custom fields dynamically instead
      of a fixed 5-key tuple; category labels ride the definition's own
      `hebrew_label`/`english_label` (no localization-table lookup needed).
      Live-verified: an admin-added "Purim party" checklist item showed up
      in the breakdown automatically, alongside the migrated fields —
      something the old hardcoded-tuple endpoint could never do.
- [x] **§3 Mobile Drag-and-Drop (SortableJS)** — `npm install sortablejs
      @types/sortablejs`; new `frontend/lib/useSortableList.ts` replaces
      `lib/useChipReorder.ts` (deleted) on both Contacts' and Apartments'
      "visible columns/fields" panels. Kept the ▲/▼ arrow-button fallback
      from fixes38 (proven, no-gesture, cheap insurance given this exact
      feature's three-round history). Caught and fixed two real bugs during
      live verification, not assumption: (1) a `display:contents` wrapper —
      used so a "some chips aren't draggable" sub-list could flow inline
      with its plain siblings — collapses to an empty `getBoundingClientRect()`
      and silently kills Sortable's hit-testing with no error at all;
      fixed by using one real container for every chip and Sortable's own
      `filter`/`data-sortable-disabled` to mark non-draggable ones instead.
      (2) the panel is conditionally rendered (starts closed), so a plain
      `useRef` + `useEffect([])` captured a stale `null` on first mount and
      never re-attached once the panel opened — fixed with a callback ref
      (`useState` + ref-as-setter) instead. Live-verified after both fixes:
      real desktop mouse drag on both pages (with reload-persistence
      confirmed), and a real touch drag via CDP `Input.dispatchTouchEvent`
      (trusted-level, not a synthetic DOM event) on a 390x844 mobile
      viewport — `sortable-ghost`/`sortable-chosen` classes appear and the
      reorder lands and persists.
- [x] **§4 Reports Page Save button** — one permanent, prominent "Save"
      button next to the page title in `app/dashboard/reports/create/page.tsx`,
      replacing the old notes-only small Save button. Persists report notes
      (admin-only), forces an immediate non-debounced write of the column
      config, and — new — persists the previously-unsaved source-mode/
      selected-report-numbers/selected-apartments under a `reports.selection`
      preference (same `useDbPreference` mechanism the column config already
      used), restored as the default next visit (deep-link `?from=
      apartments-filtered` still always overrides `mode`, never gets
      overwritten by it). Live-verified: changed the notes text and a column
      width, clicked Save, saw the success toast, reloaded the page — both
      values were still there.
- [x] Backend: 375/375 pytest passing (370 pre-existing + 5 new in
      `backend/tests/test_fixes39.py`: idempotent seeding — never duplicates
      across repeated runs, reactivates a deactivated field without
      duplicating, doesn't cross-contaminate an unrelated entity_type with
      the same field_key — plus `provision_org` wiring). ~80 references to
      the removed columns/params across 13 existing test files updated to
      go through the custom-field endpoints instead (not deleted — ported
      to exercise the same behavior against the new storage).
- [x] Frontend: `tsc --noEmit` clean.
- [x] Live verification: full docker-compose stack (Postgres + backend +
      frontend), driven end-to-end via a real headless-Chrome CDP session
      (playwright-core connected over `connectOverCDP`, since `chromium-cli`
      wasn't available in this environment) — logged in as the demo admin
      and checked, against the actual running app, not just unit tests:
      the visit form/detail cards render the migrated fields correctly
      (screenshotted), the Visit Summary section's dynamic breakdown
      (screenshotted, includes the demo org's pre-existing custom field),
      the contacts mitzvah filter dropdown has no duplicate entries, both
      pages' drag-and-drop (mouse + real touch) and arrow-button fallback,
      and the Reports page Save button's cross-reload persistence.

**Not done:** not committed/pushed (standing rule: only on explicit ask); not
deployed (Neon/Render — per project notes, several fixes rounds already
behind, should ship in the same batch); the Neon **production** database
still has the 6 old hardcoded columns and the legacy duplicate custom-field
rows fixes38 deactivated (`tfilin`/`nerot`/`alon`/`ot`/`Kesher_Larabi`/
`dvar_torah`) — this round's migration only ran against the local dev DB;
running it against Neon needs the same pre-migration backup discipline
before deploy.
