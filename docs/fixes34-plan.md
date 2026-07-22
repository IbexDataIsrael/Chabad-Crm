# fixes34 — Implementation Plan

Source spec: `docs/fixes34.md`. Local stack already running (Postgres +
backend + frontend via docker-compose). This round is entirely additive UI
wiring on top of the normalized `picklist_links` storage fixes32 already
built — no new tables, no migration.

Also folded in here per the user's chat report: the apartment single-page
custom-fields gap ("last fix you made — you forgot to add custom fields to
the regular edit page, e.g. `/dashboard/apartments/172`") is exactly §2.1
below — confirmed as a real, reproducible gap, not a duplicate ask.

---

## §2.1 Apartments — custom fields missing on the single apartment page

### Root cause (confirmed by direct read, not inference)
`frontend/app/dashboard/apartments/[id]/page.tsx` is the "regular edit page"
(fixes30 §2 turned it into an inline-edit page — the old separate edit form
at `/dashboard/apartments/edit/{id}` via `ApartmentEditor.tsx` still exists
as a route but is no longer linked from the UI). `[id]/page.tsx` only
renders the 4 **fixed** apartment picklists (`apartment.Jewish_status`,
`campaign_status`, `mezuzah_status`, `language`) — it never fetches
`/api/picklists`, never imports `FIXED_APARTMENT_PICKLIST_KEYS`, and has no
loop over dynamic (custom, admin-added) `apartment.*` definitions. Every
other apartment surface already handles this correctly:
- `apartments/page.tsx` (list): `customDefs` state + `usePicklistsMap` +
  inline `InlineEdit`/`PicklistSelect` columns (lines ~126, 175, 256, 501,
  1087-1110).
- `ApartmentEditor.tsx` (the old standalone edit form, still used by
  `/dashboard/apartments/add` and `/dashboard/apartments/edit/{id}`):
  `customDefs` fetch + filter by `FIXED_APARTMENT_PICKLIST_KEYS` (lines 79,
  97) + render loop (line 291) + included in submit payload (line 146).

**This is a pure frontend rendering gap — no backend change needed.**
Verified directly:
- `GET /api/apartments/{id}` (`backend/app/routers/apartments.py:852-862`
  `get_apartment`) calls `_apartment_out` → `_apply_picklist_fields`
  (lines 76-83), which already stuffs every non-fixed picklist into
  `out.picklist_values`. `ApartmentOut.picklist_values` (`schemas.py:627`)
  is already a populated `dict[str, Optional[str]]` on this endpoint's
  response today.
- `PUT /api/apartments/{id}` already accepts a partial `picklist_values`
  dict (`ApartmentUpdate.picklist_values`, `schemas.py:597`) — the existing
  `patch()` helper in `[id]/page.tsx` (lines 136-146) needs no change, it
  just needs to be called with `{ picklist_values: { [field_key]: v } }`
  the same way the list page's `saveListField` already does.

### Fix — `frontend/app/dashboard/apartments/[id]/page.tsx`
1. Import `FIXED_APARTMENT_PICKLIST_KEYS`, `usePicklistsMap` from
   `@/lib/picklists`, and `PicklistField` from `@/lib/types`.
2. Add a `customDefs` state, fetched once from `/api/picklists` in `reload()`
   (same call apartments list/`ApartmentEditor` already make), filtered to
   `system_name.startsWith("apartment.") && !FIXED_APARTMENT_PICKLIST_KEYS.includes(system_name)`.
3. `usePicklistsMap(customDefs.map((d) => d.field_key))` for labels.
4. After the existing 4 fixed-picklist `field(...)` calls (around line 416,
   right before the `report_number_id` field), map `customDefs` into the
   same `field(...)` + `inlinePicklist`-shaped row, keyed by
   `d.field_key`/`d.hebrew_display_name` (mirroring the list page's
   `picklist_values?.[d.field_key]` read and
   `patch({ picklist_values: { [d.field_key]: v } })` write) — reuse the
   existing local `field()` helper (line 168) and a small inline
   `InlineEdit<string|null>` + `PicklistSelect` block (same shape as the
   existing `inlinePicklist` helper at line 218, just keyed dynamically
   instead of by a fixed `fieldName`).
5. Respect `vis(d.field_key)` (fixes33 §5.1 already makes custom picklists
   toggleable via `/dashboard/fields` — this page just needs to consult it,
   same as every fixed field on this page already does via `field()`).

No backend, no migration, no new localization keys (custom picklist labels
come from the definition's own `hebrew_display_name`, same as everywhere
else).

---

## §1.1 Contacts — parity with the Apartments feature set

### Current-state findings (see full detail from research; summarized here)
- **Inline editing**: `contacts/page.tsx` (list) has **zero** inline editing
  — every cell is static, row click navigates to the detail page. Reference
  pattern to copy is apartments list's `saveListField` + `inlineTextCell`/
  `inlinePicklistCell` factories (`apartments/page.tsx:419-480,527-597`) and
  the "name cell keeps navigation, small pencil opens inline edit" pattern
  (`ApartmentNameCell`, `apartments/page.tsx:1160-1243`).
- **Custom picklists on contacts are wired nowhere**: not the list (columns/
  filters/column-selector), not the single contact view, not the create
  modal, not the edit form. Root cause is two-layered:
  - **Backend**: `ContactOut` (`schemas.py:876-892`) has no `picklist_values`
    field at all (only `ContactDetailOut` does, for the single-record GET).
    `_apply_contact_picklist_fields` (`routers/contacts.py:139-143`) only
    ever sets `pipeline_status`/`color_tag` and discards everything else
    `picklist_utils.get_values_bulk` already resolved — unlike apartments'
    `_apply_picklist_fields`, which keeps every leftover key in a generic
    dict. This is the *exact* fix apartments already got in fixes32/33,
    never carried over to contacts.
  - **Frontend**: `contacts/page.tsx` imports `CustomFieldDefinition` (the
    older, unrelated `/api/custom-fields` mechanism for the מבצעים filter),
    never `PicklistField`/`/api/picklists`/`usePicklistsMap`. `ContactForm.tsx`
    (line 417) and `ContactView.tsx` (line 396) both loop only the 3 fixed,
    bare-named `MEKURAV_PICKLISTS = ["Jewish_status", "affiliation",
    "language"]` — no loop over dynamic definitions. There is no
    `FIXED_CONTACT_PICKLIST_KEYS` constant yet (only
    `FIXED_APARTMENT_PICKLIST_KEYS` exists in `lib/picklists.ts:15-20`).
- **Visibility toggle for custom contact picklists already works** at the
  settings layer today (fixes33 §5.1's `picklist_entity()` buckets any
  non-apartment/non-visit-prefixed picklist into `"contact_mekurav"`,
  already one of `dashboard/fields/page.tsx`'s `ENTITY_GROUPS`) — it's just
  inert until the rendering gaps above are closed, since there's currently
  nothing on screen for the toggle to hide.

### Backend changes
1. `backend/app/schemas.py` — add `picklist_values: dict[str, Optional[str]] = {}`
   to `ContactOut` (after `login_status`, line ~892). Simplify
   `ContactDetailOut.picklist_values` to inherit the same field/type instead
   of redeclaring `dict[str, str]` (line 900) — no behavior change, just
   removes the duplicate declaration now that the base class carries it.
2. `backend/app/routers/contacts.py` — `_apply_contact_picklist_fields`
   (lines 139-143): after setting the fixed `pipeline_status`/`color_tag`
   fields, also set
   `out.picklist_values = {k: v for k, v in values.items() if k not in _CONTACT_LINK_FIELDS.values()}`,
   mirroring apartments' `_apply_picklist_fields` exactly. This flows
   through for free to both `list_contacts` (line 796) and
   `list_contacts_paginated` (line 865) since both already call
   `_list_item` → `_apply_contact_picklist_fields` with a fully-resolved
   `picklist_map` from `get_values_bulk`.
3. `frontend/lib/types.ts` — `Contact.picklist_values` (line 106) is
   currently typed `Record<string, string>`; loosen to
   `Record<string, string | null>` to match `Apartment.picklist_values`
   (line 181) now that it carries real (possibly-null) custom values.

### Frontend — inline editing on the contacts list (bullet 1)
4. `frontend/lib/picklists.ts` — add
   `FIXED_CONTACT_PICKLIST_KEYS = ["contact.pipeline_status", "contact.color_tag", "contact.potential_next_step", "Jewish_status", "affiliation", "language"]`
   (the full fixed set across pipeline/color/next-step/mekurav-bare-name
   picklists — everything that already has a dedicated field anywhere in
   the contact UI today).
5. `frontend/app/dashboard/contacts/page.tsx`:
   - Add a `saveListField`-equivalent PATCH helper (contacts don't version,
     so this is simpler than apartments' PUT-and-follow-new-id — just
     `PATCH /api/contacts/{id}` and merge the response into `items`).
   - Replace the static branches in `cell()` (lines 392-413) for `phone`,
     `status` (pipeline_status), `priority` (priority_score), `address`
     with `inlineTextCell`/`inlinePicklistCell` factories built on the same
     generic `InlineEdit` component apartments already uses.
   - Replace the name `<td>` (lines 862-867) with a small
     `ContactNameCell` component mirroring `ApartmentNameCell`: the name
     stays a click-to-navigate link, a small pencil affordance opens a
     local inline `<input>` for the name itself, so row-click-to-open still
     works for everything else.

### Frontend — custom picklist columns/filters/column-selector (bullet 2a/2b)
6. `contacts/page.tsx` — add a `customDefs` (`PicklistField[]`) state fetched
   from `/api/picklists`, filtered to exclude `FIXED_CONTACT_PICKLIST_KEYS`
   and the apartment/visit-prefixed ones (`apartment.`, `visit.`,
   `checklist.`, `interaction.` — those belong to other entities' Picklists
   tabs and must never leak onto the Contacts page). Mirror apartments'
   `usePicklistsMap(customDefs.map(d => d.field_key))` for labels.
   - Filter chips: same pattern as apartments (lines 747-763) — one chip per
     custom def, feeding a `picklist_link` filter param (backend support:
     confirm `list_contacts_paginated` already accepts a generic
     `picklist:<field_key>=<value>` style param the same way apartments'
     list endpoint does; if not, add it mirroring the apartments query
     param handling exactly).
   - Column-selector ("התאמת שדות"): one toggle chip per custom def, backed
     by a new `useDbPreference("contacts.customFields", ...)` (mirrors
     apartments' `apartments.customFields` from fixes33 §3.1), default = all
     custom defs (preserves current — i.e. absent — behavior for existing
     orgs since nothing renders today).
   - Table header/body: render a column per visible custom def using the
     same `InlineEdit` + `PicklistSelect` pattern as apartments
     (`saveListField(c, { picklist_values: { [d.field_key]: v } })`).

### Frontend — CRUD integration (bullet 2c)
7. `frontend/components/ContactForm.tsx` (after the `MEKURAV_PICKLISTS.filter(...).map(...)`
   loop, line 417-425) — add a second loop over the same `customDefs` used
   on the list page (fetch once, filtered the same way), rendering a
   `<Field>` + `<PicklistSelect>` per def, reading/writing through the
   already-generic `values.picklist_values[key]` / `setPicklistValue(key, v)`
   (both already exist and are type-generic — no change needed to the write
   path, only the read/render loop is missing). Gate each with
   `vis(d.field_key)`.
8. `frontend/components/ContactView.tsx` (after the `...MEKURAV_PICKLISTS.map(...)`
   spread, line 396-408) — add a second `...customDefs.map(...)` spread of
   the same `[key, label, node]` tuple shape, using
   `usePicklistsMap(customDefs.map(d => d.field_key)).labelFor(d.field_key, value)`
   for the display label (the existing fixed-picklist branch's
   `{Jewish_status, affiliation, language}[key]` static lookup can't extend
   to dynamic keys, hence the map-based hook instead).
9. `frontend/app/dashboard/contacts/new/page.tsx` — no direct change
   expected; confirm it delegates entirely to `ContactForm` once that
   component gains the loop (spot-check only, not a separate implementation
   step).

### Frontend — field visibility (bullet 2d)
10. No code change required — already functional (see root-cause note
    above). Verify live once §1.1's rendering gaps are closed: add a
    custom contact picklist via `/dashboard/picklists` (Contacts tab), hide
    it via `/dashboard/fields`, confirm it disappears from the contacts
    list/filters/column-selector/CRUD forms; unhide, confirm it reappears.

---

## §3.1 Field Visibility Settings — Contacts: Email & Phone toggles

### ⚠️ Note — this reverses a deliberate prior decision
`backend/app/field_registry.py`'s docstring (lines 1-15) and fixes28's
closeout explicitly made `contacts.email` (and `phone`, from the start)
**non-hideable on purpose**: both are core identity fields, and email
doubles as the shliach login identity. `backend/tests/test_fixes28.py::test_email_has_no_visibility_toggle`
(lines 279-289) encodes exactly the opposite of what this spec item now
asks for. This plan implements §3.1 as written (it's an explicit, direct
ask in `docs/fixes34.md`), but two things keep it safe:
- The toggle only ever governs **UI rendering** (CRUD forms, filters,
  columns) — never the DB schema, an actual auth code path, or the
  backend's own validation. Hiding the field from the visible UI does not
  touch how login/shliach-identity resolution works under the hood, so
  hiding email cannot break login.
- The existing test asserting the old behavior needs to be updated as part
  of this change (see Testing plan) — that's expected, not a regression.

### Backend
1. `backend/app/field_registry.py` — add two new tuples to
   `TOGGLEABLE_FIELDS` (after `contacts.address`/`contacts.coordinates`,
   around line 31): `("contacts.phone", "contacts.phone", "contact")` and
   `("contacts.email", "contacts.email", "contact")`. Both default-visible
   (not added to `DEFAULT_HIDDEN`) so no existing org's UI changes until an
   admin explicitly opts in.
2. `backend/tests/test_fixes28.py::test_email_has_no_visibility_toggle` —
   flip to assert the new behavior (key present, PUT succeeds) or remove
   in favor of a new `test_fixes34.py` case — decide during implementation
   based on whether the surrounding test class still makes sense once its
   name premise (`email has no visibility toggle`) is gone.

### Frontend
3. `frontend/app/dashboard/fields/page.tsx` — **no change needed structurally**:
   `ENTITY_GROUPS` already has `{ entity: "contact", labelKey: "contacts",
   fallback: "אנשי קשר" }` (line 15) and the render loop is fully generic
   per-`entity` — the two new registry rows will appear automatically as
   toggle chips under the existing "אנשי קשר" heading.
4. `frontend/components/ContactForm.tsx` — wrap the phone `<Field>` (lines
   195-201) in `{vis("contacts.phone") && (...)}` and the email `<Field>`
   (lines 205-216) in `{vis("contacts.email") && (...)}`, matching every
   other toggleable field in this file. Decide (confirm with a quick check
   of `isShliach` at render time) whether email should stay force-visible
   when `isShliach` — since it's the login identity for that contact type,
   hiding it from a shliach's own edit form could be confusing even though
   it's not unsafe; simplest consistent rule: `vis("contacts.email") ||
   isShliach` so a shliach's login-email field is never hidden from them
   specifically, while it can still be hidden for plain mekurav contacts.
5. `frontend/components/ContactView.tsx` — change the phone row's key
   (lines 239-240) and email row's key (lines 249-251) from `null` (always
   shown) to `"contacts.phone"`/`"contacts.email"` so the existing
   `allFields.filter(([key]) => key === null || vis(key))` (line 454)
   actually enforces it. Apply the same shliach-exception rule as above if
   adopted in step 4, for consistency between the form and the view.
6. `frontend/app/dashboard/contacts/page.tsx` — line 361's `availability`
   map: change `phone: true` to `phone: vis("contacts.phone")` (email has no
   existing column entry — out of scope to add one unless the user asks;
   the spec only asks for a visibility *toggle*, not a new column).

---

## Testing plan

- Backend: new `backend/tests/test_fixes34.py` — `ContactOut.picklist_values`
  round-trips a custom (non-fixed) contact picklist through both
  `GET /api/contacts` and `GET /api/contacts/list`; `contacts.phone`/
  `contacts.email` appear in `GET /api/field-settings` and can be toggled
  (replacing/updating the old fixes28 assertion). Run full suite after.
- Frontend: `tsc --noEmit` + `next build` (standing rule — dev mode hides
  real prod build errors).
- Live verification against the real local Postgres dev DB + headless-Chrome
  drive:
  - Apartments §2.1: add a custom `apartment.*` picklist, open a single
    apartment's page directly (e.g. `/dashboard/apartments/172`), confirm
    the custom field renders and is inline-editable, confirm the saved
    value round-trips through a page reload and matches the list page's
    value for the same apartment.
  - Contacts §1.1: inline-edit phone/status/priority/address directly from
    the contacts list table (no navigation); add a custom contact picklist
    via `/dashboard/picklists` (Contacts tab), confirm it appears as a list
    column, a filter chip, a column-selector toggle, in the single contact
    view, in the create modal, and in the edit form; hide it via
    `/dashboard/fields` and confirm it disappears from all of the above,
    then re-show it.
  - §3.1: toggle `contacts.phone`/`contacts.email` off from
    `/dashboard/fields`, confirm both disappear from the contact create/edit
    form and the contacts list column, confirm a shliach contact's own
    email field behavior matches whatever exception rule is adopted in
    step 4 above; toggle back on.

## Closeout

Per project rule: update `docs/fixes34.md` with a checklist + closeout
section at the end, each item `[x]` with evidence or explicit "Not done"
with why — matching the fixes33 closeout style. Nothing gets committed or
pushed without an explicit ask.
