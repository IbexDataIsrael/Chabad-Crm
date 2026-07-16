# Execution Plan: Mekurav, Visits, and Users Fixes

> **Status 2026-07-16:** all items below implemented (91cd57e) and verified
> live on production after hotfix 5c66d3e (the first Vercel deploy of this
> round failed its build (a leftover `case "email"` type error) so prod
> briefly kept serving fixes27). Nothing in this spec was skipped.

> **CRITICAL DIRECTIVE**: Generate the `plan.md` file before starting any actual code fixes.

---

## 1. Contact_mekurav and visits

### Frontend (Next.js)
- [x] **Visit Card UI Refactor**:
  - Remove/Cancel the "edit" and "display" links.
  - Only leave the "delete" link.
  - Clicking on a visit title should now expand the visit item.
  - Upon expansion, enable Google-style inline editing (autosave) for that specific visit.
- [x] **Layout Reorder**:
  - Move the visit display section so it renders directly after the contact info section (and before important dates).
- [x] **Visit Date Range Filter**:
  - Add a "clear dates" or "no date" option to the filter to allow users to reset the date parameters.
- [x] **Contact Email CRUD (High Priority)**:
  - Add the missing `Email` field to the Contact Create, Read, Update, and Delete forms in the UI.

### Backend (FastAPI)
- [x] **Contact Email CRUD (High Priority)**:
  - Ensure the `email` field is fully supported in the database schemas, Pydantic validation models, and API routes for CRUD operations.

---

## 2. Users - Contact_shliach

### Backend (FastAPI)
- [x] **Restricted User Creation Logic**:
  - When creating a new user, check the user type/role.
  - If the type is "Restricted user", **do not** automatically create an associated `Contact_shliach` record.
- [x] **Contact_shliach Query Filter**:
  - Update the API endpoint that supplies data for the `Contact_shliach` page to explicitly filter out/exclude users of type "Restricted user".

### Frontend (Next.js)
- [x] **Contact_shliach Display List**:
  - Ensure the table/list on the `Contact_shliach` page does not display users that are of type "Restricted user".

---

## 3. Show / hide fields: dashboard/custom-fields

### Frontend & Backend Bug Fix
- [x] **Mivtzoim Filter Visibility Fix**:
  - **The Bug:** When unchecking a field (e.g., `tefillin`) in `/dashboard/custom-fields` to hide it, the field is still appearing in the Mivtzoim filter on the contacts page.
  - **The Fix:** Ensure the contacts page Mivtzoim filter strictly obeys the hidden state from the `custom-fields` settings and completely omits any unchecked fields from rendering.