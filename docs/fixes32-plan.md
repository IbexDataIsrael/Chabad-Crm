# fixes32 — Implementation Plan

Spec: `docs/fixes32.md`. Two parts: (A) a foundational backend storage migration
the user requested during scoping (normalize every picklist-backed column onto
one generic link table — "not professional to hold the picklist text values"),
and (B) the apartments-grid + picklists-dashboard UI overhaul the spec
describes. (A) is what makes the spec's "Dynamic Integration" bullet (§2)
actually buildable without per-field wiring, so it comes first.

## §0 Decisions confirmed with the user during scoping
- New table `picklist_links` generalizes the existing (contact-only)
  `contact_picklist_values` pattern to every entity: `organization_id,
  entity_table, entity_id, picklist_definition_id, picklist_value_id` — a real
  FK to `picklist_values.id`, not a stored string. Unique on
  `(entity_table, entity_id, picklist_definition_id)`.
- Scope: migrate **all 10** currently-hardcoded picklist columns, and retire
  `contact_picklist_values` into the new table. **Excluded**, confirmed with
  the user:
  - `Contact.contact_type` — a structural type discriminator
    (`Literal["mekurav","shliach"]` already hardcoded at the schema layer),
    not a true open picklist; ~15 files branch on its exact 2 values. Stays a
    plain column, unchanged behavior.
  - `interaction.category` — lives inside a JSON array embedded in
    `VisitHistory` (one visit logs many interactions), not a per-row column.
    Normalizing it needs extracting interactions into their own table first —
    a separate, unrelated refactor. Stays as-is.
- External REST API contract is preserved for all 10 migrated fields: they
  keep their existing flat JSON field names (`jewish_status`, `pipeline_status`,
  etc.) — only the storage underneath changes. The frontend does not need to
  change for the migration itself.

## §1 New table + model
`app/models.py` — `PicklistLink`:
```
id, guid, organization_id (FK),
entity_table   String(50)   # "apartment" | "contact" | "contact_mekurav" |
                             # "visit" | "significant_date"
entity_id      Integer      # see versioning note below for apartments
picklist_definition_id  FK -> picklists.id
picklist_value_id       FK -> picklist_values.id
created_at, updated_at
UNIQUE(entity_table, entity_id, picklist_definition_id)
```

**Apartment versioning note**: every apartment edit retires the row and
inserts a new one with a new `id` (`_apply_versioned_update`); the 4 apartment
picklist columns are today part of `_VERSIONED_COLUMNS` and are individually
`_RESTORABLE_FIELDS`, and historical snapshots (`GET /apartments/{id}/history`)
show the value *as it was at that version*. To preserve this, `entity_id` for
`entity_table="apartment"` is the **per-version row's own id** (not the stable
`root_id`) — `_apply_versioned_update` / `_bulk_versioned_update` /
`restore_apartment_field` copy the 4 links forward onto the new row's id
(insert new link rows pointing at the same `picklist_value_id`), exactly
mirroring how `_VERSIONED_COLUMNS` copies values today. Every other entity
(`contact`, `contact_mekurav`, `visit`, `significant_date`) has no such
versioning — `entity_id` is just the row's normal primary key.

## §2 Generic helpers (`app/picklist_utils.py`)
Replace `FIELD_KEY_TO_COLUMN` + the ad-hoc `_APARTMENT_PICKLISTS` /
`_CONTACT_PICKLISTS` dicts with:
- `get_values(db, org_id, entity_table, entity_id, field_keys) -> dict[str, str|None]`
- `get_values_bulk(db, org_id, entity_table, entity_ids, field_keys) -> dict[int, dict]`
  (one query for list endpoints — avoids N+1 on `/apartments/list`)
- `set_value(db, org_id, entity_table, entity_id, field_key, value) ->None`
  (validates via the existing `validate_picklist_value`, then upserts or
  deletes the link row)
- `copy_links(db, entity_table, from_entity_id, to_entity_id, field_keys)` —
  apartment versioning support (§1)
- `count_usage()` rewritten as one query against `picklist_links` joined to
  `picklist_values` — no more per-field-type branching.

## §3 Migration (new Alembic revision)
1. Create `picklist_links`.
2. Data backfill (raw `sa.table`/`sa.column` reflection, not live ORM models):
   for each of the 10 columns, over **every** row (apartments: both
   `is_display=True` and historical `False` rows) with a non-null value,
   resolve the existing seeded `PicklistDefinition`/`PicklistValue`; if a
   legacy value doesn't match any active `PicklistValue` (old free-text data),
   create one (active, `value=hebrew_label=`the raw string, appended at the
   end of `sort_order`) so no data is silently dropped.
3. Migrate existing `contact_picklist_values` rows into `picklist_links`
   (`entity_table="contact"`, same resolution logic).
4. Drop the 10 old columns and the `contact_picklist_values` table.
5. `backend/scripts/` gets a pre-migration Neon backup reminder — same
   discipline as the fixes25 restructure (`fixes25_backup.py`) and the fixes19
   pre-deploy dump. **This migration only ever runs locally in this session**
   unless the user separately asks to deploy (standing rule: no push without
   an explicit ask).

## §4 Router changes (storage-only, contract preserved)
- `apartments.py`: model loses `jewish_status/campaign_status/mezuzah_status/
  language` columns; response building merges `get_values_bulk`; create/update
  write through `set_value`; `_apply_versioned_update`/`_bulk_versioned_update`/
  `restore_apartment_field` copy links forward (§1). Filters: `jewish_status`/
  `mezuzah_status` already filter — rewritten against `picklist_links`; **new**
  `campaign_status` and `language` filters added (§6, spec bullet). **New**
  generic custom-picklist filter: repeated query param `picklist=field_key:value`
  (grouped OR within a field_key, AND across different field_keys) covers any
  `apartment.*` picklist beyond the 4 fixed ones.
- `contacts.py`: `pipeline_status`/`color_tag` (Contact), `potential_next_step`
  (ContactMekurav), `special_date_type` (SignificantDate) — same storage-only
  swap, named fields unchanged. `_picklist_values_map`/`_apply_picklist_values`
  (today's dynamic-contact-picklist mechanism) re-point from
  `ContactPicklistValue` to the generic helpers — `ContactDetailOut
  .picklist_values` keeps working unchanged for admins/UI.
- `visits.py`: `torah_thought`/`visit_type` — same swap; `_out()` reads via
  `get_values`.
- `picklists.py`: `count_usage`/hard-delete unaffected in behavior.
- `app/core/backup.py` `SNAPSHOT_MODELS` and `admin.py`'s cascade-delete
  `ordered_models`: swap `ContactPicklistValue` → `PicklistLink`.

## §5 New schema surface for apartments (spec §2 "Dynamic Integration")
- `ApartmentOut`/`ApartmentListItem` gain `picklist_values: dict[str, str|None]`
  — populated with any `apartment.*` `PicklistDefinition` **not** one of the 4
  fixed fields (mirrors `ContactDetailOut.picklist_values`, already precedented).
- `ApartmentUpdate`/`ApartmentBase` gain the same `picklist_values` dict for
  writes, validated + stored via `set_value` per key.
- `GET /api/apartments/list` response includes each item's custom
  `picklist_values` so the frontend can render dynamic columns without an
  extra request per row.

## §6 Frontend — Apartments page (`app/dashboard/apartments/page.tsx`)
- **Grid width**: drop the `max-w-4xl` wrapper (Contacts page has none) so the
  table can use the full dashboard width.
- **Inline edit**, same `InlineEdit` + versioned-PUT pattern already used for
  jewish/campaign/mezuzah:
  - Language → `PicklistSelect` (`apartment.language`), same as the 3 existing.
  - Comments (`apartment_notes`), Email, Phone → plain text `InlineEdit`
    (textarea for notes).
  - Apartment number (`apartment_name`) → **kept as the existing Link** to the
    detail page (unchanged navigation); a small separate ✎ icon beside it opens
    inline edit in place, so the cell's only click target isn't ambiguous
    between "navigate" and "edit" (confirmed with the user).
- **Language filter**: new `MultiSelectFilter` over `apartment.language`,
  mirrors the existing jewish/mezuzah filter chips.
- **Filter toggle**: mirrors fixes29 §1 on Contacts exactly — one
  `filtersOpen` `usePersistentState`, wraps both the filter-chip row *and* the
  sort/group/column-config/bulk-edit row (and the field-config panel), collapsed
  state shows an active-filter-count badge.
- **Column drag-reorder**: no DnD library in the repo (checked) — implemented
  with native HTML5 `draggable`/`onDragOver`/`onDrop` on the chips inside the
  existing "התאמת שדות" panel (no new dependency). Order is persisted by
  reusing the existing DB preference `apartments.fields` — today it only
  tracks *membership*; `activeFields` currently renders in the fixed
  `FIELD_KEYS` constant order regardless of the stored array's order. Change:
  `activeFields` becomes "the stored `fields` array, in its own order,
  filtered to known keys" — so drag-reordering the chips and persisting the
  new array order is sufficient, no new preference key needed.
- **Dynamic custom apartment picklists**: for every `apartment.*`
  `PicklistDefinition` not in the 4 fixed keys, the page (a) renders an extra
  `MultiSelectFilter` sourced from that picklist's options, sent as
  `picklist=field_key:value` params (§4), and (b) renders an extra grid column
  using `InlineEdit`+`PicklistSelect` against `item.picklist_values[field_key]`,
  saved via `PUT /apartments/{id}` with `{ picklist_values: { [field_key]: v } }`.

## §7 Frontend — Picklists dashboard (`app/dashboard/picklists/page.tsx`)
- Clear visual split: the existing two-group render (`!startsWith("apartment.")`
  vs `startsWith("apartment.")`) becomes two visually distinct sections
  (heading style + a colored section wrapper) — "Contact Picklist" section vs
  "Apartment Picklist" section.
- The existing bottom `<AddPicklist>` form moves inside the Contact section,
  relabeled **"הוספת רשימת בחירה לאיש קשר"** ("Add picklist to contact").
- New **"הוספת רשימת בחירה לדירה"** ("Add picklist to apartment") section:
  same `AddPicklist` form, `system_name` auto-prefixed `apartment.` (user
  types the suffix only) so it always lands in the apartment group and is
  immediately picked up by §6's dynamic filter/column logic — no other wiring
  needed per new picklist, which is the whole point of §1–§5.

## Cross-cutting
- Every new Hebrew string gets a `LOCALIZATION` seed row (project rule).
- `field_registry.py` TOGGLEABLE_FIELDS namespace is untouched (independent
  registry, no coupling to picklist storage).
- Tests: most response-JSON assertions keep passing unchanged (contract
  preserved); the real breakage is wherever a test directly constructs
  `models.Apartment(jewish_status=...)` / `models.Contact(pipeline_status=...)`
  etc. — those call sites get found (grep) and fixed to go through the API or
  the new helper. `scripts/import_data3.py` (writes `jewish_status`/`language`
  directly into the `Apartment(...)` constructor) gets updated to the new
  write path; `scripts/import_data1.py` was already dead pre-refactor
  (references a model removed in fixes25) — left alone.
- Verification: full backend pytest in Docker (local SQLite), `tsc --noEmit`
  in the frontend container (Vercel-build rule), headless-Chrome drive of the
  apartments grid (inline edit ×5 fields, language filter, filter toggle,
  column drag-reorder, a custom apartment picklist end-to-end) and the
  picklists dashboard (both new sections, add-to-contact, add-to-apartment).
- No commit/push — the user commits themselves (standing rule); this migration
  runs locally only in this session.
