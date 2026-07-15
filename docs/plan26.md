# Execution Plan: Mekurav & Shlichim Portal Fixes

This document details the exact files, database schemas, and API/UI adjustments needed to resolve the reported issues in our FastAPI backend and Next.js frontend.

make fixes26-plan.md before starting 

---

## 1. Global: Report Generation Headers

**Objective:** Add Organization Name and Logo to the header of every page in generated PDF/HTML reports.

### Backend Changes (`backend/app/services/reports.py` or equivalent)
- [ ] **Locate Report Templates**:
  - Find the HTML/CSS or Jinja2 template utilized by the PDF generation library (e.g., Weasyprint, PyPDF2, Playwright).
- [ ] **Inject Header Context**:
  - Ensure the template rendering context receives `organization_name` and `organization_logo` dynamically.
- [ ] **Update CSS Layout Rules**:
  - Configure repeating print headers using CSS paged media rules:
    ```css
    @page {
      @top-center {
        content: element(header);
      }
    }
    ```

---

## 2. Contact Mekurav & Visits Inline Editing & View Modes

**Objective:** Replace separate editing pages with Google-style inline editing (autosave on blur/click-away), add a Read-Only mode for visits, make the phone field optional (validate only if not empty), and add the missing email field.

### Frontend (Next.js)
- [ ] **Visits Read-Only Mode (`frontend/components/visits/...`)**:
  - Add support to open a visit in read-only mode (e.g., via a state flag `isReadOnly` or routing parameter query `?mode=read`).
  - Render plain text components in place of form input fields when active.
- [ ] **Inline Editing Component (`frontend/components/ui/InlineEdit.tsx`)**:
  - Implement a generic inline editing wrapper that:
    - Renders static text by default.
    - Swaps to an active input/edit box on click.
    - Fires an `onSave` event to trigger backend APIs on `onBlur` (clicking away) or pressing `Enter`.
- [ ] **Contact & Visit Detail Screens**:
  - Refactor both the contact detail and visit detail interfaces to use the new inline editing pattern instead of redirecting to a separate edit page.
- [ ] **Form Validation Updates**:
  - Modify validation schemas (Zod, Formik, or React Hook Form):
    - Set the `phone` field as optional. Skip format/regex validation if the field is empty (`""`) or null.
    - Add the missing `email` field to the Create, Read, and Update contact forms.

### Backend (FastAPI)
- [ ] **Schemas (`backend/app/schemas/contact.py` & `visit.py`)**:
  - Set `phone: Optional[str] = None` with custom field validators that only enforce phone-number formatting if input string length is greater than 0.
  - Include `email: Optional[EmailStr] = None` in `ContactCreate`, `ContactRead`, and `ContactUpdate` models.
- [ ] **Endpoints (`backend/app/api/contacts.py`)**:
  - Ensure `PATCH` update endpoints cleanly handle partial updates to support field-by-field autosaving.

---

## 3. Contact Shliach Display

**Objective:** Add the missing email field in the Shliach display interface.

### Frontend (`frontend/components/shliach/...` or `/dashboard/shluchim`)
- [ ] **Add Email field**:
  - Display the Shliach's email address in the main Shliach display data tables and on individual detail cards.

---

## 4. Users Administration &  Hebrew Status Notices

**Objective:** Fix user deletion failure for `mkishon770@gmail.com`, display a red status banner on the Mekurav page when a user's login is disabled, and add a quick button to recreate/re-enable Shliach users.

### Backend (FastAPI)
- [ ] **User Deletion Constraint Resolution (`backend/app/api/users.py`)**:
  - Resolve foreign key constraint violations preventing the deletion of user `mkishon770@gmail.com` (likely stemming from references in `visit` or `contact` tables).
  - Implement a robust soft-delete process (setting `is_active = False`) or nullify foreign key relations before performing the hard delete.
- [ ] **Re-create Shliach Endpoint**:
  - Add a dedicated backend endpoint `POST /api/users/recreate` accepting the contact's email.
  - This endpoint will check for an existing record, clear inactive/deleted flags, or insert a fresh user record assigned with the `"shliach"` role in the users table.

### Frontend (Next.js)
- [ ] **Mekurav Page (`frontend/pages/dashboard/mekurav/...`)**:
  - If the associated user login is deleted/disabled, display a prominent red status notice: 
    ```
    הכניסה למערכת הושעתה
    ```
  - Directly next to this warning, render an action button:
    ```
    צור משתמש מחדש
    ```
  - Wire this button to hit the backend's `POST /api/users/recreate` endpoint, instantly restoring the user and refreshing page state upon success.