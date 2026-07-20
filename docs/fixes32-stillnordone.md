# Feature Specification: Apartments Display & Picklist Overhaul

these are the things that are not working
make fixes32-stillnotdone-plan.md first
## 1. Apartments Display Page

### Layout & Visibility
* **Grid Expansion:** Expand the width of the main apartments grid to natively display all columns on desktop screens without unnecessary horizontal clipping.


### Column Controls - this was not done 

* **Column Reordering:** Implement a mechanism allowing users to drag/reorder the grid columns to rearrange their display sequence. גרשע שמג גרםפ מםר 'םרלןמע 

---

## 2. Picklists Dashboard (`dashboard/picklists`)



### Apartment Picklist Updates - not done

* **Dynamic Integration:** 
  * the new picklist should be displayed on apartment CRUD!
  
  * These dynamic apartment picklist values must be fully editable inline directly from the main Apartments display grid.

---



---

## Follow-up closeout (2026-07-20, second pass)

Both items above are now genuinely fixed — root causes and full detail in
`docs/fixes32-stillnotdone-plan.md`.

- [x] **Column Reordering** — the drag mechanism itself was already working
      (verified with a real HTML5 drag-event simulation, not a plain
      mouse-move, which doesn't trigger native drag-and-drop at all); the bug
      was that the "התאמת שדות" config panel always rendered its chips in a
      *fixed* order, so a successful drag changed the table but the panel
      itself never visibly moved anything — indistinguishable from "not
      working." Fixed: active chips now render first, in their real current
      order, so dragging one visibly repositions it in the panel too. Also
      added `dataTransfer.setData(...)` on drag-start for cross-browser
      reliability (Firefox in particular can refuse to fire `drop` without
      it). Re-verified with the same drag simulation: panel chip order and
      table header order now change together.
- [x] **Apartment Picklist Dynamic Integration — CRUD forms** — a real gap:
      the list-page grid already had this, but `components/ApartmentEditor.tsx`
      (the shared form behind both Add and Edit) never knew about dynamic
      picklists at all. It now fetches the same `apartment.*` definitions the
      list page does and renders one field per custom picklist, wired into
      the existing `picklist_values` payload — no backend change needed.
      Verified live: created a fresh `apartment.diet` picklist via the
      dashboard, and it appeared on the Add Apartment form immediately.

Verified via: `tsc --noEmit` + `next build` (both clean), headless-Chrome
drive with a real Playwright `dragTo()` (native HTML5 drag events) proving
the panel reorders in sync with the table, and a screenshot of the custom
picklist field rendering on the Add Apartment form. No backend files changed
this round, so the existing 327/327 pytest pass is unaffected. Nothing
committed or pushed.

---

## Closeout (2026-07-20)

Everything below is **DONE**, verified via: full backend pytest (327/327
passing), `tsc --noEmit` + `next build` (both clean, no errors), and a
headless-Chrome drive of the live app (screenshots in the session; no console
errors) exercising every item marked [x]. Nothing was pushed or committed —
per standing project rule, that's the user's call.

### §0 Foundational: normalized picklist storage
- [x] New `picklist_links` table (`organization_id, entity_table, entity_id,
      picklist_definition_id, picklist_value_id`) + Alembic migration
      (`d1e2f3a4b5c6`), data-preserving both directions — verified byte-for-byte
      on a full clone of the real local dev DB (1264 rows migrated, checksums
      matched pre/post round-trip) before being applied to the real local dev DB.
- [x] Apartment versioning preserved: picklist links are copied forward onto
      each new version (`picklist_utils.copy_links`), so per-field history/
      restore still works exactly as before.
- [x] All 10 columns + `contact_picklist_values` migrated; `contact_type` and
      `interaction.category` deliberately excluded (see §3 above).
- [x] Backward-compatible external API — every existing flat JSON field name
      unchanged; only the storage underneath changed.

### §1 Apartments Display Page
- [x] Grid Expansion — `max-w-4xl` removed, table now uses the full dashboard
      width (matches the Contacts page).
- [x] Inline Editing — apartment number (pencil icon beside the existing
      detail-page Link, so navigation isn't disturbed), Language, Comments,
      Email, Phone. Email/Phone reuse the app's existing validation hints.
- [x] Language Filter — new multi-select dropdown, same pattern as the
      existing Jewish-status/mezuzah filters.
- [x] Filter Toggles — collapsible filter section with an active-filter-count
      badge and a "clear all" action, exactly mirroring the Contacts page
      (fixes29 §1) pattern.
- [x] Column Reordering — native HTML5 drag-and-drop on the active column
      chips in "התאמת שדות"; the existing DB-backed `apartments.fields`
      preference now stores order, not just membership (no new preference
      key needed).

### §2 Picklists Dashboard
- [x] Section Separation — a plain neutral card for the Contact section vs. a
      magenta-bordered, tinted card for the Apartment section: sharp, obvious
      visual split (see the screenshot from the drive).
- [x] Contact Picklist Updates — the general "Add Picklist" form now lives
      inside the Contact section, relabeled "הוספת רשימת בחירה לאיש קשר" (Add
      picklist to contact).
- [x] Apartment Picklist Updates — new "הוספת רשימת בחירה לדירה" (Add
      picklist to apartment) section; its `system_name` input is auto-prefixed
      `apartment.` (shown as a fixed `code` chip) so anything added there always
      lands in the apartment group.
- [x] Dynamic Integration — verified end-to-end in the drive: created a brand
      new `apartment.diet` picklist via the dashboard, and it automatically
      appeared as both a filter dropdown and an inline-editable grid column on
      the Apartments page with zero additional code, and round-tripped a value
      correctly through an unrelated apartment-name edit (versioning-safe).

All new Hebrew UI strings have LOCALIZATION seed rows (`app/seed.py`); one
existing string ("כללי" → "אנשי קשר" for the Contact section heading) was
updated via the guarded `LOCALIZATION_RENAMES` mechanism so re-seeding never
clobbers an admin's own customization.

Not pushed/deployed — the local Postgres dev DB has the migration applied and
verified; Neon (prod) has not been touched.