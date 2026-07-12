# fixes18 — Implementation Plan

Spec: `docs/fixes18.md` (the file contains the same spec twice — treated as one).
Everything ships together as one `fixes18` commit, with `backend/tests/test_fixes18.py`
covering the new server behavior.

---

## 1. General requirements

### 1.1 Searchable dropdowns for entity data
A new **`frontend/components/SearchableSelect.tsx`**: a single-select combobox —
a text input that filters the option list inline; arrow-keys/Enter/Escape work;
clicking an option (or Enter) selects it; a clear (✕) affordance resets to the
placeholder ("all"/"none") value. RTL-aware, styled like the existing selects.

Native `<select>`s that display **Apartments / Buildings / Shliach / Mekurav**
rows get converted:

| Location | Data |
| --- | --- |
| `components/ApartmentPicker.tsx` (3 selects: shliach flat list, building, apartment) | apartments + buildings |
| `components/ApartmentEditor.tsx` (building; associate-contact) | buildings + mekurav contacts |
| `components/DonationsEditor.tsx` (contact) | mekurav contacts |
| `components/VisitForm.tsx` (contact) | mekurav contacts |
| `app/dashboard/apartments/page.tsx` (grid building filter; BatchModal building) | buildings |

Not converted (not one of the four entities): floor / role / sort / page-size /
picklist / area selects. `MultiSelectFilter` (not a `<select>`, but the buildings
filter UI on contacts/apartments pages) additionally gains an inline search input
when it has > 8 options, so long building lists are typeable there too.

### 1.2 + 1.3 מצוות קהילה → מבצעים / Community mitzvot → Mivtzoim
`backend/app/seed.py` — exactly 3 rows carry these labels:

| key | he (old → new) | en (old → new) |
| --- | --- | --- |
| `community_checklists` | מצוות קהילה → מבצעים | Community mitzvot → Mivtzoim |
| `filter.mitzvot_only` | רק עם מצוות קהילה → רק עם מבצעים | Community-mitzvot only → Mivtzoim only |
| `filter.all_mitzvot` | מצוות קהילה → מבצעים | Community mitzvot → Mivtzoim |

Because `seed_localization` never overwrites existing rows, each key also gets a
guarded entry in `LOCALIZATION_RENAMES` (fixes13 mechanism) so live DBs pick up
the rename while admin-customized labels survive. Frontend `t()` fallbacks for
these keys (contacts page, contact detail/new pages, `ContactView`) are updated
to the new strings for consistency.

## 2. Localization bugs

1. **`areas.view_area`** — the key + fallback already exist (seed + `AreasMap`).
   The remaining defect: the Google-Maps info-window content is built inside a
   `useEffect` keyed only on the areas signature, so it captures `t` from before
   localization/language resolved and never re-renders on language switch. Fix:
   include the language in the effect deps so the map labels rebuild with the
   active locale.
2. **Logo strings** — seed rows for the keys already used by the UI:
   `signup.org_logo` + `logo.alt` (= "לוגו הארגון" / "Organization logo"),
   `logo.upload` (= "העלה לוגו" / "Upload logo"), plus `logo.upload_failed`
   which lives in the same component and was equally unseeded.
3. **Map hint** — the string lives in `MapPointPicker` and is *already* wired to
   a localization key: `settings.map_pick_hint`; it renders "hardcoded" because
   that key was never seeded. **Deviation from the spec's letter:** the spec
   names `apm.start_hint`, but that key already exists with different text (the
   polygon-drawing hint used by `AreaPolygonMap`) — reusing it would display the
   drawing hint inside Settings. We seed `settings.map_pick_hint` with this exact
   string instead, which achieves the stated goal (the hint becomes a dynamic,
   admin-editable localization row).

## 3. Contacts (mekurav) management

1. **Profile cleanup** — on `/dashboard/contacts/[id]`, the Donations and
   Interactions sections render only for `contact_type === "mekurav"`; a shliach
   profile no longer shows them.
2. **Tzedaka-potential dropdown** — new endpoint
   `GET /api/contacts/tzedaka-values`: distinct, non-empty
   `contact_mekurav.tzedaka_potential` values for the org (shliach-scoped via the
   shared `_contacts_query`). The contacts-page free-text filter becomes a
   dropdown of those values; the server filter switches from `ILIKE %…%` to an
   exact match (values now come verbatim from the DB).
3. **Area column default-off + removal** — `area` is deleted from the grid's
   `COLUMN_KEYS` (so it leaves the Customize Columns panel *and* the table);
   stale saved preferences that still contain `"area"` are already ignored by the
   `COLUMN_KEYS.filter(...)` intersection.
4. **Admin Area column** — new `admin_area` entry in `COLUMN_KEYS` +
   labels/availability/cell; available to admin/staff (shliach is blocked from
   the admin-areas section per fixes10). Backend: `ContactOut.admin_area_name`,
   enriched in `_list_item` from `mekurav.admin_area`.
5. **Admin Area filter** — `admin_area_ids` (repeated int param) on
   `/api/contacts/list` + `/api/contacts/emails`, filtering through a
   `ContactMekurav` subquery; frontend adds a `MultiSelectFilter` fed by
   `GET /api/admin-areas` (admin/staff only). Persisted like the other filters.
6. **Profile data display** — `ContactView` already renders אזור מנהל via
   `contact_mekurav.admin_area_id`; no change needed (verified).

## 4. Area management (`/dashboard/areas/[id]`)

1. **Duplicate button** — the empty-state paragraphs' inline "הוסף פעיל" /
   "הוסף בניין" links are removed; each section keeps a single header action.
2. **Add Activist** — the header action becomes a dropdown (SearchableSelect) of
   all shliach contacts (fetched via `/api/contacts?contact_type=shliach`,
   minus those already covering the area). Picking one calls the new
   `POST /api/areas/{area_id}/shluchim` `{contact_id}` (admin-only): validates
   the contact is an org shliach, get-or-creates the `contact_shliach_area`
   link, and the page reloads its lists. A secondary link still leads to
   the new-shliach form for creating a brand-new activist.
3. **Add Building** — the header action becomes a dropdown restricted to
   buildings inside the area's polygon. New endpoint
   `GET /api/areas/{area_id}/eligible-buildings`: org buildings with
   coordinates that fall inside `area_polygon` (ray-casting point-in-polygon —
   new helper `app/core/geo.py`) and not already assigned to this area.
   Selecting one calls the existing `PUT /api/buildings/{id}` with the new
   `area_id`. Areas without a polygon return an empty list and the UI explains
   why; a secondary link keeps the "create new building" flow.

## 5. Apartments (`/dashboard/apartments`)

1. **Clean titles** — `apartment_title` (backend `core/display.py`) and
   `apartmentTitle` (frontend `lib/types.ts`) drop the fixes17 `label - floor`
   hyphen concatenation: the title is the apartment label alone, falling back to
   floor → resident → `#id`. (The floor stays available as its own sort key and
   via the grid's building/floor context.)
2. **New filters** — `/api/apartments/list` gains `jewish_status` and
   `mezuzah_status` (repeated string params, `IN` filters on the apartment
   columns). The grid adds two `MultiSelectFilter`s driven by the
   `apartment.Jewish_status` / `apartment.mezuzah_status` picklists, and the
   existing building filter becomes a SearchableSelect ("Filter by Building
   name" — the filter itself already existed).

## 6. Configuration & permissions

- **Model**: `Organization.shliach_can_view_contacts` (Boolean, NOT NULL,
  default/server-default **false**) + Alembic migration
  `…_fixes18_shliach_view_contacts.py`.
- **API**: exposed on `OrganizationOut` (so it reaches the session's
  `user.organization`) and editable via `PUT /api/organizations/me`
  (`OrganizationUpdate`).
- **Settings UI**: a checkbox in the admin org-settings form, with new seeded
  labels (`page.shliach_view_contacts` + hint).
- **Enforcement** (only when the current user is a shliach and the flag is off):
  - `_contacts_query` additionally restricts to `contact_type == "shliach"`
    (their own record keeps working; mekurav rows vanish from `/api/contacts`,
    `/list`, `/emails`).
  - `GET /api/contacts/{id}` returns 404 for a mekurav row.
  - Global search skips mekurav contacts.
  - Frontend: the "אנשי קשר" nav item is hidden, and the dashboard landing
    redirect sends the shliach to `/dashboard/apartments` instead of the
    contacts list. (Existing admin/staff behavior is untouched.)

## Regression testing

- **New** `backend/tests/test_fixes18.py`:
  - seed rename applied to a DB that carries the old labels; idempotent re-seed;
    customized labels survive.
  - `tzedaka-values` distinctness + exact-match filtering.
  - `admin_area_ids` filter + `admin_area_name` enrichment on `/list`.
  - `POST /areas/{id}/shluchim` (assign, idempotent, 400 on non-shliach, org
    isolation) and `eligible-buildings` (inside/outside polygon, no-polygon,
    no-coords cases).
  - apartments `jewish_status`/`mezuzah_status` filters; hyphen-free
    `apartment_title`.
  - org flag defaults false; admin can toggle; shliach loses/regains mekurav
    visibility on list + detail + search accordingly.
- **Full suite**: `pytest` (run inside the backend Docker container, per repo
  practice). Pre-existing tests asserting the old `"A - 1"` title or old seed
  labels will be updated as part of this change.
- **Frontend**: `tsc --noEmit` + `next lint`; manual smoke pass over the touched
  pages (contacts list/profile, areas detail, apartments grid, settings) via
  `docker-compose up`.
