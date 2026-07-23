# Feature Specification: Apartments Display & Picklist Overhaul

Implement the following UI/UX enhancements and feature updates for the Apartments view and the Picklist dashboard.
make fixes32-plan.md first
## 1. Apartments Display Page

### Layout & Visibility
* **Grid Expansion:** Expand the width of the main apartments grid to natively display all columns on desktop screens without unnecessary horizontal clipping.

### Inline Editing
Enable inline editing directly within the grid for the following fields:
1. **Apartment number (name)**
2. **Language**
3. **Comments**
4. **Email**
5. **Phone**

### Filtering & Column Controls
* **Language Filter:** Add a new dropdown filter to filter apartments by their assigned language.
* **Filter Toggles:** Add a toggle mechanism to collapse/expand all filters, matching the behavior and UI pattern found on the Contacts page.
* **Column Reordering:** Implement a mechanism allowing users to drag/reorder the grid columns to rearrange their display sequence.

---

## 2. Picklists Dashboard (`dashboard/picklists`)

### Section Separation
* Clear up the visual hierarchy to make a sharp, obvious distinction between the **Contact Picklist** section and the **Apartment Picklist** section.

### Contact Picklist Updates
* Move the current general **"Add Picklist"** section inside the Contacts area.
* Rename this action section to **"Add picklist to contact"**.

### Apartment Picklist Updates
* Create a dedicated new section titled **"Add picklist to apartment"**.
* **Dynamic Integration:** 
  * Any custom picklist added to an apartment must automatically generate a corresponding filter in the Apartments page filter section.
  * These dynamic apartment picklist values must be fully editable inline directly from the main Apartments display grid.

---

## 3. Chat-requested addition: normalized picklist storage (not in the original written spec)

While scoping §2's "Dynamic Integration" bullet, the user asked (in chat, during
this session) to stop storing picklist-backed values as raw text on each
entity's own columns, and instead normalize every picklist-backed field onto
one generic table with a real foreign key to `picklist_values.id`. Full design
in `docs/fixes32-plan.md` §0–§5. Scope confirmed with the user: migrate all 10
existing hardcoded picklist columns (Apartment×4, Contact.pipeline_status/
color_tag, ContactMekurav.potential_next_step, VisitHistory×2,
SignificantDate.special_date_type) plus retire the old contact-only
`contact_picklist_values` table — excluding `contact.contact_type` (structural
type discriminator, not a true picklist) and `interaction.category` (embedded
in a JSON log, not a column). This is what makes §2's dynamic filter/column
requirement work generically for *any* future custom picklist, apartment or
contact, with zero additional code.

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