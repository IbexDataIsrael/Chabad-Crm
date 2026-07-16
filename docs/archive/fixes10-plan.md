# Fixes 10 — Technical Implementation Plan

Spec: `docs/fixes10.md` (org-delete hardening, `assigned_user_id` → GUID with
auto-assignment + org-1 backfill, shliach permission overhaul). One Alembic
migration + one data-patch script.

## 1. Super Admin System

### 1.1 Cascading deletion — audit + fix
* `_delete_organization_cascade` (routers/admin.py) already deletes children
  leaves→roots, but **`Floor` is missing** from `ordered_models`: the DB-level
  `ON DELETE CASCADE` on `floors.building_id` covers Postgres, but the bulk
  `Building` delete leaves orphan floors on SQLite (tests) and the intent is
  app-level completeness. Add `Floor` before `Building`.
* **Completeness test** (`test_fixes10.py`): build a fully-populated org via
  the API (areas, admin areas, buildings+floors, apartments, mekurav+shliach
  contacts, visits, donations, interactions, picklists, custom fields,
  significant dates), delete it as superadmin, then iterate every SQLAlchemy
  model that has an `organization_id` column and assert **zero rows** remain —
  future tables that miss the cascade list will fail this test automatically.

### 1.2 Double-verification delete UI (superadmin dashboard)
* Replace the single `confirm()` in `onDeleteOrg` with a `DeleteOrgModal`:
  step 1 shows the irreversible-action warning; step 2 requires typing the
  **exact organization name** (or `DELETE`) before the final button enables.
* New localization keys: `admin.delete_org_title`, `admin.delete_org_warning`,
  `admin.delete_org_type_to_confirm`, `admin.delete_org_confirm`.

## 2. Contact entity — assigned_user GUID

### 2.1 Migration (`b8c9d0e1f2a3`)
* `contacts.assigned_user_id`: `Integer FK users.id` → `String(36) FK
  users.guid` (users.guid is unique+indexed, valid FK target).
* Postgres data mapping inside the migration: add `assigned_user_guid`
  varchar(36) → `UPDATE contacts SET assigned_user_guid = u.guid FROM users u
  WHERE u.id = contacts.assigned_user_id` → drop old column/FK → rename →
  re-add FK + index. Downgrade reverses via the same join.
* Ripples: `models.Contact.assigned_user_id` type; `_validate_fks` looks the
  user up **by guid** (org-scoped); `users.py delete_user` + superadmin
  `admin.py delete_user` null-out by `guid` not `id`; contacts list filter
  param `assigned_user_id: str`; schemas `Optional[str]`.
* Frontend: `Contact.assigned_user_id: string | null`; `ContactForm` select
  uses `user.guid` values; `ContactView` resolves the assignee by guid.

### 2.2 Auto-assignment on creation
* `create_contact`: when the payload has no `assigned_user_id` (or the creator
  is a shliach — §3.4 forces it), set it to `current_user.guid`. Applies to
  every creation flow (they all pass through this endpoint).

### 2.3 Org-1 backfill script
* `backend/scripts/patch_assign_org1.py --org-id 1 [--commit]` (dry-run
  default): finds the org's earliest **admin** user, sets
  `assigned_user_id = admin.guid` on **all** the org's contacts. Run locally on
  org 1, then on production org 1 (ארגון הדגמה — where the imported contacts
  live) after deploy.

## 3. Shliach role overhaul

### 3.3 + 3.4 CRUD + forced ownership
* `create_contact` dependency changes `require_staff_or_admin` →
  `get_current_user`; a shliach may create **mekurav** contacts only (creating
  a `shliach` contact provisions login users — admin-only, 403).
* For shliach creators the backend **forces** `assigned_user_id =
  current_user.guid`, ignoring any payload value; on update, a shliach's
  `assigned_user_id` change is stripped (cannot reassign).
* Update/delete already flow through `_get_contact_or_404`, so the §3.5
  visibility rule below automatically bounds what they can manage.

### 3.5 Data isolation — visibility flips to ownership
* `_can_shliach_see` / `_contacts_query`'s shliach branch change from
  apartment-coverage logic to **`assigned_user_id == current_user.guid`**
  (plus their own shliach contact record). Inherited automatically by the
  contacts list, paginated list, detail, checklist/custom-fields/dates
  sub-resources, contact-scoped visits, and the AI snapshot.
* `search.py`: contact hits for shliach switch to the same ownership filter.
* Apartment/area coverage screens are untouched (spec only redefines contact
  visibility).
* Breaking-test updates: `test_shliach_cannot_create_contact` (now allowed,
  mekurav only) and any apartment-coverage-based contact-visibility tests in
  `test_fixes4.py` / `test_search.py`.

### 3.6 + 3.2 Admin-area & config endpoint blocking
* `/api/admin-areas/*`: reads change `get_current_user` →
  `require_staff_or_admin` (writes stay `require_admin`) — shliach gets 403 on
  the whole section. `require_staff_or_admin`'s detail message generalizes.
* `GET /api/users` (feeds the assignment dropdown) → `require_staff_or_admin`.
* Audit confirms the rest of the config surface is already admin-gated:
  localization (all routes), org settings PUT, picklists writes, field
  settings writes, email templates + system settings (superadmin), donations
  (admin), global visits (admin). Tenancy/IDOR: org-scoped `_get_or_404`
  helpers everywhere; covered by existing tenancy tests + new shliach tests.

### 3.7 Navigation clean-up
* `dashboard/layout.tsx`: the אזור מנהל nav item renders only when
  `!isShliach`.
* `ContactForm`: for shliach users hide the assigned-user select and the
  admin-area dropdown (endpoints now 403 for them anyway); `ContactView`'s
  `AdminAreaLabel` shows "—" when the lookup fails.
* Contacts page: the "+ new contact" button shows for shliach too (§3.3);
  contact detail edit/delete stays visible (backend enforces ownership).

## Tests (`backend/tests/test_fixes10.py` + updates)

1. Org cascade completeness (§1.1) — zero rows across all org-scoped models.
2. GUID assignment: creating with no assignee → creator's guid; explicit
   assignee guid honored for admin; invalid guid → 400.
3. Shliach: can create mekurav (ownership forced even if payload lies), cannot
   create shliach-type; sees only own contacts in list/detail/pagination;
   update/delete own OK, foreign contact → 404; cannot change
   `assigned_user_id`; `/api/admin-areas` all → 403; `GET /api/users` → 403.
4. Backfill script covered by running it in a test (org fixture) or manual
   dry-run verification locally + prod.
5. Fix the obsolete fixes4 expectations.

## Execution order

1. Models + migration + schemas + deps message.
2. Routers: contacts (visibility, forced ownership, create gate), admin-areas,
   users, search, admin cascade (+Floor).
3. Seed localization keys → tests (new + updated) → full suite.
4. Frontend: types, ContactForm/ContactView, contacts page button, nav,
   DeleteOrgModal.
5. `alembic upgrade head` locally, backfill script dry-run + commit on local
   org 1; tsc + page compiles; push; after Render deploy run the backfill
   against production org 1 (Neon URL available from this session).
