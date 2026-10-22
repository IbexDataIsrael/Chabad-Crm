/dashboard/tasks
1.	Visual bug: fix filters and options on top of the page, just like “contacts” or “apartments”. Right now, every filter occupies an entire row
2.	Custom fields that are added in /dashboard/picklists are not displayed at all they should appear at
a.	Data grid
b.	Filters
c.	Fields that can be printed
3.	Add the option to customize fields like in “contacts” or “apartments”
4.	Add button “print all displayed tasks”. This button will print multiple tasks according to the based on the tasks displayed on page


Activist registration - welcome email should be sent to activist! - right now not sending
---

## Closeout (2026-10-22), not committed

Verified live on local Docker (backend + frontend + local Postgres, org 1)
with a headless Chromium drive, using throwaway test fields (a task picklist,
boolean / text / select custom fields), removed afterwards.

- [x] 1. Filter layout. Cause: the search box and the "assignment" select had
      both `w-full` and `w-56` / `w-auto`, and `w-full` won, so each took a
      whole row. Filters now use a content-width class in one wrapping row, like
      Contacts/Apartments, with the same "Hide/Show filters" toggle (with an
      active-count badge) and "Clear all filters". Live: status, assignment,
      campaign and the custom-field filters sit on one row; only the search box
      wraps to a second line, as on Contacts.
- [x] 2. Custom task fields. Task custom fields could be defined but had no
      place to store a value (`custom_field_utils` had no `task` storage table),
      and nothing read task picklists. Now: values are stored under
      `entity_table="tasks"`, returned on every task (`picklist_values`,
      `custom_field_values`), saved via `PUT /api/tasks/{id}` (only picklists
      that belong to tasks are accepted), and removed when a task is deleted.
      Covers task picklists from the Picklists page's Tasks tab, select custom
      fields, and text / number / date / checkbox custom fields.
  - [x] a. Data grid: one column per field, inline-editable. Also editable on
        the single task page.
  - [x] b. Filters: picklists = multi-select (with "- (empty)"); checkbox =
        Yes/No; text/number/date = "contains" + "Empty" checkbox
        (`picklist=` / `custom_field_filter=` on `/api/tasks/list`). Live:
        each filter returned only the matching task.
  - [x] c. Printing: the print-settings modal (⚙) has a new "Task fields (top
        of the sheet)" section; the chosen fields print under the sheet title
        (all are on by default). A checkbox prints as Yes/No, because the
        PDF's Hebrew font has no ✓ glyph (found in the live PDF check).
- [x] 3. "Customize columns" button + panel, same as Contacts: click to
      show/hide, drag or ▲/▼ to reorder, "Reset to defaults". Saved per user in
      the DB. Two built-in columns that were missing are also available, off by
      default: custom date and apartment count. Live: hide, show, move and
      reload all held.
- [x] 4. "Print all displayed tasks (N)" button: one PDF with every task on
      the current grid page, in grid order. Each task starts on a new page and
      has its own QR and "page x of y" footer. Tasks with no apartments (text
      tasks) are skipped, and the toast says how many. Live: 7 of 8 tasks →
      `tasks-<date>.pdf`, 14 pages, footers per task were correct.

Tests: `backend/tests/test_fixes104.py` (values round-trip, all filter
kinds, no non-task picklists accepted, delete cleanup). Full backend suite
(in Docker): 719 passed, 1 skipped. Frontend `tsc
--noEmit` is clean.
