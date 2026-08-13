# Feature Requirements & Technical Specification

Please implement the following updates across the dashboard modules, focusing on filtering, UI/styling fixes, report custom styling, and user/role management.
make plan file first
---

## Status: DONE (2026-08-10, uncommitted)

Plan written first per the instruction above — see `docs/fixes42-plan.md` for
the design/assumptions behind each item (esp. the "Row 2" reading and the
Users/Shluchim merge architecture). Verified: `tsc --noEmit` clean, 415
backend pytest passing, live headless-Chrome drive of all 4 areas (login as
`admin@demo.local`, screenshots + DOM assertions) — see plan file for detail.
Nothing pushed/committed (per standing rule: no commit/push unless asked).

## 1. `dashboard/contacts/visit-summary`

* **Contact Owner Filter Enhancement:**
  * Add the capability to filter records by **Contact Owner** (Assigned To).
  * Include a **"Show All Records"** option to clear/bypass the contact owner filter.

- [x] The owner filter itself already existed (fixes40). Added: a standing
      "הצג את כל הרשומות" (Show All Records) button next to the owner select,
      shown whenever an owner is picked, that clears the filter in one click
      — `components/VisitSummary.tsx`. Live-verified: selecting an owner
      shows the button; clicking it clears back to the full list.

---

## 2. `dashboard/reports/create`

* **Visual Differentiation for Row 2:**
  * Style **Row 2** (which contains explanatory/helper text) with a **light grey background** (`#f5f5f5` or standard Tailwind `bg-gray-100`/`bg-slate-100`) to clearly differentiate it from the remaining table rows.

- [x] Read "Row 2" as the page's 2nd card — the "עמודות הדוח" column-config
      card (chip picker + subheading/width table), the one that's mostly
      explanatory/helper text per the spec's own description. Changed its
      wrapper to `bg-gray-100` — `app/dashboard/reports/create/page.tsx`.
      Live-verified computed background `rgb(243, 244, 246)`.

---

## 3. `dashboard/settings`

* **Font Configuration Fix:**
  * Fix the font settings selector: applying a font selection currently fails to update system fonts. Ensure font choices correctly apply system-wide CSS variables or class overrides.

- [x] Root cause: `LabelStyleInjector.tsx` only ever styled
      `label > span:first-child, dt` — never reached ordinary body text.
      Fixed by overriding the shared `--font-sans` CSS variable at `:root`
      instead (globals.css's `body { font-family: var(--font-sans) }`
      already cascades everywhere). Live-verified: picking Roboto and saving
      changes both `--font-sans` and the computed `body` font-family
      site-wide; resetting to "ברירת מחדל" restores the original stack.

---

## 4. `dashboard/users` (User & Shluchim Consolidation)

### A. Page Consolidation
* Merge the **Users** page and the **Shluchim** page into a unified interface.

- [x] `dashboard/users/page.tsx` rebuilt as a unified directory sourced from
      `/api/users` (admin/staff/shliach) + `/api/contacts/list?contact_type=shliach`
      (geo scoping, phone, login status — including a synthetic row for a
      shliach whose login was deleted outright, "login_status === missing",
      so that recovery case isn't lost in the merge). `dashboard/shluchim`
      now redirects to `/dashboard/users`; its nav entry removed; the 3
      internal links that pointed at it updated. See plan file for the full
      data-model rationale (no backend schema changes were needed).

### B. Feature Alignment with `contact_mekurav`
Incorporate the full suite of management features from the `contact_mekurav` module into the merged Users table:
1. **Filtering:** Add role-based filtering (specifically toggling/filtering by `Admin` and `Shliach` roles).
2. **Column/Row Reordering:** Allow custom ordering of table display rows.
3. **Column Visibility:** Add column picker functionality to choose which fields/rows are displayed.
4. **Inactive Users Toggle:** Add a toggle/filter to hide or show inactive users.

- [x] 1. Role filter: multi-select (admin/staff/shliach), default = all.
      Live-verified: selecting "מנהל" narrowed 8 rows → 1.
- [x] 2. Column reorder: same SortableJS chip pattern as Contacts/Reports
      (`useSortableList`), ▲/▼ fallback buttons included.
- [x] 3. Column visibility: Email/Phone/Created At toggleable via a "⚙
      התאמת עמודות" panel (`useDbPreference("users.columns", …)`). Area/
      Building was scoped OUT as a *column* — the backend doesn't populate
      building/area names for shliach contacts (only mekurav, via their
      apartment) — but the area/building *filters* from the old Shluchim
      page were preserved.
- [x] 4. Inactive toggle: "הצג משתמשים לא פעילים" checkbox, default hides
      `is_active === false` (and synthetic missing-login rows).

### C. Role Management
* Add dynamic UI and API functionality allowing administrators to change a user's role directly from the list or detail view.

- [x] Inline `<select>` directly in each admin/staff row (no need to open
      the edit form) — `PUT /api/users/{id}` with `{role}`; disabled for the
      caller's own row and for shliach rows (role is contact-linked,
      unchanged rule). The existing edit-form role picker still works too.
      No backend change needed (`OrgUserUpdate.role` already existed).

---

## Verification detail

- `docker exec sheepsidebay_crm-frontend-1 npx tsc --noEmit` → exit 0.
- `docker exec sheepsidebay_crm-backend-1 pytest -q` → 415 passed.
- Headless-Chrome (Playwright, local `.venv`) drive: logged in as
  `admin@demo.local`, exercised all 4 areas with DOM assertions +
  screenshots (settings font swap/reset, reports card background, visit-
  summary owner filter + Show All Records, users role filter narrowing,
  columns panel, `/dashboard/shluchim` → `/dashboard/users` redirect). No
  new console errors beyond pre-existing/unrelated ones (Google Sign-In
  origin warning, a benign Next dev-mode RSC prefetch fallback).
- New Hebrew strings added to `backend/app/seed.py` `LOCALIZATION` (picked
  up automatically on next backend startup — `seed_all` runs idempotently
  every boot, no manual reseed needed).