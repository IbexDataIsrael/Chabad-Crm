# fixes35 — Implementation Plan

Source spec: `docs/fixes35.md`. The user explicitly asked for this plan to be
*designed*, not the literal schema transcribed — "you build the plan, I only
wrote suggestion." This doc makes several deliberate deviations from the
spec's literal wording, each called out below with why.

Local stack already running (Postgres + backend + frontend via
docker-compose). All work happens against the real local Postgres dev DB.

---

## Design decisions (read this before the section-by-section plan)

### 1. Reuse, don't duplicate, two systems that already do most of this
The codebase already has **two** relevant mechanisms, and the spec's own
schema draft re-invents pieces of both:

- **`CustomFieldDefinition`/`CustomFieldValue`** (`models.py:729-781`,
  `routers/custom_fields.py`) — an admin-defined per-org field, today
  hardwired to exactly one shape: boolean + note, attached to a `visit_id`
  only. This is the literal "custom field" the spec is asking to generalize
  — not something to build alongside.
- **`PicklistDefinition`/`PicklistValue`/`PicklistLink`** (fixes32) — a
  fully generic, already-multi-entity "select" field mechanism (apartment,
  contact, visit all wired end-to-end as of this session's fixes34 round).
  The spec's own line — *"Utilize existing tables for picklists where
  applicable"* — is a direct instruction to route `field_type: "select"`
  through this, not through a new `options_ref` scheme.

**Decision**: generalize `CustomFieldDefinition`/`CustomFieldValue` in place
(new columns, not a new table pair) to cover the 4 requested entities and
the 4 non-select types; for `field_type: "select"`, a custom field
definition creates/links a `PicklistDefinition` and its value lives
entirely in `PicklistLink` — `CustomFieldValue` is never written for
select-type fields. One value ever, one source of truth.

### 2. `is_hidden` → the existing `field_settings` mechanism, not a new column
fixes33 §5.1 already made `/dashboard/fields` auto-generate a settings row
per non-system `PicklistDefinition`, entity-bucketed generically. The exact
same generalization — bucket by the new `entity_type` column instead of
prefix-sniffing — covers non-select `CustomFieldDefinition` rows too, with
zero new frontend code (the `ENTITY_GROUPS` in `dashboard/fields/page.tsx`
already lists `contact`, `contact_mekurav`, `contact_shliach`, `apartment`,
`visit`). The spec's `is_hidden` column is dropped from the schema — reusing
one show/hide mechanism app-wide beats adding a second, competing one.
`CustomFieldDefinition.is_active` keeps its current, different meaning
("soft-deleted", per the existing deactivate/reactivate/hard-delete flow in
`custom-fields/page.tsx`) — distinct from field-settings visibility, exactly
like `PicklistDefinition` vs. `PicklistValue.is_active` already are.

### 3. `CustomFieldValue` generalizes from `visit_id` to polymorphic `entity_table`/`entity_id`
Mirrors `PicklistLink` exactly (`entity_table` + `entity_id`, no real FK —
`entity_id` isn't a single parent). Existing rows backfill
`entity_table = 'visit_history'`, `entity_id = visit_id`. The existing
`checked`/`note` columns are kept **as-is** (zero risk to the shipped
Mivtzoim UI/API contract — `ContactCustomField`, `CustomFieldsEditor`,
`/api/visits/{id}/custom-fields` all keep working unchanged for
`field_type: "boolean"`). A new nullable `value: Text` column is added for
the 3 new non-select types (`text`, `number`, `date` — stored as their
string representation, parsed/validated at the API boundary, exactly like
`PicklistValue.value` is a plain string with no DB-level type). Rejected:
one typed column per type (`text_value`/`number_value`/`date_value`) — the
app doesn't sort/filter grid columns by SQL-level type today (sort keys are
a small fixed literal set everywhere), so the extra columns would be
unused complexity for no real capability gain.

### 4. `CustomFieldDefinition` gains 3 columns
- `entity_type: String` — `"contact_mekurav" | "contact_shliach" | "visit" | "apartment"`. Existing rows backfill `"visit"`.
- `field_type: String` — `"text" | "number" | "boolean" | "date" | "select"`. Existing rows backfill `"boolean"`.
- `english_label: String, nullable` — every other definition-style table in
  this bilingual app (`PicklistDefinition.english_display_name`,
  `field_registry` label keys) carries an English label; the spec's table
  doesn't list one, but omitting it would make this the only definition
  table in the app without one. Added for consistency, optional so nothing
  is required at creation time.
- `options_ref` from the spec's draft is **not** a new column — for
  `field_type: "select"` it's simply the linked `PicklistDefinition.id`,
  looked up by convention (see §5below), not stored redundantly.

### 5. Where a select-type custom field's `PicklistDefinition.system_name` lives
`field_registry.picklist_entity()` already buckets a picklist's *entity* by
`system_name` prefix (`apartment.*` → apartment, `visit./checklist./interaction.*`
→ visit, everything else → contact_mekurav). For custom fields the
`entity_type` is already explicit on the definition, so creating a
select-type custom field auto-derives its `system_name`:
- `apartment` → `apartment.<field_key>` (matches today's convention exactly).
- `visit` → `checklist.<field_key>` (existing visit-picklist convention).
- `contact_mekurav` → bare `<field_key>` (matches today's "Contacts tab,
  prefix ''" convention).
- `contact_shliach` → **new** `shliach.<field_key>` prefix — `contact_shliach`
  has no dynamic-picklist bucket at all today (`picklist_entity()` falls
  through to `contact_mekurav` for anything unrecognized). Add a
  `_SHLIACH_PICKLIST_PREFIX = "shliach."` check to `picklist_entity()`, and
  wire a shliach-scoped picklist loop into `ContactForm.tsx`'s `isShliach`
  branch and `ContactView.tsx`'s `shliachFields` (neither has ANY dynamic
  field loop today — this is a genuinely new capability, not a gap-fill).

Storage entity_table for both contact_mekurav and contact_shliach custom
fields (select or otherwise) is uniformly `"contacts"`, keyed by
`Contact.id` — there is no need for a `contact_shliach`-table-keyed value
row (unlike the legacy `potential_next_step` quirk, which predates this and
is keyed by `contact_mekurav.id` for historical reasons only). `entity_type`
on the *definition* is UI-routing metadata (which form section renders it);
it is not a second storage dimension.

### 6. Scope of "Customize Columns" / "Fast Inline Edit" (spec §3)
The spec names **Contacts and Apartments** specifically for these two
bullets — not Visits or the shluchim list (`dashboard/shluchim/page.tsx` has
no column-customization or inline-edit infrastructure today, and adding it
is out of scope here; a shliach's custom fields still get full CRUD via
their contact form/view, just not a dedicated list grid). CRUD integration
("Universal CRUD" — spec's first bullet) does apply to all 4 entities.

---

## §1 Backend schema

### Migration `fixes35_generic_custom_fields`
1. `custom_field_definitions`:
   - Add `entity_type VARCHAR(30) NOT NULL DEFAULT 'visit'` (drop the
     server default after backfill, keep the column NOT NULL going forward).
   - Add `field_type VARCHAR(20) NOT NULL DEFAULT 'boolean'` (same
     drop-default-after-backfill treatment).
   - Add `english_label VARCHAR(100) NULL`.
   - Existing `UniqueConstraint(organization_id, field_key)` — reconsider:
     spec implies `field_key` should be unique per (org, entity_type), not
     globally per org, so a `visit`-scoped and an `apartment`-scoped field
     can share a key (e.g. both call it `notes_extra`). Change the
     constraint to `(organization_id, entity_type, field_key)`.
2. `custom_field_values` — revised after checking `core/backup.py` and
   `routers/admin.py` (both special-case this table today, specifically
   *because* it has no `organization_id` of its own — unlike `PicklistLink`,
   which already has one and needs zero special-casing anywhere). Fix the
   root cause instead of carrying the special-casing forward:
   - Add `organization_id INTEGER NOT NULL` (backfilled by joining through
     `visit_history.organization_id` for existing rows) — this alone lets
     `CustomFieldValue` join the plain org-scoped delete/dump/wipe path
     every other model already uses.
   - Add `entity_table VARCHAR(50) NULL`, `entity_id INTEGER NULL`,
     backfilled `entity_table = 'visit_history'`, `entity_id = visit_id`.
   - **Keep the old `visit_id` column** — nullable, unused by any new code,
     deprecated-in-place rather than dropped. Reason: up to 10 backup
     snapshots per org are retained (fixes16) and may contain **pre-migration**
     `CustomFieldValue` rows shaped `{visit_id, definition_id, checked, note}`
     with no `organization_id`/`entity_table` at all. `restore_snapshot`'s
     `_parse_row` silently drops any column absent from the *current* model —
     if `visit_id` were dropped, restoring an old snapshot would silently
     lose every Mivtzoim value it contains. Keeping the column costs nothing
     and closes that data-loss trap; `restore_snapshot` gets one added
     branch (see below) to synthesize `organization_id`/`entity_table`/
     `entity_id` for a row that arrives in the old shape.
   - Add `value TEXT NULL` (text/number/date storage as a string).
   - Old unique constraint `(visit_id, definition_id)` → new
     `(entity_table, entity_id, definition_id)`.
   - Add indexes on `organization_id`, `entity_table`, `entity_id` (mirrors
     `picklist_links`).
3. Downgrade: drop the 3 new columns, restore the old
     `(visit_id, definition_id)` unique constraint. `visit_id` was never
     dropped, so no data reconstruction is needed on the way down.

### Follow-on simplifications this unlocks (real existing-code cleanup, not scope creep — both files already special-case exactly what the new `organization_id` column removes the need for)
- `core/backup.py`: delete `_VISIT_SCOPED` and its branch in `_dump_rows`/
  `restore_snapshot`'s wipe step entirely — `CustomFieldValue` moves into
  the plain `organization_id`-scoped path every other `SNAPSHOT_MODELS`
  entry already uses. Add one narrow compat branch in `restore_snapshot`:
  if a dumped `CustomFieldValue` row has `visit_id` but no `entity_table`
  (an old-shape snapshot), synthesize `organization_id = org_id`,
  `entity_table = "visit_history"`, `entity_id = row["visit_id"]` before
  insert — this is the one place old snapshots still need help, now
  isolated to a single `if`, not a whole parallel dump/wipe code path.
- `routers/admin.py` `_delete_organization_cascade`: delete the special
  `visit_ids`-scoped `CustomFieldValue` block; add `models.CustomFieldValue`
  to the plain `ordered_models` cascade list (before `CustomFieldDefinition`,
  which it FKs to) — an `organization_id == org_id` delete like everything
  else in that list.

Written test: a full round-trip clone-and-diff of the real local dev DB
before touching it (same discipline as fixes32's migration), since this
touches the one existing production-shaped feature (Mivtzoim) that has real
org data behind it.

---

## §2 Backend — `app/custom_field_utils.py` (new, mirrors `picklist_utils.py`)

Functions, one per non-select value operation (select-type fields never
touch this module — they go through the existing `picklist_utils` exactly
like any other picklist):
- `get_values(db, org_id, entity_table, entity_id) -> dict[str, str | bool | None]`
  — one entity's non-select custom field values, keyed by `field_key`,
  resolved by joining `custom_field_values` → `custom_field_definitions`
  (only rows where the definition's org matches and `field_type != 'select'`).
  Returns `checked` for boolean-type defs, `value` for text/number/date.
- `get_values_bulk(...)` — same, many entities at once (list endpoints).
- `set_value(db, org_id, entity_table, entity_id, field_key, entity_type, value)`
  — upsert; validates `value` against `field_type` (number parses as
  float, date parses as ISO date, boolean is a real bool) — 400 on a type
  mismatch, mirroring `validate_picklist_value`'s error shape.
- `copy_values(db, entity_table, from_id, to_id)` — apartment versioning
  support, mirrors `copy_links`.
- `delete_values(db, entity_table, entity_id)` / `delete_values_many(...)`
  — hard-delete cleanup, mirrors `delete_links`/`delete_links_many`.

`routers/apartments.py`'s existing `_apply_versioned_update` (which already
calls `picklist_utils.copy_links` on every version bump) gains a
`custom_field_utils.copy_values` call alongside it.

---

## §3 Backend — `field_registry.py` / `field_settings.py`

1. `field_registry.py`:
   - Add `_SHLIACH_PICKLIST_PREFIX = "shliach."` and update
     `picklist_entity()` to check it before falling through to
     `contact_mekurav`.
   - No change needed to `ENTITY_GROUPS`-equivalent — the frontend's
     `dashboard/fields/page.tsx` `ENTITY_GROUPS` already lists every entity
     this round needs.
2. `field_settings.py` `list_field_settings` / `set_field_setting`:
   - Generalize `_custom_picklist_keys` → also collect non-select
     `CustomFieldDefinition.field_key` values (org-scoped, `is_active=True`),
     and emit a `FieldSettingOut` row per one — `entity` = the definition's
     own `entity_type` column directly (no prefix-sniffing needed, unlike
     picklists), `label`/`english_label` from `hebrew_label`/`english_label`.
   - `set_field_setting`'s allow-list check extends to include these
     `field_key`s too (scoped by org, matching the existing custom-picklist
     branch's shape).
   - Note a real ambiguity the literal spec doesn't address: a `field_key`
     is now only unique per `(org, entity_type)` (§1.1 above), but
     `field_settings.field_key` is a bare string with no entity qualifier.
     Two custom fields in different entities sharing a literal `field_key`
     string would collide in `field_settings`. Mitigation: prefix the
     `field_settings.field_key` written/read for a custom field definition
     with its entity, e.g. `customfield.<entity_type>.<field_key>` — keeps
     the public API simple (still just "a field_key") while guaranteeing
     no collision. Apply the same prefix convention when resolving
     visibility in every frontend `vis(...)` call for these fields.

---

## §4 Backend — `routers/custom_fields.py`

1. `CustomFieldDefinitionCreate`/`Update`/`Out` schemas gain `entity_type`,
   `field_type`, `english_label`. `field_type: "select"` additionally
   requires `picklist_options: list[str] | None` on create (the initial
   option set, Hebrew labels — mirrors how `PicklistSelect`/`AddPicklist`
   already collects initial values) — creating this definition:
   - Creates a `PicklistDefinition` with the derived `system_name` (§ design
     decision 5) and `hebrew_display_name = field_label`.
   - Creates a `PicklistValue` row per supplied option.
   - Stores nothing further in `CustomFieldValue` for this definition ever.
2. `list_definitions` gains an `entity_type` query filter (list pages only
   want their own entity's definitions, not every entity's).
3. New endpoints (or extend existing ones — decide during implementation
   based on how cleanly they fit `routers/custom_fields.py` vs. a
   dedicated small router):
   - `GET /api/custom-field-values?entity_table=&entity_id=` — one entity's
     resolved non-select custom values (thin wrapper over
     `custom_field_utils.get_values`).
   - `PUT /api/custom-field-values` — `{entity_table, entity_id, field_key, value}`
     upsert (thin wrapper over `set_value`).
   - Every entity router that already has a "the record's other data"
     response envelope (`ApartmentOut`, `ContactOut`/`ContactDetailOut`)
     gains a `custom_field_values: dict[str, ...]` field populated the same
     way `picklist_values` is — **so most reads don't need the standalone
     endpoint above at all**; it exists for the one write path that doesn't
     already go through an entity's own PUT/PATCH (none currently — every
     entity's PUT/PATCH already accepts a flexible extra dict the same way
     `picklist_values` does, so custom field values can very likely piggyback
     on the exact same payload key pattern used for picklists, needing no new
     endpoint at all beyond the value being merged into `ApartmentUpdate`/
     `ContactUpdate`/visit's own update schema). Confirm this during
     implementation before building a parallel endpoint — prefer reusing the
     existing PUT/PATCH bodies (`custom_field_values: {field_key: value}`)
     exactly like `picklist_values` already works, for symmetry and half the
     new endpoint surface.
4. Visit's existing `/api/visits/{id}/custom-fields` GET/PUT stays
   **unchanged** — it's the boolean+note contract and continues serving
   exactly the definitions where `field_type == "boolean" and entity_type == "visit"`.
   Non-boolean visit-scoped custom fields (a new capability) ride the
   generic `custom_field_values` dict on the visit's own detail/update
   payload instead, alongside the untouched legacy endpoint.

---

## §5 Frontend — `/dashboard/custom-fields` page rebuild

Repurpose the existing page (already linked under "עוד" as `nav.custom_fields`
— no new nav entry needed). Rename its Hebrew label via the guarded
`LOCALIZATION_RENAMES` mechanism: "שדות מותאמים" → "הוספת שדות מותאמים"
(exact spec wording).

- `AddDef` form gains: an entity-type selector (4 options, Hebrew labels
  matching `ENTITY_GROUPS`), a field-type selector (5 options), and —
  only when `field_type === "select"` — an inline repeatable "option"
  input list (Hebrew label each), submitted as `picklist_options`.
- The definitions list groups by `entity_type` (4 sections, matching the
  Manage Fields page's own grouping) instead of one flat list.
- `BuiltinVisitFields` (the visit-field visibility toggle block bolted onto
  this page) is dropped — it duplicates `/dashboard/fields`, which already
  covers every visit field (built-in and now custom) generically. Replaced
  with a one-line link over to `/dashboard/fields` for visibility toggling.
  This is an incidental cleanup enabled by touching this page anyway, not
  scope creep — flagged explicitly in the closeout.

---

## §6 Frontend — CRUD integration per entity (spec §3, "Universal CRUD")

Every one of these follows the exact pattern already proven twice this
session (apartments fixes32/33, contacts fixes34): fetch the org's active
non-select custom definitions for this entity_type once, render one control
per `field_type` (text→`<input>`, number→`<input type=number>`,
boolean→checkbox, date→`DatePicker`), gated by `vis("customfield.<entity_type>.<field_key>")`;
select-type definitions ride the *already-built* custom-picklist loop
(apartments: done; contacts/contact_mekurav: done this session) — for
`contact_shliach` specifically, this is the one loop that doesn't exist yet
(§ design decision 5) and needs building from scratch, mirroring the
mekurav loop already in `ContactForm.tsx`/`ContactView.tsx`.

- **Apartment** (`ApartmentEditor.tsx`, `apartments/[id]/page.tsx`): add a
  second definitions fetch (`entity_type=apartment`, non-select), a render
  loop next to the existing `customDefs` (picklist) loop, and include the
  new dict in the PUT payload the same way `picklist_values` already is.
- **Contact mekurav** (`ContactForm.tsx`, `ContactView.tsx`): same, next to
  this session's contact-picklist loop, `entity_type=contact_mekurav`.
- **Contact shliach** (`ContactForm.tsx` `isShliach` branch,
  `ContactView.tsx` `shliachFields`): new — both the select-type loop (§5)
  and the non-select loop, `entity_type=contact_shliach`.
- **Visit** (`VisitForm.tsx`, `VisitDetails.tsx`, `CustomFieldsEditor.tsx`):
  `CustomFieldsEditor` currently assumes every item is boolean+note: extend
  it to branch on `field_type` per item (existing boolean items keep the
  exact checkbox+note row; non-boolean items get a per-type control) —
  parent components already loop the full definitions list and merge in the
  resolved values, so the main change is inside the editor's per-row
  render, not the fetch/save plumbing (which mostly stays but needs to
  route non-boolean saves onto the new generic `custom_field_values`
  payload instead of the legacy checked/note-only endpoint).

## §7 Frontend — Contacts & Apartments: columns + inline edit (spec §3)

Mechanical extension of the exact machinery this session already built for
custom *picklists* on both list pages — the only change is branching the
cell renderer by `field_type` instead of assuming `PicklistSelect`:
- `apartments/page.tsx`: alongside `customDefs`/`customPicklists`, fetch the
  non-select apartment custom definitions; extend the column-selector chips,
  header/body cells (`inlineTextCell`-equivalent per type), and
  `saveListField` payload (`custom_field_values: {...}` merged in).
- `contacts/page.tsx`: same, alongside this session's `customPicklistDefs`
  wiring, `entity_type=contact_mekurav`.

---

## Testing plan

- Backend: `backend/tests/test_fixes35.py` — schema migration round-trip
  (existing Mivtzoim boolean data survives, both directions); a text/number/
  date/select custom field created for each of the 4 entities, value
  round-tripped through the entity's own GET/PUT; select-type creation
  correctly provisions a `PicklistDefinition` + options and never writes
  `CustomFieldValue`; `field_settings` emits a row per non-select custom
  field bucketed by its real `entity_type`, and the `customfield.<entity>.<key>`
  collision-avoidance prefix actually prevents two entities sharing a
  `field_key` from clobbering each other's visibility row; shliach-scoped
  select custom field lands in the new `contact_shliach` bucket.
  `PRAGMA foreign_keys` caveat doesn't apply here (no new FK-RESTRICT
  relationships), but verify the migration itself against the real local
  Postgres dev DB regardless, since it alters two tables with live data.
- Frontend: `tsc --noEmit` + `next build` (standing rule).
- Live verification: create one custom field of each `field_type` for each
  of the 4 entities via the rebuilt `/dashboard/custom-fields` page; confirm
  each renders and saves in every CRUD surface (create modal, edit form,
  detail view) for its entity; for apartment/contact confirm the new field
  also appears as a "Customize Columns" chip and inline-edits from the list;
  toggle each off from `/dashboard/fields` and confirm it disappears
  everywhere for that entity, then re-show it; confirm the pre-existing
  Mivtzoim boolean+note visit fields still work exactly as before
  (unaffected regression check, since this round alters their backing
  tables).

## Closeout

Per project rule: update `docs/fixes35.md` with a checklist + closeout
section, each item `[x]` with evidence or explicit "Not done" with why.
Nothing committed or pushed without an explicit ask.
