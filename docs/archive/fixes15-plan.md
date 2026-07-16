# fixes15 — Implementation Plan

Source spec: `docs/fixes15.md`. This plan maps every spec item to concrete code
changes, in the order they will be built.

## 0. Shared infrastructure

- **`frontend/lib/persist.ts`** (new): `usePersistentState<T>(key, initial)` —
  a `useState` drop-in that hydrates from `localStorage` on mount and writes
  back on every change (SSR-safe). All list pages store their filter / sort /
  page-size / column selections under `crm.<page>.<field>` keys. (§1.2)
- **Localization**: every new Hebrew UI string gets a `LOCALIZATION` row in
  `backend/app/seed.py` (house rule) — sort/filter labels, quick-action
  tooltips, delete-confirm modal copy (`בטוח ?`), column-config panel labels.

## 1. General (§1)

- §1.1 Pagination — already server-side on contacts / apartments / buildings.
  Add: **shluchim** (server-side, via `/api/contacts/list`), **users**,
  **areas**, **admin-areas**, **visits** (client-side — small datasets, no API
  change).
- §1.2 State retention — apply `usePersistentState` to filters/sort/page-size
  on contacts, apartments, buildings, shluchim, users, areas, admin-areas.

## 2. Super Admin (§2)

- §2.1 HTML templates + WYSIWYG:
  - Add `shliach_welcome` to `DEFAULT_EMAIL_TEMPLATES` seeded with the **exact
    HTML** of `backend/HTML/hello_shliach.html` (subject `Welcome to the
    system`). `seed_email_templates` already inserts missing keys.
  - Rework `send_shliach_welcome(db, ...)` to send via the DB template
    (placeholders `{{first_name}} {{last_name}} {{url_to_system}}
    {{shliach_email}} {{org_name}} {{logo_url}}`), falling back to the file
    template. Update callers (`contacts.py`, `users.py`).
  - `EmailTemplatesCard`: replace the raw body `<textarea>`s with a
    dependency-free WYSIWYG (contentEditable + toolbar: bold / italic /
    underline / lists / link / align + HTML-source toggle) so HTML templates
    are editable visually.
- §2.2 Shliach (user) deletion safety:
  - New endpoint `GET /api/admin/users/{id}/dependencies` → counts of
    assigned contacts, linked shliach contact, covered apartments/areas,
    interactions authored.
  - Superadmin dashboard: replace `confirm()` user-delete with a localized
    modal that lists the data ties and asks `בטוח ?` before enabling delete.

## 3. Users (§3)

- §3.1 Redirect bug: the only delete that lands on Contacts is
  `contacts/[id]` `remove()` (`router.push("/dashboard/contacts")`) — after
  deleting a **shliach** contact it now returns to `/dashboard/shluchim`
  (the page that manages those users); mekurav deletes keep returning to
  Contacts.
- §3.2 Users table: client-side sorting (name A-Z/Z-A, created date) +
  pagination + persisted state. Welcome email on user creation already runs
  (fixes14) and now goes through the editable `shliach_welcome` template.

## 4. Shluchim (§4)

- §4.1 List: switch to `/api/contacts/list?contact_type=shliach` with
  `sort=name|created`, `dir`, pagination; add **multi-select building** and
  **multi-select area** filters (backend filters via the shliach's
  `ContactShliachArea` / `ContactShliachApartment` links).
- §4.2 Profile: `ContactView` renders shliach-only fields when
  `contact_type === "shliach"` (no pipeline/color/priority/mekurav fields);
  add an embedded, paginated **apartments sub-grid** (new
  `shliach_contact_id` filter on `/api/apartments/list`).

## 5. Contacts / Mekurav (§5)

- Backend `_contacts_query` gains: `q` (name/last-name/phone/email),
  `area_ids` / `building_ids` (mekurav → apartment → building; shliach →
  coverage links), `has_mitzvot` (checklist: any mitzvah boolean TRUE).
- `GET /api/contacts/emails` — distinct non-empty emails for the current
  filter set (feeds bulk email).
- `/api/contacts/list` items gain `area_name` / `building_name` (from the
  mekurav apartment) for the new optional columns.
- Frontend contacts page:
  - Apartments-style filter row: multi-area + multi-building + debounced text
    search, plus the existing status/owner filters and a **mitzvot-only**
    checkbox.
  - Column-config panel (localStorage): default Name / Phone / Assigned-to;
    toggleable Email / Areas / Building / Status / Priority / Created /
    Address. Org-level field-visibility still wins.
  - Per-row quick actions: call (`tel:`), WhatsApp (`https://wa.me/`),
    email (`mailto:`).
  - **Bulk email** button → fetch `/api/contacts/emails` with active filters →
    `mailto:?bcc=…`.

## 6. Manager Area (§6)

- admin-areas page: text filter + sort (name / created, asc/desc) +
  client-side pagination + persisted state. `AdminAreaOut` gains
  `created_at`.

## 7. Buildings & Apartments (§7)

- Buildings: `/api/buildings/list` gains `sort=address|name|area|created` +
  `dir` + repeated `area_ids`; page gets sort controls + multi-area filter
  (+ persisted state). Areas page gets the same multi-select filter over its
  cards/map + client pagination.
- Apartments: `/list` accepts repeated `area_ids` (single `area_id` kept);
  page's area filter becomes multi-select; new **column-config panel** for the
  row attributes (resident, building, area, floor, notes, phone, email,
  statuses) stored in localStorage.

## Testing / verification

- `backend/tests/test_fixes15.py`: contacts q/mitzvot/area/building filters,
  `/emails`, buildings sort + multi-area, apartments `area_ids` +
  `shliach_contact_id`, admin user-dependencies, templated shliach welcome.
- Run backend pytest (Docker), frontend `tsc`/build, and smoke the app.
