# Fixes 7 — Technical Implementation Plan

Written before any functional code, per the crucial rule in `docs/fixes7.md`.
Every new UI string is added to the localization seed (he + en); every new field
is registered in `dashboard/fields` and (where constrained) in `dashboard/picklists`.
All schema changes ship as a sequential Alembic migration (no data loss).

---

## 0. Database migration (one sequential revision)

**New file:** `backend/alembic/versions/e5f6a7b8c9d0_fixes7_floors_and_apartment_fields.py`
(`down_revision = "d4e5f6a7b8c9"` — the current head).

Changes (all batch-safe for SQLite, plain for Postgres):

1. **Create `floors`** — `id` PK autoincrement, `guid` (unique, 36), `organization_id`
   FK→organizations (indexed), `building_id` FK→buildings **ON DELETE CASCADE** (indexed),
   `name` String(50) NOT NULL, `sort_order` Integer NOT NULL default 0,
   `created_at` DateTime.
2. **`buildings.building_name`** → `nullable=True` (relaxed constraint, §2).
3. **`apartments.apartment_name`** → `nullable=True` (de-escalated, §4).
4. **`apartments`** add columns (§4): `floor` String(50) NULL,
   `jewish_status` String(100) NULL, `campaign_status` String(100) NULL,
   `mezuzah_status` String(100) NULL, `name` String(150) NULL (resident),
   `phone` String(50) NULL, `email` String(255) NULL.

`building_address` stays DB-nullable (legacy rows) — the *required* rule (§2) is
enforced at the API-schema + form level, so no production data is invalidated.

Downgrade reverses everything (drop columns, restore NOT NULLs, drop `floors`).

---

## 1. User access & security — admin role expansion

Backend — `backend/app/routers/users.py` (expand from read-only):
- `GET /api/users` — unchanged (org-scoped list), but `UserOut` gains
  `email`, `is_active` so the management UI can render them.
- `POST /api/users` (**require_admin**) — body `OrgUserCreate`
  `{full_name, email (required), role: 'admin'|'staff', username?, password?, phone?}`.
  * Email must be globally unique (400 otherwise, same rule as signup).
  * `username` defaults to the email; `password` optional — when omitted the
    account is **Google-only** (`password_hash=None`), matching the shliach
    pattern: identity resolves via the verified Google email through the existing
    `POST /api/auth/google` (no backend change needed there — it already links
    by email and binds `google_sub` on first sign-in).
  * `is_active=True`, `email_verified=True` (admin-provisioned).
  * **Welcome automation:** send the same transactional template used for new
    shliach accounts — reuse `send_shliach_welcome()` (`HTML/hello_shliach.html`),
    guarded so an SMTP failure never fails the request.
- `PUT /api/users/{id}` (**require_admin**) — `OrgUserUpdate`
  `{full_name?, role? ('admin'|'staff'), is_active?, password?}`; org-scoped 404;
  an admin cannot demote/deactivate **themselves** (guards against lockout).
- `DELETE /api/users/{id}` (**require_admin**) — org-scoped; not self.

Schemas — `backend/app/schemas.py`: `OrgUserCreate`, `OrgUserUpdate`; extend `UserOut`
with `email: Optional[str]`, `is_active: bool = True`.

Frontend:
- **New page** `frontend/app/dashboard/users/page.tsx` (admin-only, mirrors the
  shluchim table): list of org users (name, email, role badge, status), a
  create form and per-row edit with a **role select** — "מנהל / Admin" and
  "משתמש מוגבל / Restricted user" — plus optional password (blank ⇒ Google
  sign-in only, shown as a hint).
- Nav: add `nav.users` under the People menu (admin-only) in
  `frontend/app/dashboard/layout.tsx`.
- Localization seed: `nav.users`, `users.*` strings (he/en).

## 2. Buildings & apartments UI refactor

**Canonical display string** — `[Street number] + [Street name]`, i.e. the first
comma-segment of the formatted address ("770 Eastern Pkwy, Brooklyn, NY" → "770
Eastern Pkwy"):
- Frontend helper `buildingDisplayName(b)` in `frontend/lib/types.ts`
  (street-part of `building_address`, falling back to `building_name`, then `#id`).
  Used in: buildings list rows, building detail header, `BuildingsMap` markers,
  apartments list/detail, `ApartmentPicker`, `BuildingMultiSelect`, apartment
  editors' building dropdowns.
- Backend equivalent `building_display_name()` in a new `backend/app/core/display.py`,
  used by `/api/search` (building hit titles, apartment subtitles).

**building_name optional + hidden by default:**
- `BuildingCreate/Update`: `building_name: Optional[str]`.
- Forms: field hidden unless `dashboard/fields` shows it; not `required`.
- `backend/app/field_registry.py`: add a `DEFAULT_HIDDEN` set + registry entries for
  entity `building` (`buildings.building_name` — default hidden) and the apartment
  block (§4). `list_field_settings`/`set_field_setting` honour per-field defaults
  (absence of a row = the field's default, so no org backfill).

**Address required:** `BuildingCreate.building_address: str` (min length 1);
`BuildingUpdate` rejects explicit empty; both building forms mark the address
input `required`.

**Inline apartment mutations (contact-style flow):**
- Upgrade `frontend/app/dashboard/apartments/[id]/page.tsx` from read-only to
  view + **edit mode** (same structural flow as a contact card: fetch detail,
  edit button → form → PUT → refreshed view, delete for admins).
- Keep/extend the inline row editor on the apartments page (modal-style editor
  component `ApartmentEditor` shared by add + edit).

**Apartment list filters (`GET /api/apartments/list`):**
- Add query params `building_id: int?` and `q: str?` (street lookup: ilike on the
  parent `building_address`, plus apartment label/resident name).
- Apartments page: building dropdown filter + debounced street-search input.

## 3. Floors entity

- Model `Floor` in `backend/app/models.py` (+ `Building.floors` relationship,
  `cascade="all, delete-orphan"`, ordered by `sort_order, id`).
- Schemas: `FloorOut {id, guid, building_id, name, sort_order}`, `FloorCreate {name}`,
  `FloorUpdate {name?, sort_order?}`; `BuildingOut.floors: list[FloorOut]`;
  `BuildingCreate.floors: list[str] = []` (creation hook), or a
  `num_floors: int?` convenience the frontend expands to `["1".."N"]`.
- Router (`buildings.py`): `GET/POST /api/buildings/{id}/floors`,
  `PUT/DELETE /api/buildings/{id}/floors/{floor_id}` (mutations admin-only,
  org-scoped, building-scoped 404s).
- Building creation hook: `create_building` inserts one `Floor` row per requested
  name in the same transaction.
- UI: the add-building page gets a "מספר קומות" (floors count) input that
  auto-populates floors 1..N; `BuildingEditor` gets a floors chip-list with
  add / rename / delete.

## 4. Apartment schema refinement

- `ApartmentBase/Create/Update` add: `floor?`, `jewish_status?`, `campaign_status?`,
  `mezuzah_status?`, `name?` (resident), `phone?` (validated with the shared
  `_validate_phone`), `email?` (RFC check mirroring `isValidEmail`);
  `apartment_name` becomes optional.
- Picklist validation on write for the three constrained fields (via
  `validate_picklist_value`), keys: `apartment.Jewish_status`,
  `apartment.campaign_status`, `apartment.mezuzah_status`.
  * `picklist_utils.PICKLIST_FIELDS` += the three keys (Hebrew: יהדות — דירה,
    סטטוס קמפיין, מזוזה); `FIELD_KEY_TO_COLUMN` += their apartment columns
    (usage counting / hard-delete guard).
  * Seed values: `apartment.Jewish_status` = the six spec options
    (/, יהודי, יהודי מעוניין ביהדות, יהודי וגוי, יהודי מעוניין וגוי, יהודי שתומצ);
    `apartment.mezuzah_status` = נבדק / צריך בדיקה; `apartment.campaign_status`
    starts empty (admins add options). `seed_all` already backfills definitions
    to every existing org on startup. The spec's Jewish-status options already
    encode combinations ("יהודי וגוי"), so the field is a single-select of many
    choices — consistent with every other picklist in the system.
- **Computed title:** helper `apartmentTitle(apt)` in `lib/types.ts` —
  `apartment_name + floor` (e.g. label "A" + floor "1" ⇒ "A1"), falling back to
  label-only / floor-only / resident name / `#id`. Backend twin in
  `core/display.py` for search-hit titles. Used everywhere an apartment renders.
- **Field toggles:** register the apartment block in `field_registry.py`
  (entity `apartment`): `apartments.apartment_name` (**default hidden**),
  `apartments.floor`, `apartments.apartment_notes`, `apartments.name`,
  `apartments.phone`, `apartments.email`, `apartment.Jewish_status`,
  `apartment.campaign_status`, `apartment.mezuzah_status`.
  `dashboard/fields` page gains "בניין / Building" and "דירה / Apartment" groups.
- **Picklists page:** group definitions — `apartment.*` under a "דירה / Apartment"
  subsection heading, the rest under the existing flat list.
- Apartment editors (list page, building row inline, detail page) render the new
  inputs (floor select fed by the building's floors, resident name, `PhoneInput`,
  `EmailInput`, three `PicklistSelect`s) gated by `useFieldSettings`.

## 5. Bulk apartment batch generator

- Backend `POST /api/apartments/batch` (staff/admin):
  `{building_id, floor_ids: list[int], labels: list[str]}` →
  validates building + floors belong to the org/building, computes the Cartesian
  product floors × labels, batch-inserts `Apartment(building_id, floor=floor.name,
  apartment_name=label)` in **one transaction** (single commit), skipping
  combinations that already exist (same building + floor + label). Returns
  `{created: n, skipped: n}`.
- Frontend: "יצירה מרובה" button on the apartments page opens a modal:
  1) building dropdown; 2) multi-checkbox floors of that building;
  3) explicit token chips for apartment letters/numbers (text input + Add,
     removable chips — no range slider). Submit → toast with created/skipped,
  list reloads.

## 6. Global navbar search — audit result

`GlobalSearch.tsx` + `GET /api/search` already exist (fixes6): debounced input in
the persistent header, org-scoped lookups across contacts, areas, buildings and
apartments with grouped live results. **Per the spec's verification note the
implementation is skipped**; only the result titles are touched so buildings and
apartments use the new canonical display strings (§2/§4).

## 7. Geospatial: zones view + geofence guardrail

**A. Region polygon interface:** new `frontend/components/AreasMap.tsx` — one
Google map (the library already integrated app-wide; no new dependency) rendering
**all** area polygons (parsed from stored GeoJSON) with labels/click →
area page, fitted to their combined bounds, org default center fallback.
Embedded at the top of `/dashboard/areas`.

**B. Geofenced validation interceptor:** client-side runtime check in both
building forms (`buildings/add`, `BuildingEditor`):
- New `frontend/lib/geo.ts` — `pointInPolygon(lat, lng, geojson)` (ray casting).
- On submit, if the geocoded point falls **outside** the selected area's polygon,
  submission is intercepted and a prominent warning banner is shown
  ("⚠ הכתובת מחוץ לתחום האזור שנבחר"); the user must explicitly click
  "שמור בכל זאת" (save anyway) to proceed. Areas without a polygon skip the check.

## 8. Contacts directory table

- **A.** Remove the dedicated color column (header + cell + its `colCount`
  contribution). The color property already tints the whole row via
  `rowStyle()` (low-opacity background + start border) — keep that as the sole
  color rendering; the `contacts.color_tag` visibility toggle now gates the tint.
- **B.** Full-width, high-density layout:
  - `dashboard/layout.tsx`: widen the chrome — header inner container and `<main>`
    go from `max-w-6xl` to full width (`max-w-none px-4 md:px-6`); inner pages
    keep their own `max-w-*` so nothing else stretches awkwardly.
  - Contacts table: drop `min-w-[640px]`, tighter cells (`px-3 py-1.5`),
    `table-auto w-full` with conservative column widths so the table fills the
    viewport without horizontal page scrolling.

---

## Localization additions (seed, he/en)

`nav.users`, `users.*` (title, add, role labels admin/restricted, google-only hint,
deleted/updated toasts, self-guard message), `buildings.floors`, `floors.*`
(add/count/name), `apartments.*` new column labels (floor, resident name, phone,
email), `picklist.apartment.*` display names, `batch.*` (modal title, floors,
labels, add-token, created/skipped toast), `areas.map_all` heading,
`geo.outside_area_warning`, `geo.save_anyway`, fields-page group headings
(`building`, `apartment` — via existing `buildings`/`apartments` table keys).

## Tests (backend, pytest in Docker)

New `backend/tests/test_fixes7.py`:
- users: admin creates admin/staff user (email-only ⇒ Google-only), non-admin 403,
  self-demotion blocked, duplicate email 400.
- floors: created with building (hook), CRUD, cascade on building delete.
- buildings: address now required (422 without), building_name optional.
- apartments: new fields round-trip, phone/email validation, picklist validation
  for the three apartment picklists, `/list` filters (building_id, street q).
- batch: cartesian creation in one transaction, duplicate skip, cross-org 400.
- field settings: building/apartment keys present, `building_name` +
  `apartment_name` default hidden, override to visible works.
- search: building/apartment titles use composite address / computed title.

## Execution order

0. Plan (this file) → 1. migration + models → 2. schemas/registries/seed →
3. backend routers (users, buildings+floors, apartments+batch, search titles) →
4. backend tests green → 5. frontend lib helpers → 6. frontend pages/components
(§1 users, §2–5 buildings/apartments, §7 maps, §8 contacts/layout) →
7. localization seed strings → 8. full test suite + docker smoke.
