/# Bug Fix Task: Contact Details View (`Contact_mekurav`)

## Context & Target
- **Route / Page:** `http://localhost:3001/dashboard/contacts/[id]` (e.g., `/dashboard/contacts/222`)
- **Entity:** `Contact_mekurav`
make fixes36-plan.md before
---

## Issues to Resolve

### 1. Duplicate Field Removal: `Contact Type`
- **Issue:** The field **"Contact Type"** is currently rendered twice in the UI for a single contact record.
- **Action Required:** 
  - Locate the component rendering core contact fields (e.g., contact detail card / form section).
  - Remove the redundant rendering instance so "Contact Type" appears **only once**.

### 2. Field Dissociation: `Date Type`
- **Issue:** The field **"Date type"** is being displayed on the `Contact_mekurav` page, but it does not belong to this entity model.
- **Action Required:**
  - Remove the "Date type" field display from the core fields section of `Contact_mekurav`.
  - Ensure the underlying TypeScript interface/schema for `Contact_mekurav` presentation props does not expect or require `Date type`.

---

## Expected Outcome
- The contact detail view displays clean core fields with no duplicate labels.
- The "Date type" field is completely detached from the `Contact_mekurav` detail interface.

---

## Status: DONE (2026-07-23, uncommitted)

Plan: `docs/fixes36-plan.md`.

**Root cause (one bug, both symptoms):** `ContactView.tsx`'s "admin-added
custom contact picklist" fallthrough (`customDefs`, gated by
`FIXED_CONTACT_PICKLIST_KEYS` + a handful of foreign-entity prefix
exclusions) treated any `/api/picklists` definition not explicitly excluded
as a generic contact field to auto-render. Two registered picklist_defs slipped
through: `contact.contact_type` (already has its own dedicated static row →
duplicate "Contact Type") and `significant_date.type` (belongs to the
`significant_dates` entity, already rendered correctly inside
`SignificantDatesEditor` → bogus "Date type" row on the contact). The same
filter is duplicated verbatim in `ContactForm.tsx` and `contacts/page.tsx`.

- [x] §1 Duplicate "Contact Type" removed — added `"contact.contact_type"` to
      `FIXED_CONTACT_PICKLIST_KEYS` (`frontend/lib/picklists.ts`), the single
      shared source for all three `customDefs` filters.
- [x] §2 "Date type" detached from `Contact_mekurav` — added
      `!d.field_key.startsWith("significant_date.")` to the same three
      `customDefs`/`customPicklistDefs` filters (`ContactView.tsx`,
      `ContactForm.tsx`, `contacts/page.tsx`), matching the existing
      `apartment./visit./checklist./interaction./shliach.` exclusion pattern.

**Evidence:** `tsc --noEmit` clean in the frontend container. Live CDP
headless-Chrome drive against a throwaway org+mekurav contact with both
`contact.contact_type` and `significant_date.type` picklist_defs registered
(reproducing the conditions org 1 already has): pre-fix DOM had 21 `<dt>`
field rows including a duplicate contact-type row and a "Date type" row;
post-fix DOM has exactly 19 rows, "סוג איש קשר" appears exactly once, no
"Date type"/"סוג תאריך" row anywhere. Bug reproduced-then-fixed on the same
drive script, not just an after-the-fact screenshot.