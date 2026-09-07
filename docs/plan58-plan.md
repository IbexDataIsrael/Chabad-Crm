# Plan: Campaign & Task Entities Refactor (fixes58)

## Context

`docs/fixes58.md` specifies a major shift in how activists (called "volunteers" in
this spec, "shliach" in the existing codebase) get access to apartments: instead of
apartments being visible because a Report Number is directly assigned to a shliach
(`ReportNumberContactShliach`), visibility should now be gated by whether that
Report Number belongs to an **active Task** under an **active Campaign**. The spec
also introduces a new **Campaign Manager** role and several new/changed admin
pages. The spec itself mandates a written, approved plan before any code — this is
that plan.

I explored the current codebase (models, routers, frontend pages/components) to
ground every decision below in what actually exists today, not the spec's
guesses about table/column names.

## Key architecture decisions (please review — these are judgment calls)

**1. Report-number-based apartment access: replace, but with a migration so no one
loses access on deploy.**
Today `_shliach_apartment_ids()` (`backend/app/routers/apartments.py:147`) grants a
shliach apartment visibility via two independent branches: (a) direct
`ReportNumberContactShliach` assignment, and (b) `ContactShliachArea` (area
coverage). The spec only talks about replacing the report-number mechanism with
Task/Campaign gating — it says nothing about areas, so **branch (b) stays
untouched**. Branch (a) will be replaced by: *report numbers linked
(`task_report_numbers`) to a Task whose `status = 'ACTIVE'` whose parent
`Campaign.is_active = true`*.
Because this is a live production system, a hard cutover would silently strip
apartment access from every currently-assigned shliach the moment the migration
runs. So the migration will auto-wrap existing state: for each org, create one
`Campaign` named "גישה קיימת" / "Legacy Access" (`is_active=True`), and for every
shliach who currently has `ReportNumberContactShliach` rows **and** a linked
`ContactShliach.user_id` (Task requires a real user, see decision 2), create one
`ACTIVE` Task carrying their existing report numbers into `task_report_numbers`.
Shluchim with report-number assignments but no linked login (email-fallback-only,
per fixes21) can't be migrated into a Task — I'll log/print these during the
migration so they can be reconciled manually (there should be few, per memory
these are edge cases already).
The old `ReportNumberContactShliach` table/model is left in place (not dropped) —
just no longer read for access control — since dropping it isn't requested and
isn't reversible.

**2. `Task.volunteer_id` references `users.id` directly, not `ContactShliach`.**
The spec's own field name/workflow (quick-action button on the *Users* page,
"Volunteer" = a real login) points at `users.id`, which is also simpler than
resolving through `resolve_shliach()`. This sidesteps the existing
linked-vs-email-fallback shliach identity complexity entirely for the new code
path.

**3. Tasks/Campaigns are plain mutable rows, not versioned.**
`Apartment` and `ContactShliach` use the `root_id`/`is_display` audit-trail
versioning pattern because they need field-level edit history. Nothing in the spec
asks for Task/Campaign edit history — they're closer to `ShliachAnnouncement`
(simple row + `is_visible`/`is_active` toggle + timestamps). Using plain rows here
avoids a lot of unneeded complexity.

**4. `custom_date_picklist_id` actually FKs to a picklist *value*, not a picklist
*definition*.** The spec's ER diagram says `custom_date_id` / references
`picklists.id`, but in the real schema individual selectable options
("First Candle of Hanukkah") are rows in `picklist_values`
(`PicklistValue`, `PicklistLink` is the generic join table), scoped by
`PicklistDefinition.entity_type`. So: add `entity_type = "task"` picklists (no
schema change needed there — `entity_type` is a plain string column), and
`tasks.custom_date_value_id` is an FK to `picklist_values.id`.

**5. Campaign Manager gets "Full management of Apartments" — scoped to just
Apartments, not Buildings/Areas** (the spec names Apartments specifically). A new
`require_admin_or_campaign_manager` dependency will gate Apartment
create/update/delete/bulk-update endpoints alongside the existing `require_admin`.
Buildings/Areas endpoints are untouched.

**6. Campaign Manager on the Users ("Volunteers") page gets read/write on
shliach-role rows, but role elevation (assigning admin/campaign_manager/staff) and
deleting non-shliach users stay admin-only.** This is the one place I'm making a
narrower call than the spec's blanket "Full management of ... Volunteers" wording,
to avoid a non-admin role silently being able to grant itself/others elevated
access. Flagging this explicitly — happy to widen it if disagreed with.

**7. Activist-homepage `{{count}}` tag = distinct report numbers currently linked
to that campaign's active tasks, org-wide.** The spec's dynamic-tag system
("`{{count}} Jews received a Menorah`") isn't otherwise defined. This is the one
number directly computable from the new schema with no further product input
needed. Built so more tags can be added later without a redesign.

**8. "Volunteer View Settings" page = the existing `/dashboard/shliach-config`
page** (fixes51's admin-only config panel for the shliach/activist apartments
view) — this is the only existing page that matches that description.

## Phase 1 — DB schema & migration

New models in `backend/app/models.py` (plain rows, following the `organization_prefs`
migration as the DDL template and `ReportNumberContactShliach` as the junction-table
template):

- `Campaign`: `id`, `guid`, `organization_id` (FK), `name`, `is_active` (bool,
  default False), `custom_stats_text` (Text, nullable), `created_at`,
  `updated_at`, `deleted_at` (nullable — soft delete).
- `Task`: `id`, `guid`, `organization_id` (FK), `campaign_id` (FK
  `campaigns.id`, no cascade — block campaign hard-delete while tasks exist,
  matching the soft-delete design), `volunteer_user_id` (FK `users.id`),
  `custom_date_value_id` (FK `picklist_values.id`, nullable), `status`
  (String(20), default `"ACTIVE"`, values `ACTIVE|COMPLETED|PAUSED` — validated at
  the API layer like other status strings in this codebase, no DB enum),
  `volunteer_report_summary` (Text, nullable), `created_at`, `updated_at`.
- `TaskReportNumber`: `id`, `guid`, `organization_id`, `task_id` (FK
  `tasks.id`, `ondelete="CASCADE"`), `report_number_id` (FK `report_number.id`,
  `ondelete="CASCADE"`), unique constraint on `(task_id, report_number_id)`.

One Alembic migration (`down_revision` = current head, `8e9f0a1b2c3d`):
1. `op.create_table` for all three tables + indexes/unique constraints (mirrors
   the `organization_prefs`/`report_number_contact_shliach` migrations).
2. `bulk_insert` a new `("campaign_manager", 5)` row into `roles`.
3. Data backfill described in decision #1 above, done with raw `sa.table`
   selects/inserts inside `upgrade()` (no ORM session — consistent with how this
   migration file has to run standalone).

## Phase 2 — Backend APIs & access control

- `backend/app/routers/campaigns.py` (new): `GET /api/campaigns` (admin +
  campaign_manager; supports `?active=true` for the Task-creation dropdown),
  `POST`, `PUT /{id}`, `DELETE /{id}` (soft delete → sets `deleted_at`,
  `is_active=False`). Follows `report_numbers.py`'s CRUD shape and org-scoping
  (`_get_or_404`-style helper).
- `backend/app/routers/tasks.py` (new): `GET /api/tasks/list` — a paginated
  envelope endpoint (`items/total/page/page_size`, same shape as
  `ApartmentPageOut`) with `status`/`campaign_id` filters, `q` free-text search,
  and `sort` in `{volunteer_name, created_at, report_number}` — mirrors
  `_apply_apartment_filters`'s centralized-filter-function pattern. `POST ""`
  (quick-create, used by the Users-page quick action), `PUT /{id}` (inline-edit
  friendly — partial update), `DELETE /{id}`. Reads/writes: admin + campaign_manager.
- `backend/app/deps.py`: add `require_admin_or_campaign_manager` (mirrors
  `require_staff_or_admin`'s shape) and `forbid_campaign_manager` (raises 403 if
  `current_user.role == "campaign_manager"`, used to enforce decision above).
- Apply `forbid_campaign_manager` to the primary read/write endpoints in
  `contacts.py`, `visits.py`, and the settings-related endpoints (org settings) —
  representative endpoints, not every helper route, matching how `isShliach`
  exclusions are applied selectively today.
- Apply `require_admin_or_campaign_manager` in place of `require_admin` on
  Apartment create/update/delete/bulk-update in `apartments.py`.
- `_shliach_apartment_ids()` (`apartments.py:147`): replace the
  `ReportNumberContactShliach` branch with a query joining
  `TaskReportNumber → Task (status='ACTIVE') → Campaign (is_active=True)`,
  filtered by `Task.volunteer_user_id == user.id`. Area branch untouched.
- New endpoint for the Report Numbers page:
  `GET /api/report-numbers/campaign-task-status` → for each active campaign,
  `{report_number_id: {campaign_id, task_status}}`, mirroring the shape of the
  existing `shliach-assignments` endpoint.
- New endpoint for the activist homepage:
  `GET /api/campaigns/active-stats` (any authenticated user) → active campaigns
  with `custom_stats_text` and computed `count` (distinct report numbers under
  that campaign's active tasks).
- `backend/app/schemas.py`: `CampaignCreate/Update/Out`, `TaskCreate/Update/Out`,
  `TaskPageOut` (pagination envelope), `TaskReportNumberIn` (plain `report_number_ids:
  list[int]` on the task payload — no separate bulk-assignment endpoint needed,
  same reasoning the explore report gave for `ReportNumberMultiSelect`).

## Phase 3 — Roles & route guards

- Backend: role added via migration (Phase 1). No enum/CHECK constraint elsewhere
  blocks it (confirmed — `roles` is the only place role values are declared).
- Frontend `frontend/lib/auth.tsx`: add `isCampaignManager` (`role ===
  "campaign_manager"`) alongside `isAdmin`/`isShliach`.
- `frontend/app/dashboard/layout.tsx`: generalize the `adminOnly()` filter to
  also accept a `roles?: string[]` allow-list per item (currently a bare
  `admin?: boolean` flag), so an item can say "admin or campaign_manager" instead
  of only "admin". Explicitly exclude Campaign Manager from `peopleItems`
  (contacts/donations/visit-summary/admin-areas), `reportItems` (reports/report-numbers/
  messages — same as the `isShliach` exclusion pattern already there),
  `settings`, `localization`. Explicitly include Campaign Manager (alongside
  admin) for: Users, `shliach-config`, and the new Campaigns/Tasks nav entries.
  Apartments is already open to non-admin roles today, so no change needed there.
- Per-page guards (picklists/fields/custom-fields/report-numbers/users/
  settings/etc.) follow the existing inline `if (!isAdmin) return <...>` pattern
  — extend the condition to `if (!isAdmin && !isCampaignManager)` only on the
  pages Campaign Manager is allowed into (Users, shliach-config); everywhere else
  stays `!isAdmin`.

## Phase 4 — Admin/Campaign Manager UI

- `frontend/app/dashboard/campaigns/page.tsx` (new): grid of campaigns
  (name, active toggle, stats-text editor via `InlineEdit`), create/delete,
  admin + campaign_manager guarded like other admin pages.
- `frontend/app/dashboard/tasks/page.tsx` (new): full CRUD grid modeled on
  `report-numbers/page.tsx`'s structure — search box, `status`/`campaign` filter
  dropdowns (reuse `MultiSelectSearchFilter`), sortable columns (volunteer name /
  created date / report number, reusing the existing sort-header pattern with the
  dim-arrow-when-inactive convention from fixes54), `InlineEdit` cells for status
  and volunteer_report_summary, pagination via the new `TaskPageOut` envelope.
- `frontend/app/dashboard/users/page.tsx`: add a per-row Quick Action icon button
  in the actions `<td>` (~line 1275) for shliach-role rows, following the exact
  pattern of the Contacts page's add-visit button (icon button sets a `taskFor`
  state var → conditional modal at the bottom of the page).
- `frontend/components/TaskQuickCreateForm.tsx` (new, modeled directly on
  `VisitForm.tsx`): campaign dropdown (active campaigns only; auto-select if
  exactly one, required choice if multiple), report-number multi-select (reuse
  `MultiSelectSearchFilter`), custom-date picklist select, status defaults to
  Active. Posts to `POST /api/tasks` with `volunteer_user_id` locked from the
  row, same as `VisitForm`'s `lockedContactId`.
- `frontend/app/dashboard/report-numbers/page.tsx`: remove the `"activist"`
  optional column (the static volunteer-assignment list). Add one column per
  currently-active campaign, rendering a colored `Badge` (green=Active,
  blue=Completed, red=Paused — reuse the existing `status-*` badge variants from
  `components/ui/badge.tsx`) sourced from the new `campaign-task-status` endpoint.
- Hide/remove the direct report-number assignment picker
  (`ReportNumberMultiSelect`) from the Contact/Shliach edit page, since it no
  longer affects access and would otherwise look functional but be dead —
  replace with a short note pointing admins to the Tasks page instead.

## Phase 5 — Picklist/Fields/Custom-fields "Tasks" tab

- `picklists/page.tsx`: extend `PicklistTab` union with `"tasks"`, extend
  `tabFor()`, add a `TABS` entry, add a tab-body block (mirrors the existing
  `"shliach"` block) including the "custom task date" picklist category
  (`entity_type: "task"`, field_key `task.custom_date`).
- `fields/page.tsx` and `custom-fields/page.tsx`: same pattern — extend their tab
  unions/`TAB_ENTITIES`/`ENTITY_TYPES` arrays with `"task"`.
- No backend schema change needed — `entity_type` is already a free-form string
  column on both `PicklistDefinition` and `CustomFieldDefinition`.

## Phase 6 — Activist homepage dynamic stats

- `frontend/app/dashboard/activist/page.tsx`: add a `Card` tile per active
  campaign (same fetch-count-into-tile pattern already used for the "my
  apartments" tile), fetching `GET /api/campaigns/active-stats` and rendering
  `custom_stats_text` with `{{count}}` substituted client-side.

## Verification

- Backend: `pytest` in `backend/` (new tests for campaigns/tasks CRUD, the
  migration backfill logic on a throwaway SQLite db, and the updated
  `_shliach_apartment_ids` access logic — a shliach with an active task sees the
  linked apartment, one with a paused/completed task or inactive campaign does
  not).
- Run `tsc --noEmit` in `frontend/` before calling anything done (per project
  rule — dev mode hides real build failures).
- Live-drive the flow end to end via `docker-compose up --build`: create a
  Campaign Manager user, log in as them and confirm Contacts/Settings are
  blocked but Apartments/Tasks/Campaigns/Users/shliach-config work; create a
  Campaign + Task from the Users page quick action; log in as that shliach and
  confirm the linked report number's apartments are now visible; pause the Task
  and confirm access disappears; check the Report Numbers page shows the correct
  colored campaign columns; check the activist homepage stat tile renders.
- Confirm the migration's legacy-access backfill against a copy of local
  Postgres data (per the project's own "SQLite tests miss FK bugs" lesson) —
  verify no currently-active shliach loses apartment access post-migration.

## Progress log

- [x] Phase 1 — DB schema & migration. `campaigns`/`tasks`/`task_report_numbers`
  added (migration `9c1d2e3f4a5b`), `campaign_manager` role inserted, legacy-access
  backfill run and verified against local Postgres (org 1: 1 shliach with a prior
  report-number assignment → 1 Legacy Access campaign + task, apartment set
  unchanged before/after). Orgs with zero migratable shliachim get no Legacy
  campaign (a deliberate, sensible narrowing of "for each org" — nothing to
  preserve there).
- [x] Phase 2 — Backend APIs & access control. `routers/campaigns.py`,
  `routers/tasks.py`, `_shliach_apartment_ids` rewritten to gate on
  `TaskReportNumber → Task(ACTIVE) → Campaign(active)`, `campaign-task-status`
  and `active-stats` endpoints added.
- [x] Phase 3 — Roles & route guards. `require_admin_or_campaign_manager` /
  `forbid_campaign_manager` / `require_staff_admin_or_campaign_manager` added;
  applied to apartments/contacts/visits/users/organizations. Frontend
  `isCampaignManager` + nav `roles` allow-list. A live drive caught a real gap
  beyond the plan's own checklist — Contacts pages had no page-level guard, only
  a nav hide, so a direct URL still rendered the page shell (data itself was
  already 403'd server-side) — fixed on the Contacts list/detail and Visit
  Summary pages.
- [x] Phase 4 — Admin/Campaign Manager UI. Campaigns page, Tasks page (search/
  filter/sort/paginate + inline status/report), Users-page "Add task" quick
  action + `TaskQuickCreateForm`, Report Numbers page's activist column replaced
  with one badge column per active campaign (Completed uses a neutral outline
  badge, not the spec's blue — not one of CLAUDE.md's 5 mandated status colors),
  `ReportNumberMultiSelect` retired from the 4 places it was still wired
  (ContactView, ContactForm, Users list, Users detail) in favor of a read-only
  display + pointer to the Tasks page.
- [x] Phase 5 — Picklist/Fields/Custom-fields "Tasks" tab. `task.custom_date`
  picklist category added; contact_shliach already had its own tab pre-fixes58
  (item 1 of this phase was already satisfied). `fields/page.tsx`'s new tab is
  structurally ready but empty (no fixed Task field is registered in
  `field_registry.py` — out of scope here, Task's fields live on the Tasks page
  itself).
- [x] Phase 6 — Activist homepage dynamic stats. One tile per active campaign
  on `/dashboard/activist`, `{{count}}` substituted client-side; the admin
  dashboard's "coming soon: campaigns & tasks" placeholder card removed.

**Verification**: full backend suite green (516 passed, includes new
`test_fixes58.py`), `tsc --noEmit` clean, and a full live Playwright drive against
local Docker covering the plan's own checklist: created a Campaign Manager user
and confirmed Contacts/Visit-Summary blocked (nav + direct URL) while Apartments/
Tasks/Campaigns/Users/shliach-config work; created a Campaign + Task from the
Users-page quick action; confirmed the linked report number's apartments became
visible to that shliach (0 → 1) and disappeared again when the Task was paused
(1 → 0); confirmed the Report Numbers page's new campaign badge column; confirmed
the activist homepage's stat tile rendered with the `{{count}}` tag correctly
substituted. Not committed/pushed, not deployed to Neon — per the standing
no-commit/push-without-being-asked rule.
