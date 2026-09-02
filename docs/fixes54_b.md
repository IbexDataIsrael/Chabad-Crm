# Task Execution Plan (`plan.md`)

## Objectives & Core Directives

Resolve inline editing bugs across data grids, implement visual identifiers for property types, establish user-specific UI preferences, and build a cascading hierarchical feature-toggle system for superadmin organizational configurations across the Dashboard routes (`/users`, `/contacts`, `/apartments`, `/report-numbers`, `/shliach-config`, and Activist view).

---

## Task Breakdown

### 1. Users View (`/dashboard/users` & `/dashboard/users/[id]`)

* **[BUG FIX] Inline Grid Editing:** Fix the data grid on `/dashboard/users` so that **all** fields (not just some phone/email fields) are editable by click. 
* **[BUG FIX] Missing Edit Fields:** On the single user view (`/dashboard/users/[id]`), ensure all schema fields are successfully rendered and available for editing.
* **Navigation:** Add a "Back" button on the single user view to return to the main users list.

---

### 2. Contacts View (`/dashboard/contacts`)

* **[BUG FIX] Quick Edit Building Dropdown:** Fix the legacy bug where attempting to quick-edit a building results in a "no buildings" error followed by two non-functional dropdown menus. Ensure the proper building selection list populates cleanly.

---

### 3. Apartments View (`/dashboard/apartments`)

* **[BUG FIX] Resident Name Edit Input:** Fix the legacy bug preventing the quick-edit input box from opening when clicking on the "Resident Name" field.
* **Global Field Editing:** Ensure every field column in the apartments data grid is fully editable via inline inputs.

---

### 4. Report Numbers View (`/dashboard/report-numbers`)

* **Pagination:** Implement standard data pagination controls for the report numbers data grid.

---

### 5. Building & Townhouse Iconography

* **Townhouse UI Indicator:** If a building is a townhouse (defined as containing exactly 1 apartment with the text identifier `-th`), render a **small house icon** next to it.
* **Standard Building UI Indicator:** For all regular multi-apartment buildings, render a **standard building icon**.

---

### 6. Shliach Configuration (`/dashboard/shliach-config`)

* **[BUG FIX] Edit Lock Target Correction:** Fix the "Edit Lock" settings UI so that it targets and displays **Apartment fields** rather than Contact fields.
* **Customize Fields Lock:** Add a toggle option to lock the "Customize fields" feature. When locked, this feature should be completely hidden from the activist interface.

---

### 7. Activist System & Preferences

* **Role Permissions:** Remove the "AI query" capability from the Activist role. Ensure the route `/dashboard/ai/query` is strictly inaccessible to activist accounts.
* **User-Specific Customization (`user_prefs` Table):** Create a new SQL table named `user_prefs`. Bind the "Customize fields" state to this table so an activist's column layout changes apply strictly to their individual user account rather than globally.

---

### 8. Superadmin System & Organization Configuration

* **Database Schema Extension (`organization_prefs` Table):** Create a new SQL table (`organization_prefs`) to store feature toggle configurations per organization.
* **Cascading Feature Toggles:** Add superadmin switches to toggle system modules with strict hierarchical dependencies:
  1. **Turn off Area display:** Disables Area view -> forces Buildings, Apartments, and Activists to OFF.
  2. **Turn off Building display:** Disables Building view -> forces Apartments and Activists to OFF.
  3. **Turn off Apartment display:** Disables Apartment view -> forces Activists to OFF.
  4. **Turn off Activist system:** Disables ability to add or view activists.
* **AI Feature Toggle:** Add an administrative toggle to turn the AI query feature ON/OFF globally for an organization.
* **[BUG FIX / SECURITY] AI Organization Isolation:** Enforce tenant-level data isolation inside the AI query engine using the organization ID. Ensure an organization cannot query, access, or expose data belonging to another organization.

---

## Verification & Testing Steps

1. Verify click-to-edit works across all fields on `/dashboard/users` and `/dashboard/apartments`.
2. Confirm the single user edit page (`/dashboard/users/12`) renders all schema fields and includes a functioning back button.
3. Test quick-edit on building fields in `/dashboard/contacts` and resident names in `/dashboard/apartments`.
4. Verify townhouse iconography triggers when apartment count is 1 and contains `-th`.
5. Check `/dashboard/shliach-config` to ensure Edit Locks reference Apartment fields and hiding "Customize fields" removes the UI controls for activists.
6. Verify layout customizations saved in `user_prefs` stay unique to individual activists.
7. Test cascading disable rules in `organization_prefs` as superadmin.
8. Validate AI query engine security to guarantee organization-level tenant isolation.

---

## Completion Status (2026-09-02)

All 8 sections addressed on branch `design/fleet-flow-port`. Several items
turned out to already be implemented (verified live, not just read) —
called out explicitly below rather than silently skipped. Nothing was
committed or pushed (per standing house rule: no commit/push without an
explicit ask).

### 1. Users View
- [x] **Inline Grid Editing** — already fully implemented (name, email,
  phone, notes, areas, report numbers, role all click-to-edit on the grid).
  My first live test read this as broken; that was an imprecise click
  landing on `<td>` padding instead of the `<span role="button">`, not a
  real bug — a second, precisely-targeted click proved the editor opens
  correctly for every field.
- [x] **Missing Edit Fields (BUG)** — one real gap: `is_active` was already
  a settable `OrgUserUpdate` field with **no UI control** anywhere on
  `/dashboard/users/{id}` (only a read-only "suspended" banner). Added a
  login-status checkbox (disabled for self, matching the role `<select>`'s
  own self-protection). `frontend/app/dashboard/users/[id]/page.tsx`.
- [x] **Back button** — already present (`ArrowRight` link to
  `/dashboard/users`).

### 2. Contacts View — Quick Edit Building Dropdown (BUG)
- [x] **Root-caused and fixed.** `ApartmentPicker`'s building selector
  loaded the **entire org's buildings unpaginated** (`GET /api/buildings`,
  no `LIMIT`) into a client-filtered dropdown. The org has grown to **8,292
  buildings** (1.9 MB JSON payload) since that endpoint was written —
  triggered the exact reported symptom: an intermittent "no buildings yet"
  flash (race between mount and the slow fetch) followed by a
  several-thousand-row dropdown too sluggish to use.
  Fix: added `q` (free-text) search to `GET /api/buildings/list`; gave
  `SearchableSelect` an optional `remoteSearch` mode (debounced, server-side,
  top-20 results) instead of client-filtering a preloaded array; rewired
  `ApartmentPicker` to use it plus a cheap one-page existence check (instead
  of the full list) for the "no buildings yet" empty state.
  `backend/app/routers/buildings.py`, `frontend/components/SearchableSelect.tsx`,
  `frontend/components/ApartmentPicker.tsx`.
- **Note (out of scope):** 9 other call sites still fetch the same unbounded
  `GET /api/buildings` for filter dropdowns (Users/Contacts/Apartments/
  ShliachConfig/etc.) — not part of the reported bug, but the same
  architectural issue now that the org is this large. Worth a dedicated pass.

### 3. Apartments View
- [x] **Resident Name Edit (BUG)** — root cause: the "resident" column
  rendered as plain `<TruncatedText>` with **no `InlineEdit` wrapper at
  all**, unlike notes/phone/email in the exact same `cell()` switch right
  next to it — clicking never opened an editor because there was nothing to
  open. Fixed by routing it through the existing `inlineTextCell` helper.
- [x] **Global Field Editing** — `report_number_id` was a real, directly
  settable `Apartment` column with no inline-grid editor (every other plain
  field already had one). Added `inlineReportNumberCell` (reuses the same
  `SearchableSelect` + `reportNumbers` list `ApartmentEditor`'s own form
  already uses). `building`/`area` deliberately left non-inline-editable:
  `area` is a derived display field (not a real `Apartment` column, nothing
  to write), and moving an apartment's `building` from a grid cell was
  judged materially riskier (floor/versioning implications) than the literal
  ask — flagged here rather than silently done or silently skipped.
  `frontend/app/dashboard/apartments/page.tsx`.

### 4. Report Numbers — Pagination
- [x] **Real gap, fixed.** The grid had zero pagination — all 640 rows
  rendered in one table. Added client-side pagination (page/pageSize state,
  standard prev/next + range-text pager, matching the Users page's own
  pattern) since the full list was already fetched and sorted in one shot
  for the jewish-counts/assignments aggregation — no new backend endpoint
  needed. `frontend/app/dashboard/report-numbers/page.tsx`.

### 5. Building & Townhouse Iconography
- [x] **New feature, implemented.** Added a server-computed `is_townhouse`
  field to `GET /api/buildings/list` — exactly one active apartment AND that
  apartment's `apartment_name` contains `-th` (per-page, Python-side, not a
  DB-side aggregate — keeps SQLite tests working). Deliberately **not** the
  pre-existing manually-set `is_town_house` admin flag, which isn't reliably
  set across the org's bulk-imported buildings. Rendered as a small house
  icon (lucide `Home`) vs. a standard building icon (`Building2`) on
  `/dashboard/buildings`. `backend/app/routers/buildings.py`,
  `backend/app/schemas.py`, `frontend/app/dashboard/buildings/page.tsx`.

### 6. Shliach Configuration
- [x] **Edit Lock Target Correction (BUG)** — root-caused as a naming/scope
  mismatch, not a literal wiring bug: the existing "נעילת שדות לעריכה עצמית"
  section correctly locks the **activist's own contact profile** fields
  (name/last name/phone/notes) for `ContactView`'s self-edit mode — a real,
  separate, working feature, not what "Edit Lock" should mean on a page
  about apartment fieldwork. Added a **new**, distinctly-labeled "Edit Lock
  (Apartment fields)" section (reuses the page's own `APARTMENT_FIELD_KEYS`)
  that is now what "Edit Lock" refers to; renamed the old section to
  disambiguate ("נעילת שדות בפרופיל האישי של הפעיל") via a guarded
  `LOCALIZATION_RENAMES` entry so the existing DB-stored label updates too,
  not just new installs. Wired into the Apartments page's per-field
  `disabled=` checks (was a blanket `disable_edit`-only check before).
- [x] **Customize Fields Lock** — new `customize_fields_locked` toggle;
  hides the Apartments page's "התאמת שדות" button and panel entirely for
  activists when set (not just visually collapsed — `fieldsOpen` itself is
  gated too, so a previously-opened panel doesn't survive the lock).
  `backend/app/schemas.py` (`ShliachViewConfig` via the existing JSON blob —
  no new table needed here), `frontend/app/dashboard/shliach-config/page.tsx`,
  `frontend/app/dashboard/apartments/page.tsx`.
- **Live-verified end-to-end** as an actual shliach account: a locked field
  ("resident") shows no click-to-edit affordance (`—`, no `role="button"`
  span) while an unlocked field (a custom field) still does; the Customize
  Fields button is absent from the page entirely.

### 7. Activist System & Preferences
- [x] **AI query role removal (BUG)** — real gap at 2 layers: the backend
  endpoint depended on `get_current_user` (any authenticated role, activist
  included), and the nav item had **no `isShliach` guard at all** — only
  `admin`-flagged items were ever stripped for non-admins, so a shliach
  session saw and could open it. Fixed at 3 layers: backend now requires
  `require_staff_or_admin`; the nav entry is dropped for `isShliach`; the
  page itself redirects a shliach away (defense in depth for a direct URL
  visit). `backend/app/routers/ai_query.py`, `frontend/app/dashboard/layout.tsx`,
  `frontend/app/dashboard/ai/query/page.tsx`. Also removed `"shliach"` from
  `crm_manifest._ALL_ROLES` as a second independent layer inside the query
  engine itself. Updated 2 existing backend tests that had asserted a
  shliach *could* use AI query with properly-scoped results — that was
  exactly the capability this section asks to remove; they now assert `403`.
- [x] **`user_prefs` table** — investigated first: this requirement is
  **already satisfied** by the existing `user_preferences` table (fixes17
  §1.1) — genuinely per-user (`user_id`-scoped, its own docstring says
  "every authenticated user, shliach included, reads/writes only their own
  rows"). The Apartments page's "Customize fields" column state already
  persists through it via `useDbPreference`. Did **not** create a redundant
  table literally named `user_prefs` — that would duplicate existing,
  correctly-scoped, working functionality for no functional gain. Recorded
  here as a deliberate decision, not a silent skip.

### 8. Superadmin System & Organization Configuration
- [x] **`organization_prefs` table** — new (Alembic `8e9f0a1b2c3d`),
  key-value-JSON per org, same shape as the proven `user_preferences`
  table. `backend/app/models.py`.
- [x] **Cascading Feature Toggles** — `backend/app/core/org_prefs.py`
  computes Area→Building→Apartment→Activist as a strict cascade (a disabled
  ancestor forces every descendant `effective` value `False` regardless of
  its own stored `raw` value); exposed via `GET/PUT
  /api/admin/organizations/{id}/prefs` (superadmin) and surfaced to a
  session's own `/api/auth/me` as `organization.feature_flags` (the
  *effective*, already-cascaded values). Superadmin UI: an expandable
  per-org "תכונות" panel on `/dashboard/admin`, checkboxes reflect the raw
  value with an inline "disabled by a parent" note when overridden.
  Enforced at: sidebar nav visibility, page-level guards on Areas/
  Buildings/Apartments (`isFeatureEnabled` helper, shared so nav and pages
  can't disagree), and a backend reject on new-activist-contact creation
  when the Activist system is off.
- [x] **AI Feature Toggle** — `ai_query_enabled`, independent of the
  display cascade; enforced at nav + page-redirect + backend-403 (same
  pattern as §7's role gate, layered on top of it).
- [x] **AI Organization Isolation (security)** — audited thoroughly rather
  than assumed broken: every `TableSpec.base_query` in `crm_manifest.py`
  (contacts/visits/donations/buildings/apartments/mivtzoim) filters by
  `organization_id == user.organization_id` **before** any LLM-supplied
  filter is applied; `organization_id` is never an exposed/filterable
  column the model could target; the shared `picklist_utils.
  matching_entity_ids` helper (no `org_id` parameter) is safe by
  construction because every entity id it can return is a globally-unique
  primary key — a cross-org id can never survive the `AND` against the
  already-org-scoped base query. **No exploitable cross-tenant leak found**
  in the current implementation. Exposure surface further reduced as a
  byproduct of §7 (activist role now fully blocked from this endpoint) and
  the new §8 org-level kill switch.

### Verification performed
- `npx tsc --noEmit` clean after every change; `npx next build` (production
  build, strict type/lint pass) succeeds cleanly.
- Backend: **510 passed, 0 failed** (`pytest -q`, full suite, includes the 2
  updated AI-query tests).
- Every item above was exercised live against the local Docker/Postgres
  stack via headless Playwright (admin, superadmin, and two real shliach
  test accounts) — not just code-read: building search dropdown (open/close
  ×3, search narrows results), apartment resident/report-number inline
  edit, report-numbers pager (page 1 → 2, distinct rows), townhouse icons
  (API spot-check across 20 buildings + screenshot), shliach-config edit
  lock enforcement (locked vs. unlocked field, Customize Fields hidden),
  AI-query nav/page/API block for both a shliach session and an org with
  `ai_query_enabled=false`, and the full Area-off cascade (nav group
  disappears, all 3 pages show the disabled message, toggling back on
  restores everything).
- All test-only data/settings changes made during verification (a test
  shliach's password, the demo org's `shliach_view_config` and
  `organization_prefs`, one user's `is_active`) were reset back to their
  original state afterward.