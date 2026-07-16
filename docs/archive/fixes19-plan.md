# fixes19 — Implementation Plan: Report Numbers, Apartment History & Architectural Adjustments

Spec: `docs/fixes19.md`. This plan locks the architecture, schema changes and route
designs before any code changes (spec instruction #1).

---

## 0. Design decisions (deviations / clarifications called out explicitly)

1. **`apartments.editor_id` → `users.id`** (spec allows "contact.id *or user identity
   system*"). Edits are performed by logged-in `users`, not contacts; the history
   dropdown needs the editor's display name, which is `users.full_name`. A contact FK
   would be unresolvable for admin/staff editors who have no contact row.
2. **Version lineage column `root_id`** (self-FK on `apartments`, not in the spec's
   field list). The spec's edit lifecycle inserts a *new* active row per edit, so the
   active row's `id` changes on every save. Without a lineage key the history view
   cannot collect "previous updates of this apartment". `root_id` points at the first
   version of the lineage (`NULL` = the row is its own root). This is the minimal
   extra column that makes the mandated design workable.
3. **FK re-pointing on version bump.** `contact_mekurav.apartment_id` references the
   active apartment row. When an edit retires row X and inserts row Y, every
   `contact_mekurav.apartment_id = X` is re-pointed to Y, so contact↔apartment links
   survive versioning.
4. **`report_number` reads are open to any authenticated org user; mutations are
   admin-only.** The spec demands `require_admin` on the CRUD; but the apartment
   create/edit forms (open to staff and shliach users by design since fixes7) need
   the list for the searchable dropdown. This mirrors the established picklist rule
   ("reads open to the org, writes admin-only", CLAUDE.md §4). The *management* UI
   (page + create/update/delete routes) is strictly admin-gated.
5. **Shliach apartment visibility becomes area-based.** With
   `contact_shliach_apartment` gone, a shliach user's apartment scope (apartments
   list, pickers) derives from the areas they cover (`contact_shliach_area`):
   apartments of buildings inside those areas. Reminder emails to "covering shluchim"
   (scheduler) switch to the same area-based lookup.
6. **§5 "Contact_MEKURAV layout area" toggle is implemented with the existing
   per-org FieldSetting mechanism**, as a new section-level key
   `contact_mekurav.section` listed in `DEFAULT_HIDDEN`. Rationale: FieldSetting is
   the system's configuration surface for show/hide of interface blocks (admin-only
   writes, per-org, no backfill needed for "hidden by default" — exactly the §5
   seeding requirement). The toggle appears in the admin **fields configuration
   page** automatically. When hidden, the mekurav fields block disappears from the
   contact form and the contact view.
7. **Town-house naming**: the spec's `[Building Contact Name]-th` is read as the
   building's display name — `building_name`, falling back to the street part of
   `building_address` (the system-wide `buildingDisplayName` rule) — suffixed with
   `-th`.
8. **Deleting an apartment (admin-only) deletes its whole lineage** (active +
   historical rows), so no orphaned invisible rows remain.

---

## 1. Schema (Alembic revision `b4c5d6e7f8a9`, revises `a3b4c5d6e7f8`)

### New table `report_number` (מספר דוח)
| column | type | notes |
|---|---|---|
| id | Integer PK | |
| guid | String(36) unique | house standard |
| organization_id | FK organizations.id, indexed | tenant isolation |
| name | String(150) NOT NULL | |
| created_at | DateTime | |

### New bridge `report_number_contact_shliach` (M2M)
| column | type | notes |
|---|---|---|
| id | Integer PK | |
| guid | String(36) unique | |
| organization_id | FK organizations.id, indexed | |
| report_number_id | FK report_number.id (ondelete CASCADE), indexed | |
| contact_shliach_id | FK contact_shliach.id (ondelete CASCADE), indexed | |
| UNIQUE(report_number_id, contact_shliach_id) | | idempotent links |

### Drop `contact_shliach_apartment`
Table + indexes dropped; `ContactShliachApartment` model, relationships
(`ContactShliach.apartments`, `Apartment.shluchim`) and every query using them
removed (contacts, apartments, areas, scheduler, admin cascade, backup).

### `apartments` — new columns
| column | type | default |
|---|---|---|
| is_display | Boolean NOT NULL | true (server_default) |
| last_edit | DateTime NULL | stamped on the retired row |
| editor_id | FK users.id NULL | who retired the row (see §0.1) |
| report_number_id | FK report_number.id NULL | searchable dropdown value |
| root_id | FK apartments.id NULL, indexed | version lineage (see §0.2) |

### `buildings` — new column
| column | type | default |
|---|---|---|
| is_town_house | Boolean NOT NULL | false (server_default) — label בית פרטי / Town house |

---

## 2. Backend routes

### New router `app/routers/report_numbers.py` → `/api/report-numbers`
- `GET ""` — list (org-scoped, any authenticated user; feeds dropdowns).
- `GET "/{id}"` — single (any authenticated user).
- `POST ""` — create (**require_admin**).
- `PUT "/{id}"` — rename (**require_admin**).
- `DELETE "/{id}"` — delete (**require_admin**); cascades bridge rows, nulls
  `apartments.report_number_id`.
Schemas: `ReportNumberCreate/Update/Out` (name validated non-empty, like AdminArea).
Registered in `app/main.py`.

### `contact_shliach` payloads (schemas + contacts router)
- `ShliachData`: `apartment_ids` **removed**, `report_number_ids: list[int] = []` added.
- `ShliachOut`: same swap.
- `_set_shliach_apartments` → `_set_shliach_report_numbers` (validate ids org-scoped,
  replace-all semantics like areas).
- Contacts list `building_ids` filter no longer applies to shliach contacts (the
  structural link is gone); the `area_ids` filter (via `contact_shliach_area`) stays.

### Apartments router
- **Versioned update** (`PUT /api/apartments/{id}`):
  1. 404 unless the target row `is_display == true` (historical rows are immutable).
  2. Retire: `old.is_display = False`, `old.last_edit = utcnow()`,
     `old.editor_id = current_user.id`.
  3. Insert new row: copy of all data columns, updated fields applied,
     `is_display=True`, `root_id = old.root_id or old.id`, fresh guid.
  4. Re-point `contact_mekurav.apartment_id` old → new.
  5. Return the new row.
- **History** (`GET /api/apartments/{id}/history`, **require_admin**): versions of the
  row's lineage with `is_display == false`, newest first, each with
  `editor_name` + `last_edit` (+ full snapshot fields for the read-only render).
- **Scoped reads**: every list endpoint filters `is_display == true`; `GET /{id}` of a
  historical row is admin-only (404 for non-admins) so the mekurav-facing views can
  never see history.
- `shliach_contact_id` filter on `/list` removed (its UI — the covered-apartments
  grid — is deleted per §2 of the spec).
- Shliach user scoping switches to area-based (§0.5).
- `report_number_id` accepted on create/update, validated org-scoped.
- `DELETE /{id}` removes the full lineage (§0.8).

### Buildings router
- `BuildingCreate` gains `is_town_house: bool = False`; `BuildingOut`/`Update` expose it.
- Creation interceptor: when `is_town_house` — skip floor creation entirely and insert
  exactly one apartment named `<building display name>-th`.

### Organization / settings
No new org column — §5 rides on FieldSetting (`contact_mekurav.section`,
DEFAULT_HIDDEN), see §0.6.

### Housekeeping
- `core/backup.py` SNAPSHOT_MODELS: drop ContactShliachApartment; add ReportNumber
  (after AdminArea) + ReportNumberContactShliach (after ContactShliach). Apartment
  moves after Contact/ContactShliach? — no: Apartment gains FK to report_number and
  users only; keep order Area→AdminArea→ReportNumber→Building→Floor→Apartment→…,
  with ReportNumberContactShliach after ContactShliach. `editor_id` is a user link →
  added to the restore user-repair list (nulled when the user no longer exists).
- `routers/admin.py` org-delete cascade: same swap (bridge before ContactShliach and
  before ReportNumber; ReportNumber before... it's a leaf parent — delete after
  Apartment since apartments.report_number_id references it; nulling not needed as
  the whole org goes).
- `scheduler.py` `_recipients`: apartment-coverage lookup → area-coverage lookup.
- `routers/areas.py`: `_shliach_area_ids` loses the via-apartment branch;
  `area_shluchim` loses the via-apartment branch.

---

## 3. Seeding & localization (global `LOCALIZATION` rows + registry)

New rows (he / en):
- `table` `report_number` — מספר דוח / Report number
- `column` `report_number.name` — שם / Name
- `nav` `nav.report_numbers` — מספרי דוח / Report numbers (+ page strings:
  `page.report_numbers`, `report.add`, `report.none`, `report.delete_confirm`, …)
- `column` `apartments.report_number_id` — מספר דוח / Report number
- `column` `buildings.is_town_house` — בית פרטי / Town house
- `column` `contact_shliach.report_numbers` — מספרי דוח באחריות הפעיל / Activist report numbers
- `column` `contact_mekurav.section` — אזור פרטי מקורב / Mekurav details section
- history strings: `apt.history` (היסטוריית שינויים / Edit history),
  `apt.history_current` (גרסה נוכחית / Current version), `apt.history_pick`
  (בחר גרסה קודמת… / Pick a previous version…), `apt.history_snapshot`
  (תצוגת גרסה היסטורית לקריאה בלבד / Read-only historical snapshot).

`field_registry.py`:
- remove `contact_shliach.apartments`; add `contact_shliach.report_numbers`.
- add `apartments.report_number_id` (visible by default).
- add `contact_mekurav.section` + list it in `DEFAULT_HIDDEN` (§5 default-invisible).

---

## 4. Frontend

- **`/dashboard/report-numbers`** (new page, admin-only, mirrors admin-areas):
  list + inline add/rename/delete via `/api/report-numbers`. Nav link (admin only).
- **ApartmentEditor**: add a `SearchableSelect` (searchable dropdown, §3 of spec)
  over report numbers; sends `report_number_id`. After a successful **edit** the
  server returns a *new* apartment id — the edit page navigates to the new detail URL.
- **Apartment detail page**: shows the report number; for admins, a **history
  section**: `<select>` of previous versions labeled "editor name — date/time";
  choosing one renders the full read-only snapshot (Wikipedia-revisions style).
- **ContactForm (shliach block)**: area picker stays; building/apartment
  multi-selects removed; new report-number multi-select (checkbox list like
  AreaMultiSelect). `ShliachFormValues.apartment_ids` → `report_number_ids`.
- **ContactView / contact detail page**: "דירות באחריות הפעיל" grid section deleted
  (`ShliachApartmentsGrid` component removed); shliach view lists its report numbers.
- **ContactForm/ContactView mekurav block**: gated by `vis("contact_mekurav.section")`
  (hidden by default per §5; admins re-enable from the fields configuration page).
- **Buildings add page**: "בית פרטי" checkbox; when checked the floors-count input is
  hidden (no floors are generated); payload carries `is_town_house`. Buildings edit
  page exposes the flag read-only-ish toggle (edit allowed, but no retroactive
  apartment/floor changes).
- **types.ts**: `ReportNumber`; `Apartment` + `is_display/last_edit/editor_id/report_number_id/root_id`;
  `Building.is_town_house`; `Shliach.report_number_ids`.
- Components `ApartmentMultiSelect` / `BuildingMultiSelect` deleted (only consumer
  was the shliach form block).

## 5. Tests

- New `backend/tests/test_fixes19.py`:
  - report-number CRUD: staff mutation → 403, admin CRUD works, org isolation.
  - shliach create/update with `report_number_ids`; detail echoes them; delete of a
    report number detaches links.
  - apartment edit lifecycle: old row retired (`is_display=false`, `last_edit`,
    `editor_id` set), new active row returned, mekurav link re-pointed, lists exclude
    history, non-admin GET of a historical row → 404, admin history endpoint lists
    `editor_name`/`last_edit`, second edit chains `root_id` to the first version.
  - town house: create with `is_town_house=true` → zero floors, exactly one apartment
    named `<name>-th`; regular building unaffected.
  - `contact_mekurav.section` present in field-settings registry and default-hidden.
- Existing tests touching `apartment_ids` / covered apartments (fixes4, 10, 11, 14,
  15, search) updated to the new model (area-based scoping / report numbers).

## 6. Rollout

1. Alembic migration (upgrade path only data-safe: existing apartments become
   `is_display=true` roots; nothing is deleted except the empty-by-then bridge).
2. `docker-compose up --build`, run `pytest` in the backend container.
3. Smoke: create report numbers (admin), assign on apartment + shliach, edit an
   apartment twice → history shows two versions, town-house building, §5 toggle.
