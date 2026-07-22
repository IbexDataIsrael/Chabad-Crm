# Custom Fields Feature Specification

## Overview
This document outlines the architecture, database schema, and UI requirements for implementing dynamic custom fields across `contact_mekurav`, `contact_shliach`, `Visit`, and `Apartment` entities.
make fixes35-plan.md before sarting to code 

---

## 1. Database Schema & Architecture

### Custom Fields Tables
* **New Custom Fields Tables**: 
  * Create dedicated new tables in the database to hold the custom fields by organization.
  * Utilize existing tables for picklists where applicable.
* **Custom Fields Metadata Table (`custom_fields`)**:
  * Store definitions and configurations for all user-defined custom fields per organization.

| Column | Type | Constraints / Description |
| :--- | :--- | :--- |
| `id` | UUID / SERIAL | Primary Key |
| `org_id` | UUID / INT | Foreign Key to organizations |
| `entity_type` | VARCHAR | Target entity: `contact_mekurav`, `contact_shliach`, `visit`, `apartment` |
| `field_key` | VARCHAR | Programmatic identifier (snake_case) |
| `field_label` | VARCHAR | Display name |
| `field_type` | VARCHAR | Input type: `text`, `number`, `select`, `boolean`, `date` |
| `options_ref` | VARCHAR / INT | Reference to existing tables for picklists / options |
| `is_hidden` | BOOLEAN | Toggle to hide/show field across views (default: `false`) |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |

---

## 2. Navigation & Dashboard Management

* **Menu Location**: 
  * Add a new section under **"More"**.
  * Hebrew Title: **"הוספת שדות מותאמים"** (Add Custom Fields).
* **Dashboard Management (`dashboard/fields`)**:
  * List every added custom field in the **"Manage Field"** section (`dashboard/fields`).
  * Provide an interactive toggle switch for each field to manage its `is_hidden` status dynamically.

---

## 3. CRUD & UI Integration

* **Universal CRUD**:
  * Every added field must appear in every aspect of CRUD operations across all specified entities.
* **Customize Columns**:
  * In Contacts and Apartments, the new fields must appear in the **"Customize Columns"** section.
* **Fast Inline Edit**:
  * In Contacts and Apartments, the new fields must appear in the fast inline edit option.

---

## Checklist for Implementation & Testing

Design decisions and how the literal spec was adapted are recorded in
`docs/fixes35-plan.md` (written first, per the user's instruction — this
was a "build the plan yourself" round, not a literal transcription of the
draft schema).

- [x] §1 Schema — `custom_field_definitions` generalized in place (gained
      `entity_type`, `field_type`, `english_label`; unique constraint moved
      to org+entity+key) and `custom_field_values` generalized (gained
      `organization_id`, `entity_table`, `entity_id`, `value`; `visit_id`
      kept for backward-compat, never dropped). No new tables — `field_type:
      "select"` reuses the existing `PicklistDefinition`/`PicklistValue`/
      `PicklistLink` machinery entirely, per the spec's own "utilize
      existing tables for picklists" instruction. Migration
      `f9a0b1c2d3e4` verified upgrade+downgrade against the real local
      Postgres dev DB, including the org-org_id/entity_table backfill for
      pre-existing Mivtzoim rows.
- [x] §1 `is_hidden` — implemented via the existing `field_settings`
      mechanism (a `customfield.<entity_type>.<field_key>` row per non-select
      definition, entity read directly off the column) rather than a new
      column, so there is exactly one show/hide mechanism app-wide. Verified:
      new custom fields appear on `/dashboard/fields` and toggling
      hides/shows them everywhere.
- [x] §2 Nav — the existing `/dashboard/custom-fields` page (already under
      "עוד") rebuilt: entity/type selectors, inline option list for
      select-type fields, definitions grouped by entity. Nav label renamed
      "שדות מותאמים" → "הוספת שדות מותאמים" via a guarded
      `LOCALIZATION_RENAMES` entry. The old per-page visit-visibility toggle
      block was folded into a link to `/dashboard/fields` (incidental
      cleanup, not scope creep — it duplicated that page).
- [x] §2 Manage Field toggle — covered by the `field_settings` integration
      above; verified live (hide/show a custom field, confirm it
      disappears/reappears everywhere for its entity).
- [x] §3 Universal CRUD — apartment (`ApartmentEditor.tsx` +
      `apartments/[id]/page.tsx`), contact_mekurav (`ContactForm.tsx` +
      `ContactView.tsx`), contact_shliach (same two files — a genuinely new
      capability, including its own `shliach.`-prefixed select-picklist
      convention since contact_shliach had **no** dynamic-field mechanism at
      all before this round), and visit (`VisitForm.tsx` + `VisitDetails.tsx`
      — boolean-type visit fields still ride the pre-existing
      `CustomFieldsEditor` checkbox+note UI unchanged; text/number/date/select
      are new, visit also gained a generic `picklist_values` dict it never
      had before). Verified live per entity via a headless-Chrome drive with
      real clicks (not just visual checks), including DB-level confirmation
      after each save.
- [x] §3 Customize Columns + Fast Inline Edit (Contacts + Apartments) — both
      list pages gained a parallel column-selector + inline-edit path for
      non-select custom fields, alongside the existing custom-*picklist*
      path from the prior round. Verified live: a text field's list-column
      click-to-edit on apartments, and a boolean field's checkbox column on
      contacts — both confirmed to persist via a direct API check after the
      click (not just a DOM read).

---

## Closeout (2026-07-22)

All items above are **DONE**. Verified via: full backend pytest (359/359
passing — 345 pre-existing + 14 new in `backend/tests/test_fixes35.py`),
`tsc --noEmit` + `next build` (both clean), and a headless-Chrome CDP drive
of the real local app (a throwaway registered org, one custom field created
per entity_type/field_type combination, every CRUD surface exercised with
real clicks) against the actual running Postgres-backed dev stack. Nothing
committed or pushed — per standing project rule, that's the user's call.

### Real bugs found and fixed along the way
- **Cross-entity picklist leak**: `ContactForm.tsx`, `ContactView.tsx`, and
  `contacts/page.tsx` each had a pre-existing "everything that isn't
  apartment./visit./checklist./interaction.-prefixed is a mekurav picklist"
  filter (from fixes34). Adding this round's new `shliach.`-prefixed
  contact_shliach select-picklist convention meant those filters started
  silently leaking shliach-only picklists into the mekurav-only loop (and
  vice versa was checked too — confirmed no reverse leak). Caught by
  actually driving the contacts/new (mekurav) creation form and seeing a
  shliach-only field's options rendered on it; fixed by adding the
  `shliach.` exclusion to all three filters.
- **`core/backup.py` / `routers/admin.py` simplification**: both files
  special-cased `CustomFieldValue` specifically because it lacked an
  `organization_id` of its own (unlike `PicklistLink`, which already has
  one and needed no special-casing anywhere). Rather than carrying the
  special-casing forward into three more places, added the column — this
  *removed* code from both files instead of adding to them.
- **Visit definitions leaking into other forms**: `VisitForm.tsx`'s
  "new visit, no id yet" custom-field fetch and `contacts/page.tsx`'s
  Mivtzoim-filter fetch both called the now-multi-entity
  `GET /api/custom-fields` with no `entity_type`/`field_type` filter — would
  have pulled apartment/contact-scoped definitions into visit-only UI.
  Caught by inspection while wiring the new entity_type query param, not by
  drive (no apartment/contact custom fields existed yet at that point in
  the session to make it visible); fixed before it could surface.
- Confirmed (not a bug, but worth recording): the "מקורב חשוב" custom
  boolean field only appeared on the mekurav creation form after explicitly
  turning on `contact_mekurav.section` — this is pre-existing, intentional
  fixes19 §5 behavior (the whole mekurav layout ships hidden by default for
  new orgs), not something this round changed or needs to work around.

### Scope notes
- Apartment bulk-edit (`POST /apartments/bulk-update`) and the version-
  history/restore-field admin views were **not** extended to cover custom
  fields (select or otherwise) — matches their existing behavior for
  fixes32/33's custom picklists, which those surfaces also don't cover.
- The shluchim list page (`dashboard/shluchim`) has no column-customization
  or inline-edit infrastructure today and was **not** given one — the
  spec's §3 column/inline-edit bullets name Contacts and Apartments
  specifically, and a shliach's custom fields are still fully reachable via
  their contact form/view.