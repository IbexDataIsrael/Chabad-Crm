# Execution Plan: Mekurav, Visits, and Custom Fields Fixes

This document details the exact files, database schemas, and API/UI adjustments needed to resolve the reported issues in our FastAPI backend and Next.js frontend.

make fixes27-plan.md before starting
---

## 1. Contact Mekurav & Visits: Filters, Inline Edit, and Email CRUD

**Objective:** Expand the Mivtzoim filter options, implement Google-style inline editing for specific visits, and add the missing email field to contact CRUD.

### Backend (FastAPI)
- [ ] **Dynamic Filter Schemas (`backend/app/schemas/contact.py` or equivalent)**:
  - Update contact filtering/query schemas to support:
    - `torah_thought`
    - `connection_to_rebbe`
    - Dynamic fields fetched from the `custom_field_definitions` SQL table.
- [ ] **Database & Query Logic (`backend/app/api/contacts.py`)**:
  - Update the contact search/filter query generator.
  - Dynamically join and query custom fields based on the active values in the `custom_field_definitions` table.
- [ ] **Pydantic Contact Schemas**:
  - Ensure the `email` field is fully supported in `ContactCreate`, `ContactRead`, and `ContactUpdate` models.

### Frontend (Next.js)
- [ ] **Mivtzoim Filter UI (`frontend/components/filters/...`)**:
  - Add inputs for `torah_thought` (Torah thought) and `connection_to_rebbe`.
  - Fetch custom field definitions dynamically from the backend and render them as filter inputs inside the Mivtzoim filter section.
- [ ] **Inline Editing for Specific Visit**:
  - Integrate the Google-style `InlineEdit` component directly into the visit detail cards.
  - Ensure editing triggers an autosave API call (`PATCH /api/visits/{id}`) on input blur or when pressing `Enter`.
- [ ] **Contact CRUD Email**:
  - Add the `email` field to the Create, Read, and Edit forms for contacts.

---

## 2. Visit Display Layout Update

**Objective:** Merge the "Extra fields" and "Mivtzoim" sections into a single consolidated layout block.

### Frontend (Next.js)
- [ ] **UI Component Refactoring (`frontend/components/visits/...`)**:
  - Locate the rendering layout for visits.
  - Combine all input and display fields from the "Extra fields" section directly into the "Mivtzoim" section.
  - Remove the separate "Extra fields" section heading to streamline the card.

---

## 3. Users Administration & Shliach Status Notices

**Objective:** Track user deletions by email, display a red status notice on the specific deleted Shliach's row, and add a quick button to recreate/re-enable them.

### Backend (FastAPI)
- [ ] **Re-create Shliach Endpoint (`backend/app/api/users.py`)**:
  - Implement a `POST /api/users/recreate` endpoint that accepts the Shliach's email.
  - Action: Check if the user record exists, restore/clear inactive flags, or write a fresh row with the `"shliach"` role in the users table so they reappear on the admin dashboard.

### Frontend (Next.js)
- [ ] **Shliach List Interface (`frontend/pages/dashboard/shluchim/...` or `contact_shliach` view)**:
  - Track whether the Shliach's associated email has a deleted/inactive user record.
  - On the specific row/line of the deleted Shliach, render:
    - A prominent red notice: `הכניסה למערכת הושעתה` (Login disabled).
    - An action button directly next to it: `צור משתמש מחדש` (Re-create user).
  - Bind the button to trigger the `POST /api/users/recreate` backend endpoint and instantly refresh the UI state upon success.

---

## 4. Dashboard Custom Fields Management

**Objective:** Enable administrators to dynamically show or hide visit fields, impacting both visit CRUD forms and contact filter options.

### Backend (FastAPI)
- [ ] **Custom Field Settings Schema & Endpoint (`backend/app/api/custom_fields.py`)**:
  - Expose/update endpoints under `/dashboard/custom-fields` to manage configuration states.
  - Ensure all visit fields are registerable in this settings layout.

### Frontend (Next.js)
- [ ] **Custom Fields Dashboard UI (`frontend/pages/dashboard/custom-fields`)**:
  - Update the settings page to list all default and custom visit fields (e.g., `tefillin`).
  - Render toggle switches to mark fields as hidden or visible.
- [ ] **Conditional Visibility Logic**:
  - **Visit CRUD Display**: If a field (e.g., `tefillin`) is marked hidden, dynamically omit it from being displayed or edited in visit forms.
  - **Contacts Filter UI**: Ensure the same visibility configuration is read by the contacts page; hidden fields must not appear as filter options.