# Execution Plan: Mekurav, Visits, and Users Fixes

> **CRITICAL DIRECTIVE**: Generate the `plan.md` file before starting any actual code fixes.

---

## 1. Contact_mekurav and visits

### Frontend (Next.js)
- [ ] **Visit Card UI Refactor**:
  - Remove/Cancel the "edit" and "display" links.
  - Only leave the "delete" link.
  - Clicking on a visit title should now expand the visit item.
  - Upon expansion, enable Google-style inline editing (autosave) for that specific visit.
- [ ] **Layout Reorder**:
  - Move the visit display section so it renders directly after the contact info section (and before important dates).
- [ ] **Visit Date Range Filter**:
  - Add a "clear dates" or "no date" option to the filter to allow users to reset the date parameters.
- [ ] **Contact Email CRUD (High Priority)**:
  - Add the missing `Email` field to the Contact Create, Read, Update, and Delete forms in the UI.

### Backend (FastAPI)
- [ ] **Contact Email CRUD (High Priority)**:
  - Ensure the `email` field is fully supported in the database schemas, Pydantic validation models, and API routes for CRUD operations.

---

## 2. Users - Contact_shliach

### Backend (FastAPI)
- [ ] **Restricted User Creation Logic**:
  - When creating a new user, check the user type/role.
  - If the type is "Restricted user", **do not** automatically create an associated `Contact_shliach` record.
- [ ] **Contact_shliach Query Filter**:
  - Update the API endpoint that supplies data for the `Contact_shliach` page to explicitly filter out/exclude users of type "Restricted user".

### Frontend (Next.js)
- [ ] **Contact_shliach Display List**:
  - Ensure the table/list on the `Contact_shliach` page does not display users that are of type "Restricted user".

---

## 3. Show / hide fields: dashboard/custom-fields

### Frontend & Backend Bug Fix
- [ ] **Mivtzoim Filter Visibility Fix**:
  - **The Bug:** When unchecking a field (e.g., `tefillin`) in `/dashboard/custom-fields` to hide it, the field is still appearing in the Mivtzoim filter on the contacts page.
  - **The Fix:** Ensure the contacts page Mivtzoim filter strictly obeys the hidden state from the `custom-fields` settings and completely omits any unchecked fields from rendering.