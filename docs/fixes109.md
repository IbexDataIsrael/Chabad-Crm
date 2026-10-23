Task 
When adding new task:
Add date time 
Display date time
BUG - “Report numbers” are always selected (by the tasks that are already taken). The report numbers should not appear as “checked” but should be “disabled”, and the user should not be able to select them
Enable sorting by date and by every field that is displayed

---

# Closeout

Status: **done, committed f46d5b7 — not pushed.** New migration `109a7c3e2d41` (adds `tasks.scheduled_at`). Already applied to local Postgres; prod needs `alembic upgrade head` on deploy.

## 1. Date & time when adding a task — [x] done
- `tasks.scheduled_at` (nullable DateTime) added in `models.py` + migration `109a7c3e2d41_fixes109_task_scheduled_at.py`. Stored as the wall-clock time the admin typed, with no timezone shift.
- `TaskCreate` / `TaskBulkCreate` / `TaskUpdate` / `TaskOut` carry `scheduled_at`. Create, bulk create (every task) and edit set it, and an edit that doesn't mention it leaves it alone.
- New-task form (`TaskQuickCreateForm`): a **תאריך ושעה / Date & time** `datetime-local` input.
- Localization: `task.scheduled_at` seed row (he + en).

## 2. Display date & time — [x] done
- Tasks grid: new **Date & time** column (inline-editable) shown as `dd.mm.yyyy, hh:mm`. The **Created** column now shows the time too: it used to show the date only, and it now converts from UTC to local time correctly.
- Task page: **Date & time** row, inline-editable.
- Helpers in `frontend/lib/taskDateTime.ts` (server-UTC vs wall-clock formatting).

## 3. BUG — taken report numbers showed as checked — [x] fixed
- `MultiSelectSearchFilter` (its `lockedIds` prop is used only by the new-task form): a locked option is now **unchecked + disabled** (dimmed, "Already in a task" hint) and can't be toggled. It's no longer counted in the trigger summary ("N selected") or highlight, and it sorts to the end of the list instead of the top.
- The hint text under the picker was reworded ("…are disabled and can't be picked") via the seed + a guarded `LOCALIZATION_RENAMES` entry for already-seeded DBs (verified updated on local Postgres after restart).

## 4. Sort by date and by every displayed column — [x] done
- `GET /api/tasks/list?sort=` now accepts every grid column: `id`, `volunteer_name`, `campaign`, `report_number`, `status` (workflow order), `report_status`, `report_notes` (the task's own latest report, same rule as the display), `custom_date` (option order), `scheduled_at`, `apartment_count`, `created_at`, plus `pl:<field_key>` / `cf:<field_key>` custom task fields (number fields sort numerically). Blank values sort last in both directions, and the task id breaks ties so pages stay stable. An unknown or stale key falls back to the creation date instead of erroring. Implemented in `routers/tasks.py::_apply_task_sort`.
- Frontend: every column header, including **Task #** and custom-field columns, is a sort button with the dim inactive arrow (fixes54 rule).

## Evidence
- `backend/tests/test_fixes109.py`: create/update/bulk/clear `scheduled_at`; every sort key × asc/desc returns 200; asserted orders for id, scheduled_at, status, picklist, text custom field, blanks-last boolean, campaign. With fixes108/104/74/75/98: **82 passed** (SQLite).
- Real Postgres (local backend): all 14 sort keys × 2 directions → 200 (correlated subqueries + `NULLS LAST`).
- `tsc --noEmit`: clean.
- Live headless-Chromium drive on the local stack (admin, org 1), clicking the real UI:
  - Clicking **Task #** sorted ascending (28…56), then descending. **Date & time** is a sort header.
  - New task with campaign `Campaign58-196559`: report number **34** (already in task #44) was unchecked and disabled, clicking it did nothing, and the summary read "No report numbers selected". Free number **2** could be checked.
  - Typed `2026-11-05T18:30` and saved. The API returned `scheduled_at = 2026-11-05T18:30:00` and only report number 2.
  - The list row showed `05.11.2026, 18:30`, and sorting by Date & time put it first. The task page showed the date & time.
  - The test task was deleted afterwards.

## Not done / notes
- The activist-facing screens (street2, task print sheet) don't show the new date & time. The spec only covered the admin add/display flow. Say if activists should see it too.
- Applies to prod only after the migration runs.
