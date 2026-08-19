# Technical Specification & Task List
make plan-fixes50.md before starting 
## 1. Field Management (`/dashboard/fields`)

### Task 1.1: Add Hide/Show Options under Visit Tab
* **Goal:** Extend the list of hideable field options under the **Visit** tab.
* **Requirements:**
  * Add `location` and `visit type` to the configurable list of fields that users can toggle to hide/show.
  * Ensure the server and UI state persist these visibility settings correctly.

### Task 1.2: Fix Field Display Ordering
* **Goal:** Resolve field numbering issues and establish correct sorting behavior.
* **Requirements:**
  * Fix the non-functional numbering input/ordering logic on the page.
  * Sort and display custom fields in ascending order based on their assigned number (**lowest number appears first**).

---

## 2. Single Contact View (`/dashboard/contacts/[id]`)

### Task 2.1: Visual Contrast for Field Labels
* **Goal:** Improve UI readability by establishing clear contrast between field labels and field values.
* **Requirements:**
  * Apply subtle styling to field labels (e.g., light grey background `#f4f4f5` or soft contrast pill/border) to visually separate them from text content. or use frames like you did in other places in the system (mivzoim)

### Task 2.2: Visit History Display Count
* **Goal:** Expand default visible visits.
* **Requirements:**
  * Update the **Visit** section in the single contact view to render the **7 most recent visits** by default on load.

---

## 3. Visit Summary (`/contacts/visit-summary`)

### Task 3.1: Global Visitors Overview
* **Goal:** Allow viewing the full visitor history regardless of date filters.
* **Requirements:**
  * Add a prominent action button/filter toggle to display all visitors across all dates.

### Task 3.2: Default Filter Bug Fix ("All Users")
* **Goal:** Fix the default filter state behavior.
* **Requirements:**
  * Resolve issue where selecting or defaulting to **"All users"** fails to query data properly. Ensure it reliably fetches and displays all contact records.

### Task 3.3: Navigation Menu Active State CSS Fix
* **Goal:** Fix active route highlighting in the sidebar/navigation menu.
* **Requirements:**
  * Correct the active menu state when navigating to `/contacts/visit-summary`. 
  * Prevent **"Contacts"** from remaining highlighted as the active item when **"Visit Summary"** is selected.

---

## 4. Users Page (`/dashboard/users`)

### Task 4.1: Render Custom Fields
* **Goal:** Display custom attributes on user profiles/lists.
* **Requirements:**
  * Fix data mapping and UI rendering so custom fields (e.g., `Chanukah`, `status_married`) are properly loaded and displayed on the page.

---

## Status — DONE 2026-08-19 (uncommitted)

Plan written first: `docs/plan-fixes50.md` (per-task readings + reasoning,
including the judgment calls on 3.2 and 4.1).

- [x] **1.1** `visits.location` + `visits.visit_type` added to
  `field_registry.py`'s toggleable-fields registry (entity `visit`), gated
  in `VisitDetails.tsx`, `VisitForm.tsx` and `VisitHistoryEditor.tsx`'s
  collapsed row.
- [x] **1.2** Root cause: `/dashboard/fields` never sorted its own rows by
  `sort_order` (every other page that reads field settings already did, via
  `sortByFieldOrder`) — the numbers saved correctly but never visibly took
  effect on the one page meant to configure them. Now sorted ascending,
  nulls last, in both the tab-level and per-entity-section row lists —
  covers custom fields/picklists too, same list.
- [x] **2.1** Every field label (`<dt>`) in `ContactView.tsx` and
  `VisitDetails.tsx` now renders as a light-grey pill
  (`bg-gray-100 rounded px-1.5 py-0.5`) distinct from its value.
- [x] **2.2** `VisitHistoryEditor.tsx` defaults to the 7 most recent visits
  (API already returns newest-first); a "הצג עוד ביקורים" button reveals 7
  more at a time.
- [x] **3.1** Added a standing "הצג את כל התאריכים" toggle next to the date
  pickers; `GET /api/visits/summary`'s `date_from`/`date_to` are now
  optional (open-ended range) instead of required.
- [x] **3.2** Root cause: `scope_all` ("view everyone at once") was
  admin-only, both in the UI and in backend authorization, even though the
  narrower `assigned_user_id` widening (fixes40) already allowed any
  non-shliach caller. Staff had no way to reach an aggregate view at all —
  picking "All users" in the owner dropdown did nothing beyond the untouched
  default. Broadened both the checkbox's visibility and the backend guard
  from `role == "admin"` to `role != "shliach"`. Default self-scope (no
  params) is unchanged — still locked in by `test_fixes38.py`.
- [x] **3.3** Root cause (confirmed): `NavMenu.tsx`'s active-route check
  (`pathname.startsWith(href + "/")`) treated `/dashboard/contacts/
  visit-summary` as a sub-route of `/dashboard/contacts`, so both "אנשי
  קשר" and "סיכום ביקורים" lit up together. Now only the longest/most
  specific matching href in the menu counts as active.
- [x] **4.1** Root cause (found live, not guessable from source): the
  Users page's per-column visibility for shliach custom fields/picklists
  was stored as an *inclusion* list — the moment an admin ever hid one such
  column, the list became explicit, and any field created afterward was
  never a member of it, so it silently defaulted to hidden even though its
  data loaded and saved correctly the whole time. Flipped to an *exclusion*
  (hidden-list) model, with the preference keys renamed
  (`users.shliachPicklistsHidden` / `users.shliachCustomFieldsHidden`) so a
  stale inclusion-list from before this fix is never misread under the new
  meaning. The Contacts page has the identical latent pattern
  (`visibleCustomPicklistKeys`/`visibleCustomFieldKeys`) but was left
  untouched — out of scope for this spec's Users-page section; worth a
  follow-up round if wanted there too.

**Evidence:** `npx tsc --noEmit` clean in the frontend container. Backend
suite: 451 passed (new `backend/tests/test_fixes50.py`, 6 tests, included);
the only failures (`tests/test_models.py`, 5 tests) are a pre-existing
environment limitation unrelated to this round — that file connects
directly to `DATABASE_URL` (`host.docker.internal`), which isn't reachable
from a host-run pytest outside Docker's network, not something these
changes touched. Every item live-verified with a headless-Chromium
(Playwright) drive against throwaway QA orgs on the local Postgres stack
(`docker-compose.local-db.yml` + `docker-compose up`): Visit tab
location/type toggles + hide-in-practice on a real visit row; Fields page
row reorder on typing an order number; contact-page label pills + 9→7+"show
more" visit cap; Visit Summary "all dates" (returned all 9 out-of-range
visits) and a staff login actually seeing the org-wide checkbox; nav
highlighting only "סיכום ביקורים" (not "אנשי קשר") on the Visit Summary
route; and the Users-page stale-column bug reproduced end-to-end (new field
hidden before the fix, visible after, explicit hide still works and
survives reload).