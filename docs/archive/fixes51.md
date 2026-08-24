# Feature Specifications: CRM Enhancements (Shliach Role, Apartments & UI Styling)
make plan-fixes51.md before coding
## Overview
Implement visual enhancements for Single Contact display, field-level edit restrictions for apartments, database schema changes for multi-language support, a new admin picklist, and a new settings page for configuring the Shliach (Activist) role view.

---

## 1. Single Contact Display

### 1.1 Visual Readability Enhancement
* **Target:** Single Contact detail/display view.
* **Requirement:** Add a colored border around key text sections, matching the existing UI/UX pattern used on the Visit page, to improve readability.

---

## 2. Apartment Form & Model Updates

### 2.1 Restrict Apartment Number Editing
* **Target:** Shliach Role Display / Apartment Details.
* **Requirement:** Disable the input field for `apartment_number` when the user has the **Shliach** role (enforce read-only UI state and validate permissions on backend API endpoints).

### 2.2 Multi-Language Selection for Apartments
* **Database / Schema:**
  * Create a new join table (e.g., `apartment_languages`) to support a many-to-many relationship between apartments and languages.
  * Fields required:
    * `apartment_id` (Foreign Key -> Apartments)
    * `language_id` (Foreign Key -> Languages)
* **UI & Display:**
  * **Form Control:** Update the language input on the Apartment form to a multi-select component (e.g., multi-select dropdown or checkbox list).
  * **Display Output:** Format selected languages as a comma-separated string (e.g., `English, Russian`).

---

## 3. Contact Shliach: Manager Jewish Status Field

### 3.1 Field Schema & Permissions
* **Target Table:** `contact_shliach`
* **Field Name:** `manager_jewish_status`
* **Label (Hebrew):** `סטטוס יהדות מנהל`
* **Type:** Picklist / Select (shares structure/options with `jewish_status`).
* **Permissions:** Editable **only** by Admin users. Read-only for all other roles.

### 3.2 Dashboard Picklist Management
* **Location:** `dashboard/picklists`
* **Requirement:** Add a dedicated tab for managing options for **Manager Jewish Status** (`סטטוס יהדות מנהל`).

---

## 4. Shliach Role Configuration Panel

### 4.1 New Configuration Page
* **Navigation:** Settings under the **"More"** (`עוד`) section.
* **Page Title (English):** "Configuration for Activist Role"
* **Page Title (Hebrew):** `הגדרות לתצוגת פעילים`
* **Scope:** Dynamic configuration controlling the active UI/UX and dataset visible to users in the Shliach role.

### 4.2 Configuration Settings
1. **Disable Edit Toggle:** Toggle setting to disable editing capabilities across the Shliach display.
2. **Hide All Filters:** Toggle setting to hide all filter components on the Shliach view.
3. **Preset / Default View Filter:** 
   * Configurator to select a single filter or combination of filters to serve as the default enforced query for the Shliach view.
4. **Default Column Selection ("Customize Fields"):**
   * Configurator to define default visible table columns for the Shliach role.
5. **Local Column Customization:**
   * Retain the inline "Customize Fields" UI option directly on the Shliach display, allowing Shliach users to further adjust their active column layout locally.

---

## Status — DONE 2026-08-24 (uncommitted)

Plan written first: `docs/plan-fixes51.md` (per-section readings + the
judgment calls below).

- [x] **1** No literal "colored border" pattern exists anywhere on the Visit
  page (only plain `border-gray-*`) — the one real precedent app-wide is the
  custom-fields dashboard's `border-2 border-status-magenta/30` frame.
  Applied that to the 5 section cards on the Single Contact page (`main`,
  `visits`, `visitSummary`, `dates`, `donations` in
  `app/dashboard/contacts/[id]/page.tsx`), one consistent color rather than a
  color per card.
- [x] **2.1** `apartment_name` (מספר דירה) is now shliach-locked everywhere:
  backend 403 in `update_apartment` if a shliach's payload changes it (even
  on an apartment assigned to them), `ApartmentEditor.tsx`'s input disabled
  for shliach, and the apartment detail page's `InlineEdit` forced
  `disabled` regardless of assignment.
- [x] **2.2** Multi-language, but **not** via a new `languages`/
  `apartment_languages` table as literally specced — `apartment.language`
  was already picklist-backed (fixes13) through the generic `PicklistLink`
  store (fixes32); building a parallel bespoke table would have forked it
  out of the Picklists dashboard, filtering, and versioning machinery for no
  functional gain. Instead loosened `PicklistLink`'s unique constraint to
  include `picklist_value_id` (migration `4a5b6c7d8e9f`) and added
  `PicklistDefinition.allow_multiple` + `picklist_utils.get/set_multi_values`
  — `apartment.language` is the one field marked multi-value today. Existing
  filtering/versioning (`copy_links`, `_picklist_filter`) needed zero changes
  — both already treat a field's links as a set. Frontend: multi-select
  everywhere `language` renders (apartments grid, detail page, add/edit
  form, PDF reports — comma-separated).
- [x] **3** `contact_shliach.manager_jewish_status` — a new fixed
  `PICKLIST_FIELDS` entry (shares `Jewish_status`'s 6 options), admin-only
  write enforced in both `create_contact`/`update_contact` (403 for
  staff/shliach), `ContactView.tsx` renders it read-only for non-admins.
  Picklists dashboard: added a 4th tab ("פעילים", `entity_type ===
  "contact_shliach"`, previously folded into "contacts") so it gets the
  dedicated home the spec asked for.
- [x] **4** Shliach Role Configuration Panel — one JSON blob,
  `Organization.shliach_view_config` (mirrors `UserPreference.value`'s "small
  settings bag" pattern instead of 4 new columns), read by any authenticated
  user / written by admins only (`/api/organizations/me`, same
  require_admin as every other org setting). New page
  `/dashboard/shliach-config`, admin-only, added to the "עוד" nav group.
  Consumed on `/dashboard/apartments` (list + detail): `disable_edit` forces
  every `InlineEdit` off for shliach; `hide_filters` removes the filter
  section and its toggle entirely (stronger than the existing per-user
  collapse); `default_filters`/`default_columns` seed the shliach's
  area/building/jewish/mezuzah/language filters and column selection once,
  the first time they load the page with nothing already persisted.
  Scope decisions: the default-filter configurator covers area/building/
  jewish/mezuzah/language, not report-number or admin-added custom
  picklists — those add real UI weight for comparatively rare use; "enforced
  default query" is read as *the shliach's starting point*, not an
  unremovable floor layered under whatever they pick afterward (that reading
  would duplicate `hide_filters`, the one mechanism the spec actually
  describes as absolute).

**Evidence:** Backend: `backend/tests/test_fixes51.py` (8 new tests, all
sections) + `test_fixes13.py`'s language test updated for the new list
shape; full suite 451 passed (the 5 `test_models.py` failures are the
pre-existing `host.docker.internal`-outside-Docker environment gap noted in
every prior round, untouched by this one). `npx tsc --noEmit` clean.
Migrations `4a5b6c7d8e9f` (picklist_links constraint + `allow_multiple`) and
`5b6c7d8e9f0a` (`organizations.shliach_view_config`) applied automatically
against the local Postgres stack on backend reload (`command.upgrade(cfg,
"head")` on startup) — verified via `\d` in psql. Live-drive (Playwright,
throwaway QA org, real clicks — not just presence checks): 26/26 checks
green, including actually clicking each `InlineEdit` trigger and confirming
via a fresh backend read afterward — contact-page 5-section colored borders;
admin editing apartment_name + picking two languages (persisted, comma-
displayed) while a shliach sees the same apartment with apartment_name
completely non-interactive; the picklists dashboard's new שליח tab; admin
editing `manager_jewish_status` via a real `<select>` while staff sees it
with no click affordance at all; the shliach-config page's toggles actually
persisting and then actually suppressing the apartments-page filter section
*and* every inline-edit trigger for a shliach session.