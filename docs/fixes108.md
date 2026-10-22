# fixes108 — tasks: not all fields shown in CRUD

Status: **done locally — not committed, not pushed.**

## Request (2026-10-23)
> tasks is still not working properly! not all fields are displayed in CRUD. the insert new task does not have all custom fields appear on insert. on the other hand - task.custom_date is on insert but not on display of all fields

## Causes
1. **New-task form had no custom fields.** `TaskQuickCreateForm` hard-coded the built-in fields only. It never loaded the org's task picklists and custom fields (fixes104 added them to the list, detail page and filters, but not to create). The backend `TaskCreate` / `TaskBulkCreate` schemas couldn't accept them either.
2. **`task.custom_date` missing from the Fields page.** It is a *system* picklist. The Fields page lists only non-system picklists plus the static `field_registry.TOGGLEABLE_FIELDS`, and it wasn't in that registry, so the Tasks tab never showed it.
3. **`custom_date` hidden by default in the tasks grid** (`DEFAULT_HIDDEN_COLUMNS`).

## Changes
- [x] `backend/app/schemas.py`: `TaskCreate` + `TaskBulkCreate` accept `picklist_values` / `custom_field_values`.
- [x] `backend/app/routers/tasks.py`: `create_task` and `create_bulk_tasks` call `_apply_custom_values` (same task-only picklist guard as update; bulk applies to every created task).
- [x] `backend/app/field_registry.py`: `("task.custom_date", "task.custom_date", "task")` registered, so it's on the Fields page Tasks tab and can be hidden.
- [x] `frontend/components/TaskQuickCreateForm.tsx`: renders every org task field (picklist → `PicklistSelect`, other → `CustomFieldValueInput`) and sends only filled values. The custom-date field follows the Fields-page toggle.
- [x] `frontend/app/dashboard/tasks/page.tsx`: `custom_date` now visible by default. Hiding it on the Fields page removes the column.
- [x] `frontend/app/dashboard/tasks/[id]/page.tsx`: custom-date row follows the Fields-page toggle.

## Evidence
- `backend/tests/test_fixes108.py`: create with values, foreign picklist rejected (400), bulk create sets values on every task, `task.custom_date` listed + toggleable. Run together with fixes104/74/50/20: **36 passed**.
- `tsc --noEmit`: clean.
- Live drive (headless Chromium, local stack, admin of org 1): temp text custom field added. The New-task form listed `Activist, Campaign, Report numbers, Custom date, <custom field>, Status`. The form was filled in and saved, and the API returned the typed value on the new task. The temp field and task were removed afterwards.

## Note
A user who already saved a column layout keeps it. The default change only affects users who never customized columns. Local admin (user 1) has `custom_date` in their saved `tasks.hiddenColumns`, which is what the old default saved. Turn it back on via **Customize columns**.
