# fixes16 — Implementation Plan (Backup & Restore buttons)

Source spec: `docs/fixes16.md`.

## Backend

1. **Model `OrgBackup`** (`org_backups` table): id, guid, organization_id
   (FK, indexed), `created_by_name` (denormalized — survives user deletion),
   `note`, `kind` ('manual' | 'auto'), `counts` (JSON text summary),
   `data` (LargeBinary — zlib-compressed JSON snapshot), created_at.
   Alembic migration `e1f2a3b4c5d6_fixes16_org_backups` (head after
   `d0e1f2a3b4c5`); migrations already run on startup.
2. **Snapshot engine** (`backend/app/core/backup.py`):
   - `SNAPSHOT_MODELS`: the org-scoped CRM models in parent→child insert
     order — Area, AdminArea, Building, Floor, Apartment, Contact,
     ContactMekurav, ContactShliach, ContactShliachApartment,
     ContactShliachArea, CommunityChecklist*, CustomFieldDefinition,
     CustomFieldValue*, SignificantDate, ContactMekuravSpecialDate,
     SignificantDateReminder, VisitHistory, Donation, Interaction,
     PicklistDefinition, PicklistValue, ContactPicklistValue, FieldSetting.
     (* = no organization_id column; scoped via the org's contact ids.)
     Users / Organization / access log / email templates are NOT included.
   - `create_snapshot(db, org_id)` → dict keyed by tablename; every column
     serialized generically (datetime/date/time → ISO strings).
   - `restore_snapshot(db, org_id, snapshot, current_admin)`: inside the
     caller's transaction — delete the org's rows (reverse order), re-insert
     snapshot rows **with their original ids** (safe: ids are never reused,
     sequences are already past them), parsing ISO strings back by column
     type. Broken user links are repaired: `contacts.assigned_user_id` /
     `contact_shliach.user_id` → NULL when the user no longer exists;
     `interactions.created_by` (NOT NULL) → reassigned to the restoring
     admin.
   - Retention constant `BACKUP_RETENTION = 10`: after every insert, prune
     the org's oldest backups beyond the limit.
3. **Router** `backend/app/routers/backups.py` (`/api/backups`,
   `require_admin`, org-scoped):
   - `GET ""` — list restore points (no blobs).
   - `POST ""` `{note?}` — create a manual restore point.
   - `POST /{id}/restore` — auto safety snapshot ("אוטומטי — לפני שחזור",
     kind 'auto') + full restore, one transaction.
   - `GET /{id}/download` — the snapshot as a pretty JSON attachment.
   - Backup/restore events also appended to `system_access_logs`
     (status `BACKUP_CREATED` / `BACKUP_RESTORED`).
4. **Seed**: localization rows for all backup.* UI strings.

## Frontend

5. `lib/api.ts`: `apiDownload(path, filename)` — authenticated fetch → blob →
   browser download (plain `<a href>` can't carry the Bearer token).
6. `components/BackupRestoreCard.tsx` (admin-only, shown on
   `/dashboard/settings`): note input + "צור גיבוי" button; restore-point
   list (date, creator, note/auto tag, contact count) with restore + download
   actions; restore opens a warning modal (current data replaced, auto
   safety snapshot mentioned, "בטוח ?") before firing.

## Tests / verification

7. `backend/tests/test_fixes16.py`: staff 403; create+list; download content;
   restore round-trip (deleted contact returns, post-backup contact gone,
   apartments/areas/checklist restored); auto safety snapshot created;
   retention prune at 10; restore with a deleted assigned user nulls the link.
8. Full pytest in Docker, frontend tsc, live smoke on the local stack.
