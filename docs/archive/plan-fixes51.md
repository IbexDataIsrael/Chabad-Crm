# Plan — fixes51

Written before coding, per the spec's own instruction (`docs/fixes51.md` line 2).
Each section below records what was read, the judgment call taken where the
spec is ambiguous, and the concrete steps.

---

## 1. Single Contact — colored border around key sections

**Read:** `frontend/app/dashboard/contacts/[id]/page.tsx` renders the page as
five `<section>` cards (`main`, `visits`, `visitSummary`, `dates`,
`donations`), each currently `bg-white rounded-xl shadow-sm p-6` — no border
at all. `ContactView.tsx` itself is one flat `<dl>` (sub-section headers were
flattened away in earlier fixes rounds via `sortByFieldOrder`), so there is no
per-topic grouping left to individually frame. Searched the whole frontend
for an existing *colored* border: the only real precedent is
`app/dashboard/custom-fields/page.tsx:159`
(`rounded-2xl border-2 border-status-magenta/30 bg-status-magenta/5 p-5`).
Nothing on `/dashboard/visits` or `VisitForm.tsx`/`VisitDetails.tsx` uses a
colored border today — those only ever use plain `border-gray-100/200`.

**Judgment call:** "matching the existing pattern used on the Visit page" has
no literal match in the code as it stands; the closest real precedent
anywhere in the app is the custom-fields colored frame. Interpreting "key
text sections" as the five section cards on the contact detail page (the
natural, already-existing visual units), apply that same colored-frame
treatment to them: `border-2 border-status-magenta/30` added onto the
existing `bg-white rounded-xl shadow-sm` cards. One consistent color
(magenta, the app's dominant accent, and the one used in the existing
precedent) rather than a different color per card — avoids arbitrary color
assignment with no spec basis.

**Steps:**
- `frontend/app/dashboard/contacts/[id]/page.tsx`: add
  `border-2 border-status-magenta/30` to the 5 `<section>` cards.

---

## 2. Apartments

### 2.1 Restrict apartment_number editing for Shliach

**Read:** the spreadsheet-facing "apartment number" (מספר דירה) is
`Apartment.apartment_name` (renamed via `LOCALIZATION_RENAMES` in fixes13).
`backend/app/routers/apartments.py::update_apartment` already 403s a shliach
editing an apartment not assigned to them, but does not restrict *which*
fields an assigned shliach may change. Frontend inputs for `apartment_name`
live in `ApartmentEditor.tsx` (used by add/edit pages) and as an `InlineEdit`
on `apartments/[id]/page.tsx`.

**Steps:**
- Backend `update_apartment`: if `current_user.role == "shliach"` and
  `"apartment_name" in data` and the new value differs from the current one,
  403 (mirrors the existing assigned-apartment guard style, not a silent
  drop — same "reject, don't ignore" pattern used elsewhere for permission
  violations).
- Frontend `ApartmentEditor.tsx`: disable the apartment_name input when
  `isShliach` (read-only, matching the spec's "disable the input field"
  wording exactly).
- Frontend `apartments/[id]/page.tsx`: the apartment_name `InlineEdit` only
  renders as editable when `onPatch` is passed — gate that on `!isShliach`
  for this one field specifically (same technique used below for
  `manager_jewish_status`).

### 2.2 Multi-language selection for apartments

**Read:** `apartment.language` is **already** a picklist-backed field (fixes13),
stored generically via `PicklistLink` (fixes32) — not a hardcoded column.
`PicklistLink` carries a unique constraint on
`(entity_table, entity_id, picklist_definition_id)`, i.e. exactly one value
per field per entity today; that's the actual single-select constraint, not
the presence/absence of a table.

**Judgment call:** the spec asks for a bespoke `languages` +
`apartment_languages` join table. Building one would duplicate data the app
already has — `apartment.language`'s options (Hebrew/English/Russian/Yiddish)
already live in `picklist_values`, already manageable from the Picklists
dashboard, already wired into apartment filtering
(`_picklist_filter`/`matching_entity_ids` already treat "does this apartment
have ANY of these values" correctly for a multi-valued field, no filter
change needed) and versioning (`copy_links` already copies **all** link rows
forward on an apartment edit, whatever their count). Going with a real new
`languages` table would fork this field out of that whole generic system for
no functional gain and go against CLAUDE.md's "no over-engineering". Instead:
loosen `PicklistLink`'s uniqueness to `(entity_table, entity_id,
picklist_definition_id, picklist_value_id)` and add multi-value get/set
helpers that only `apartment.language` (for now) uses. This is the
architectural equivalent of "one join-table row per selected language" the
spec actually wants, reusing the existing normalized store instead of adding
a parallel one.

**Steps:**
- Alembic migration: drop `uq_picklist_link_entity_field`, recreate it
  including `picklist_value_id`. Add `PicklistDefinition.allow_multiple`
  (Boolean, default False, server_default false); data-migrate
  `system_name = 'apartment.language'` rows (all orgs) to `True`.
- `models.py`: add `allow_multiple` column to `PicklistDefinition`.
- `picklist_utils.py`: add `get_multi_values`/`set_multi_values` (delete all
  existing links for the field then insert one row per value, validating
  each against `validate_picklist_value`). Leave `get_values`/`set_value`
  untouched — every other picklist field stays single-valued.
- `schemas.py`: `ApartmentBase`/`ApartmentUpdate`/`ApartmentOut`:
  `language: Optional[str]` → `Optional[list[str]]` (3 spots).
- `routers/apartments.py`: swap the single-value get/set calls for
  `language` to the multi-value helpers, in create/update/list/detail/bulk
  paths (`_apartment_out`, `create_apartment`, `update_apartment`). Filtering
  (`language: Optional[list[str]] = Query(None)`) is unchanged — it already
  expects a list and already does "any of these values" matching.
- `seed.py`: mark the `apartment.language` `PicklistDefinition` row
  `allow_multiple=True` at provisioning time (new orgs) to match the
  migration's backfill for existing ones.
- Frontend: apartment form's language field becomes a multi-select
  (reuse `MultiSelectEditor`/`MultiSelectSearchFilter` styling family — check
  which one fits an inline multi-pick-from-picklist-options UI) instead of
  `PicklistSelect`. Display: join selected labels with `", "` everywhere
  `language` is shown (apartments list column, apartment detail, PDF
  reports) — same "comma-separated" spec wording.
- `lib/types.ts`: `Apartment`/`ApartmentListItem` etc. `language` field
  type → `string[] | null`.

---

## 3. Contact Shliach — Manager Jewish Status

**Read:** contact-level picklist-backed fields are stored against
`entity_table="contacts"` (not `contact_mekurav`/`contact_shliach` — those
sub-tables don't get their own `PicklistLink` rows; `PicklistDefinition.
entity_type` is only used for **admin-UI grouping**, e.g. which Picklists tab
a field's options are managed from). `ContactView.tsx` already has a fully
generic rendering path for any `entity_type="contact_shliach"` picklist
definition (`shliachPicklistDefs`, fetched from `/api/picklists`, mapped into
`shliachFields` via `inlinePicklist`) — so a new *system* field with that
entity_type needs no new frontend loop, just the one row's edit permission
special-cased.

**Steps:**
- `picklist_utils.PICKLIST_FIELDS`: add
  `"contact_shliach.manager_jewish_status": ("סטטוס יהדות מנהל", "contact_shliach")`.
- `seed.py`: seed the `picklist_def.contact_shliach.manager_jewish_status`
  localization row (Hebrew/English), and pre-provision the
  `PicklistDefinition` (`is_system=True`, `entity_type="contact_shliach"`)
  at org signup like every other fixed field — mirrors `Jewish_status`'s
  provisioning. Since it "shares structure/options with jewish_status", seed
  its `picklist_values` with the same four options (or leave it for the
  admin — check what `Jewish_status`'s own seed rows are and mirror them so
  it isn't a blank list on day one).
- Backend field-level admin-only guard: in `routers/contacts.py`'s
  `update_contact` (and `create_contact` if relevant), before calling
  `_apply_picklist_values`, if `current_user.role != "admin"` and
  `"contact_shliach.manager_jewish_status"` is present in the incoming
  `picklist_values` payload, 403 (mirror the apartment_name guard's
  reject-don't-drop style from §2.1).
- `ContactView.tsx`: in the `shliachPicklistDefs.map(...)` loop, when
  `d.field_key === "contact_shliach.manager_jewish_status" && !isAdmin`,
  render the plain label (no `inlinePicklist`/`InlineEdit`) instead of the
  editable control — read-only for staff/shliach, editable for admin.
- Picklists dashboard tab (§3.2): `app/dashboard/picklists/page.tsx`'s
  `tabFor()` currently collapses `contact_mekurav`/`contact_shliach`/
  `significant_date` all into one `"contacts"` tab. Add a 4th tab keyed off
  `entity_type === "contact_shliach"` (labeled "פעילים"/similar) so Manager
  Jewish Status gets a dedicated tab as asked — this also naturally becomes
  the home for any future contact_shliach-scoped admin picklist, not just
  this one field.

---

## 4. Shliach Role Configuration Panel

**Read:** the "Customize Fields" wording in the spec (§4.2.4/§4.2.5) is
literally the Apartments page's own existing column-selector feature
(`⚙ התאמת שדות`, confirmed via grep — also referenced by that exact name from
`reports/create/page.tsx`'s comments). So this whole section targets the
**Apartments** grid's shliach experience specifically (also consistent with
§2 of this same spec being about apartments). `useAuth()` already exposes
`user.organization` end-to-end (from `/api/auth/me`'s `UserOut.organization:
OrganizationOut`), so a new JSON config blob on `Organization` is available
on every page for free, no new fetch needed. `organizations.py`'s `PUT /me`
is already `require_admin`-gated; `GET /me` is open to any authenticated
user — exactly the read/write split this needs.

**Judgment call:** one JSON column (`shliach_view_config`) rather than 4
separate typed columns — matches the existing `UserPreference.value` JSON
pattern already used elsewhere in this codebase for exactly this shape of
"a small bag of settings", and keeps this one feature's config atomic/
versionable as a single blob instead of 4 migrations. Shape:
```
{
  "disable_edit": bool,
  "hide_filters": bool,
  "default_filters": { ...same shape as the apartments list's filter state... },
  "default_columns": string[] | null
}
```
"Preset / Default View Filter" (§4.2.3, "serve as the default enforced query")
is read as: the Shliach view's **initial** filter state on load (their
landing view) — not an unremovable floor added server-side on top of
whatever the shliach later picks. The spec doesn't say the shliach must be
blocked from changing it once loaded (that would also fight §4.2.2's
independent "hide filters" toggle, which is the one place the spec actually
asks for something un-overridable), so treating it as the seeded default
values for the existing filter `usePersistentState`s (only applied once, when
the shliach has no locally-persisted filter state yet) is the minimal reading
that doesn't invent a second enforcement mechanism the spec never describes.

**Steps:**
- `models.py`: `Organization.shliach_view_config = Column(JSON, nullable=True)`.
- Alembic migration for the new column.
- `schemas.py`: `OrganizationOut`/`OrganizationUpdate`:
  `shliach_view_config: Optional[dict] = None`.
- `routers/organizations.py`: `update_my_org` — add `shliach_view_config` to
  the pass-through `for field in (...)` loop (same present-but-null-clears
  semantics as `report_notes` etc.).
- `lib/types.ts`: add `shliach_view_config` to the `Organization` interface.
- New frontend page `app/dashboard/shliach-config/page.tsx` (admin-only,
  same load/save shape as `app/dashboard/settings/page.tsx`): title
  "הגדרות לתצוגת פעילים" / "Configuration for Activist Role", with:
  1. Disable-edit toggle.
  2. Hide-all-filters toggle.
  3. Default-filter configurator — reuse the apartments page's own filter
     widgets (area/building/report-number/jewish/mezuzah/language selects)
     bound to the config object instead of live state.
  4. Default-columns configurator — reuse the same column-checkbox list the
     apartments page's own "Customize Fields" panel renders
     (`FIELD_KEYS`/`FIELD_REGISTRY_KEYS`), bound to `default_columns`.
- `frontend/app/dashboard/layout.tsx`: add to `moveItems`→ (`moreItems`,
  admin-only) a new entry linking to `/dashboard/shliach-config`.
- `frontend/app/dashboard/apartments/page.tsx` consumes
  `user?.organization?.shliach_view_config` when `isShliach`:
  - `disable_edit` → suppress `InlineEdit`/add/bulk-edit affordances (same
    condition points already gated by `!isShliach` get an extra
    `!configDisablesEdit` check — actually since disable_edit only applies
    to shliach in the first place, just fold it into the existing
    `isShliach` gates instead of adding a parallel condition).
  - `hide_filters` → when true, don't render the filter section at all
    (stronger than the existing per-user `filtersOpen` collapse toggle,
    which stays for the non-hidden case).
  - `default_filters`/`default_columns` → applied once, only when
    `isShliach` and the corresponding `usePersistentState`/`useDbPreference`
    has no real stored value yet (first-ever load for that shliach).

---

## Sequencing

1. §1 (border) — smallest, no backend/schema.
2. §2.1 (apartment_number restrict) — small, no schema.
3. §2.2 (multi-language) — schema migration + backend + frontend.
4. §3 (manager_jewish_status + tab) — schema-free (rides existing
   `PicklistDefinition`/`PicklistLink`), backend + frontend.
5. §4 (config panel) — schema migration + new page + apartments-page wiring;
   depends on nothing above but is the largest single piece, done last.

Backend test coverage: `backend/tests/test_fixes51.py`, one test class per
section above. Live-drive verification (Playwright/CDP against local
Postgres) for every section afterward, per house rule.
