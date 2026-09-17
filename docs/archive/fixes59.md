# Task Overview: MiniCRM Bug Fixes & Feature Enhancements

## 1. Users Module
* **[Bug Fix] User Deletion Flow:**
  * **Issue:** Missing functionality to delete a user.
  * **Requirement:** Add user deletion capability (including UI action and API integration).
  - [x] ALREADY SATISFIED — no code change needed. Backend: `DELETE /api/users/{user_id}`
    (`backend/app/routers/users.py:479`, admin-only, unassigns the user's contacts/
    ContactShliach/UserPreference rows before deleting, self-delete blocked). Frontend:
    a "מחק" delete action exists both on the Users list grid
    (`frontend/app/dashboard/users/page.tsx:1300-1307`, gated to real login rows, hidden
    for your own row) and on the per-user detail page
    (`frontend/app/dashboard/users/[id]/page.tsx:104-176`), both with a confirm dialog.
    Already covered by existing tests (`test_fixes7.py`, `test_fixes26.py`) and verified
    live 2026-09-07 (Playwright): 14 delete buttons present on the Users grid.

---

## 2. Activists & Dashboard Module
* **[Bug Fix] Dashboard Filter Metrics:**
  * **Issue:** Dashboard apartment counts do not update dynamically with applied filters.
  * **Requirement:** Update the dashboard apartment counter to reflect filtered results.
  - [x] DONE, as a live "apartments matching this filter" counter on
    `/dashboard/shliach-config`'s default-filters section (paired with the conflict
    alert below on the same page/filters — the admin KPI dashboard's own "new
    apartments" tile already correctly respects its one filter, the day range, so
    there was no bug there). Debounced fetch against `/api/apartments/list` using the
    same area/building/jewish/mezuzah/language filter state
    (`frontend/app/dashboard/shliach-config/page.tsx`, new `matchingApartments` state +
    effect). New localization key `shliach_config.matching_apartments`. Verified live:
    text reads "150 דירות תואמות את הסינון הזה" and updates when the area selection
    changes.

* **[Feature] Area/Building Filter Conflict Alert (`/dashboard/shliach-config`):**
  * **Trigger:** Attempting to apply an "area" or "building" filter that excludes a building currently assigned to an activist.
  * **Requirement:** Intercept filter application and display a popup warning.
  * **Localization:**
    * **Hebrew:** `.האזור/הבניין שייך לפעיל קיים` *(or: `.האזור/הבניין משויך לפעיל`)*
    * **English:** `The area/building has an activist assigned to it.`
  - [x] DONE. On Save, a non-empty area/building selection that would exclude an
    area/building an activist is individually assigned to today (via the existing
    `GET /api/areas/shliach-assignments` fixes43 §4.2 built; a building's own `area_id`
    stands in for a per-building check, since coverage is tracked by area/report
    number, not by building) now shows the exact bilingual `ConfirmModal` warning above
    before saving; canceling leaves the config unchanged. New localization key
    `shliach_config.filter_conflict_warning`. Verified live 2026-09-07: selecting an
    area that excludes a real local shliach assignment (area id 2) and clicking Save
    surfaced the warning; canceled without persisting.

---

## 3. Global Header Search
* **[Enhancement] Building Search Redirect Behavior:**
  * **Current Behavior:** Directs to the standalone building route (`/dashboard/buildings/{id}`).
  * **New Behavior:** Redirect to the apartments view filtered by that building ID.
  * **Routing Rule:**
    * *From:* `https://minicrm-ibexdata.vercel.app/dashboard/buildings/9`
    * *To:* `https://minicrm-ibexdata.vercel.app/dashboard/apartments?buildingid=9`
  - [x] DONE, with one deliberate naming substitution: the deep-link query param is
    `?building_ids=<id>` (repeatable, plural), matching the apartments page's own
    existing filter/deep-link convention (`?report_number_ids=<id>`, fixes53 §3) rather
    than the literal singular `buildingid` in the spec's example URL — kept consistent
    with the app's one real convention instead of introducing a second, incompatible
    param name for the same concept. `GlobalSearch.tsx`'s building results now link to
    `/dashboard/apartments?building_ids={id}`; the apartments page gained a matching
    deep-link effect (clears other filters, sets that building, same behavior as the
    report-number deep link). Verified live 2026-09-07: a "President" search result
    linked to `/dashboard/apartments?building_ids=1`, and navigating there showed the
    building filter applied.

---

## 4. Navigation & Access Control ("Manager Area")
* **[Feature] Restricted User Access:**
  * Grant users with the `restricted user` role access to the "Manager Area".
  - [x] ALREADY SATISFIED — no code change needed. "Restricted user" is the `staff`
    role's own English label (`users.role_staff` = "משתמש מוגבל" / "Restricted user",
    `backend/app/seed.py:475`). The "Manager Area" nav entry/page (`/dashboard/admin-areas`,
    labeled `nav.admin_areas`, renamed below) was already visible to staff — it's only
    hidden for the `shliach` role
    (`frontend/app/dashboard/layout.tsx:53-55`) — and reads are already
    `require_staff_or_admin` on the backend (`backend/app/routers/admin_areas.py:35,62`);
    only add/edit/delete are admin-only, correctly. Verified live: logged in as admin,
    nav shows the (renamed) entry with no role gate beyond the existing shliach block.

* **[Localization & Rebranding] Section Name Update:**
  * **Hebrew:** `אזור מותאם אישית`
  * **English:** `Custom Area`
  - [x] DONE. Renamed the "admin_areas" entity's full label set (nav entry, page title,
    add/edit/delete dialog text, empty state, the contacts filter option, and the
    `contact_mekurav.admin_area_id` field label that names the same entity) from
    "אזור מנהל"/"Admin area" to "אזור מותאם אישית"/"Custom area" consistently, via
    `LOCALIZATION_RENAMES` (`backend/app/seed.py`) so already-provisioned orgs pick up
    the new wording on the next `seed_all()` (every backend boot), not just new orgs.
    Verified live 2026-09-07 on local Postgres (already-seeded org 1): nav shows
    "אזור מותאם אישית", the old "אזור מנהל" string is gone.

---

## Round status (2026-09-07)

All 4 sections done — 2 items were real code changes needed and shipped (§2, §3), 2
were confirmed already-satisfied by existing code with no change required (§1, the
access half of §4), plus the §4 rename. `tsc --noEmit` clean, full backend suite green
(510 passed), live Playwright verification against local Docker for every item.
**Not deployed to Neon prod and not committed/pushed** — per the standing rule not to
commit or push without an explicit ask in the session; the backend rename (seed.py) has
NOT been applied to prod (no restart/redeploy triggered there).