# Technical Specifications & Action Plan

Please implement the following updates across the Contacts, Reports, Users, Single User, and Roles management modules.
make plan first!
---

## 1. Contacts Module (`dashboard/contacts`)

* **Inline Editing for "Assigned To":**
  * Enable inline editing for the **"Assigned To"** field directly on the main contacts list page as well as the detailed edit view/page.
* **Bulk Edit "Assigned To":**
  * Add a **Bulk Edit** button/action for the **"Assigned To"** field.
  * The bulk update must apply to all records matching the **currently applied filter criteria**.

**STATUS: DONE.** Detail-page inline edit already existed (`ContactView.tsx`); added
list-page inline edit (`owner` column, `frontend/app/dashboard/contacts/page.tsx`)
and a new "עריכה מרובה" bulk-edit modal + `POST /api/contacts/bulk-update`
(filter-scoped, mirrors the Apartments bulk-update pattern). 5 backend tests
(`TestContactsBulkUpdate` in `backend/tests/test_fixes43.py`), tsc clean,
live browser-verified (inline `<select>` opens on click, bulk modal applies to
the filtered set and reports an updated count).

---

## 2. Reports Module (`dashboard/reports`)

* **Row Styling Distinction:**
  * Style **Row 2** with a light grey background (`#f5f5f5` / `bg-gray-100`) distinct from **Row 1** to improve visual separation and clarity.

**STATUS: DONE.** Clarified: "Row 2" means the 2nd row of the **generated PDF
report table** (jspdf-autotable), not any page UI. Added
`alternateRowStyles: { fillColor: [245, 245, 245] }` to the `autoTable(...)`
call in `dashboard/reports/create/page.tsx` — jspdf-autotable's built-in
zebra-stripe mechanism, which shades every 2nd body row (Row 2, Row 4, …)
`#f5f5f5`, leaving Row 1 white. tsc clean.

---

## 3. Users Module (`dashboard/users`)

1. **Edit History Audit Trail:**
   * Implement edit history logging for the Users table using the exact same structure, storage, and UI pattern established in the **Apartments** module.
2. **Role Transition Fix:**
   * Fix the issue preventing users with the role `"restricted user"` from being updated/promoted to `"system admin"`.
3. **Table Action Column Clean-Up:**
   * Remove the duplicate `"edit"` column; retain only the unified `"open / edit"` action column.
4. **"Clear Assignments" Button ("ניקוי שיבוצים"):**
   * Add a button labeled **"ניקוי שיבוצים"** ("Clear Assignments").
   * **Action:** Clears/removes the `"area"` assignment from all users included in the **current page filter view**.
   * **Confirmation Dialog / Toast:** Before executing, prompt the user with a confirmation dialog/toast with the exact message:
     > *"אתה בטוח שברצונך למחוק את כל השיבוצים של הפעילים? פעולה זו בלתי הפיכה"*
     > *(English translation: "Are you sure you want to delete all active placements? This action is irreversible.")*

**STATUS:**
1. **DONE — scope changed to `contact_shliach` data only, per explicit user
   direction mid-round.** Literal apartments-style row-versioning was not
   safe for `users` (unique email/guid, FK'd from everywhere) nor for
   `contact_shliach` as originally scoped by the spec (`contact_id` is
   unique/1:1, and `contact.shliach` is read across dozens of call sites —
   versioning it would force `is_display` filters everywhere). Implemented
   instead as a field-level audit log (`contact_shliach_edit_history` table:
   field, old_value, new_value, editor, timestamp) covering
   notes/area_ids/report_number_ids, with an admin-only read-only history
   list on the shliach's contact page (`GET
   /api/contacts/{id}/shliach-history`). No "restore" action (that's a
   materially different, larger feature than an audit trail — flagging as
   explicitly out of scope for this round, not silently dropped). 3 backend
   tests (`TestShliachEditHistory`), tsc clean, live browser-verified.
2. **DONE — no code bug existed.** Investigated thoroughly: `staff → admin`
   promotion already worked (`test_fixes7.py::test_role_change_and_self_guard`
   predates this round and still passes). The "restricted user → system
   admin" framing was about the **label**, confirmed with the user during
   this round — resolved via item 5 below (role relabeled to "מנהל
   מערכת"/"System admin"). Re-verified the promotion still works against the
   new FK-backed role storage.
3. **DONE — merged, per user direction.** The Users table's two actions
   ("פתח / עריכה" → the linked contact page, "ערוך" → an inline User form
   for role/email/password) are now one "פתח / עריכה" action per row: for
   a real user account it opens the inline form (`UserForm`), which itself
   now carries a "צפייה באיש הקשר ›" link to the linked contact when one
   exists; a contact-only row (login deleted, no `User` row) still just
   links straight to the contact page, since there's nothing else to edit
   there. Live browser-verified (single action for both linked and
   unlinked rows; the form's contact link only appears when a contact is
   linked).
4. **DONE.** "ניקוי שיבוצים" button added to the Users toolbar; confirms
   with the exact spec'd Hebrew message via the existing `ConfirmModal`
   (`useConfirm()`), then clears `ContactShliachArea` links for every
   shliach row in the current filtered view (role/area/building/inactive
   filters — not just the current page slice, matching the "everything
   currently matching the filters" convention the apartments/contacts bulk
   endpoints already established). New admin-only `POST
   /api/contacts/shliach/clear-areas`. 2 backend tests, tsc clean, live
   browser-verified (confirm dialog shows the exact spec'd text).

---

## 4. Single User Detail (`dashboard/contacts/[id]` or `dashboard/users/[id]`)

1. **Multi-Select Dropdown with Search:**
   * Convert the selection UI for **Area** and **Report Number** into multi-select dropdowns with top search functionality (matching the implementation of the **"Buildings"** filter on the Contacts page).
2. **Area Reassignment Conflict Warning:**
   * When selecting an **Area** already assigned to another user, display a warning toast:
     > *"האזור הזה משוייך לפעיל אחר, האם ברצונך לשייך כאן פעיל נוסף?"*
     > *(English: "This area is assigned to another operator. Do you want to assign another operator here?")*
3. **Report Number Reassignment Conflict Warning:**
   * When selecting a **Report Number** already assigned to another user, display a warning toast:
     > *"מספר דוח הזה משוייך לפעיל אחר, האם ברצונך לשייך כאן פעיל נוסף?"*
     > *(English: "This report number is assigned to another operator. Do you want to assign another operator here?")*
4. **Execution Logic:**
   * Proceed with assigning the Area or Report Number **only if the user explicitly confirms ("Yes")** in the warning toast/modal.

**STATUS: DONE** (there is no separate `dashboard/users/[id]` route — the
"single user detail" surface for a shliach is the contact detail page,
`ContactView.tsx`, which already had Area/Report Number fields; §4.1's "Report
Number... needs to be added" premise was already-partly-built, confirmed and
extended rather than duplicated).
1. `AreaMultiSelect`/`ReportNumberMultiSelect` now render `MultiSelectSearchFilter`
   (the same searchable-dropdown component the Apartments page's Buildings/Report
   Number filters use — the Contacts page's own "Buildings" filter actually uses
   the older `MultiSelectFilter`, noted and used the more accurate reference).
2. + 3. New backend lookups (`GET /api/areas/shliach-assignments`, `GET
   /api/report-numbers/shliach-assignments`, one query each, grouped by
   id) feed a client-side conflict check; selecting an already-covered
   area/report-number shows a **confirm modal** (`useConfirm()`/`ConfirmModal`)
   with the exact spec'd message — the toast system has no Yes/No affordance
   today, so a modal was used to deliver the same "gate on explicit
   confirmation" behavior the spec asks for.
4. Confirmed: the selection change is only applied (`onChange`) if the user
   picks "אישור" in the confirm modal; "ביטול" leaves the prior selection
   untouched.

2 backend tests (`TestShliachAssignmentLookups`), tsc clean, live
browser-verified (searchable dropdown opens with a working search box;
selecting an area already assigned to another shliach shows the exact
spec'd warning text).

---

## 5. Roles & Permissions System

1. **Database Refactoring:**
   * Extract roles into a dedicated SQL table (e.g., `roles`) with foreign key relationships instead of using flat strings/enums where applicable.
2. **Localization / Translation Support:**
   * Add internationalization/translation mapping for role names based on active locale (e.g., `"מנהל מערכת"` maps to `"system admin"` in the English UI, with appropriate translations for all other roles).

**STATUS: DONE.**
1. New `roles` table (`name` PK, `sort_order`), seeded with
   `admin`/`staff`/`shliach`/`superadmin`. `users.role` is now a real FK to
   `roles.name` (was a flat, unconstrained string) — chosen over a
   surrogate-id + Python-property redesign to keep the change low-risk: the
   stored values and every existing `current_user.role == "..."` comparison
   across the app (~50+ call sites, 12 files) are unchanged, only now
   DB-validated. Migration `1a2b3c4d5e6f` (backfills + adds the FK
   constraint against the live local Postgres data with zero conflicts).
2. The `admin` role's label changed from "מנהל"/"Admin" to "מנהל
   מערכת"/"System admin" (`users.role_admin` in `field_localization`, via a
   `LOCALIZATION_RENAMES` entry so already-seeded DB rows pick up the new
   text, not just fresh installs) — confirmed with the user mid-round
   ("is 'admin' my mistake" exchange). `staff`("משתמש מוגבל"/"Restricted
   user") and `shliach` labels are unchanged; both were already
   locale-mapped via the existing `field_localization` mechanism (no new
   translation infrastructure needed — it already exists project-wide).

3 backend tests (`TestRolesTable`), tsc clean.

---

## Not deployed

All 9 items are DONE. Nothing in this round has been committed or pushed
(per rule: no commit/push unasked) — migrations were applied to the local
dev Postgres only. 430/430 backend tests pass (`backend/tests/test_fixes43.py`
has 15 new tests for this round). Frontend `tsc --noEmit` clean throughout.
Every UI-facing item was verified live via a headless-Chrome CDP drive
against a throwaway org, not just typechecked/unit-tested.
