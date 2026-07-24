# fixes37 plan — `PicklistDefinition.entity_type` as data

## Root cause

`picklist_values.field_key` / `picklists.system_name` strings follow a
namespace convention (`contact.*`, `apartment.*`, `visit.*` / `checklist.*` /
`interaction.*`, `significant_date.*`, plus a few legacy bare names —
`Jewish_status`, `affiliation`, `language` — that are contact fields with no
prefix at all). Nothing in the schema records this; it's tribal knowledge
re-implemented at every read site:

- `frontend/lib/picklists.ts` — `FIXED_CONTACT_PICKLIST_KEYS` /
  `FIXED_APARTMENT_PICKLIST_KEYS`.
- `frontend/components/ContactView.tsx`, `ContactForm.tsx`,
  `app/dashboard/contacts/page.tsx` — `customDefs` filter: "not a foreign
  prefix (`apartment.`/`visit.`/`checklist.`/`interaction.`/`shliach.`/
  `significant_date.`) and not in `FIXED_CONTACT_PICKLIST_KEYS`" ⇒ treat as a
  contact field. This is an **exclusion list** — anything not explicitly
  excluded falls through and renders. That's the fixes36 bug: two keys
  (`contact.contact_type`, `significant_date.type`) weren't on any exclusion
  list and leaked through.
- `frontend/app/dashboard/apartments/page.tsx`, `apartments/[id]/page.tsx`,
  `components/ApartmentEditor.tsx` — `customDefs` filter: `field_key.startsWith("apartment.")
  && !FIXED_APARTMENT_PICKLIST_KEYS.includes(...)`. An **inclusion** list, so
  this side never had the leak bug — but it's the same underlying guesswork,
  just safer by luck of which direction the filter runs.
- `frontend/app/dashboard/picklists/page.tsx` — `tabFor()` re-derives the
  same grouping a third way, for the admin management UI's tab bar.
- Backend `picklist_utils.py` — `PICKLIST_FIELDS: dict[str, str]` maps
  `system_name -> hebrew label` only; no entity is recorded even in the
  server-side registry that seeds these rows.
- Backend `models.PicklistDefinition` has no `entity_type` column — contrast
  `models.CustomFieldDefinition.entity_type` (fixes35), which already solved
  this same problem for the *other* per-entity field system.

One more data point: `app/dashboard/picklists/page.tsx`'s `AddPicklist`
already silently prepends a `prefix` (`"apartment."`, `"visit."`, `""`) based
on which of the 3 admin tabs the admin is adding from
(`frontend/app/dashboard/picklists/page.tsx:268-306`). So the entity is
already known at creation time in the UI — it's just being smuggled into the
`system_name` string instead of being sent as its own field.

## Fix

### Backend

1. `backend/app/models.py` — add to `PicklistDefinition`:
   ```python
   entity_type = Column(String(30), nullable=False, default="contact")
   ```
   Allowed values: `"contact" | "apartment" | "visit" | "significant_date"`
   (mirrors the same four groups `CustomFieldDefinition.entity_type` already
   uses, plus `significant_date` which `CustomFieldDefinition` doesn't have).

2. New Alembic migration:
   - Add the column with `server_default='contact'` so the migration itself
     doesn't fail on existing rows.
   - Backfill every existing row from its `system_name` prefix (the exact
     mapping the frontend uses today):
     - `apartment.*` → `apartment`
     - `visit.*`, `checklist.*`, `interaction.*` → `visit`
     - `significant_date.*` → `significant_date`
     - everything else (`contact.*`, `Jewish_status`, `affiliation`,
       `language`, and any other admin-created contact-tab custom picklist)
       → `contact`
   - Drop the server default afterward — every future insert (seed or admin
     create) must pass `entity_type` explicitly; no silent fallback that
     reintroduces guessing.

3. `backend/app/picklist_utils.py` — `PICKLIST_FIELDS` currently drives
   `seed_picklist_definitions`'s inserts and `set_value`'s self-heal path
   (creates a missing system definition on the fly). Extend it to carry
   entity_type too, e.g.:
   ```python
   PICKLIST_FIELDS: dict[str, tuple[str, str]] = {
       "contact.contact_type": ("סוג איש קשר", "contact"),
       ...
       "significant_date.type": ("סוג תאריך", "significant_date"),
       "apartment.language": ("שפה", "apartment"),
   }
   ```
   Update both call sites (`seed_picklist_definitions` in `seed.py`, and the
   self-heal `models.PicklistDefinition(...)` construction in `set_value`) to
   unpack `(hebrew_label, entity_type)` instead of a bare string.

4. `backend/app/schemas.py`:
   - `PicklistFieldOut` — add `entity_type: str`.
   - `PicklistDefinitionCreate` — add `entity_type: str` (required — the
     admin UI already knows which tab it's creating from, so it should say
     so explicitly instead of the backend inferring it later).

5. `backend/app/routers/picklists.py`:
   - `list_field_keys` — include `entity_type=d.entity_type` in the
     `PicklistFieldOut` it builds.
   - `create_definition` — set `entity_type=payload.entity_type` on the new
     `PicklistDefinition` row. Keep prepending the tab's prefix to
     `system_name` as today (readability / stays consistent with existing
     rows) — it's now cosmetic, not the source of truth.

### Frontend

6. `frontend/lib/types.ts` (`PicklistField` type) — add `entity_type: string`.

7. `frontend/lib/picklists.ts` — `FIXED_CONTACT_PICKLIST_KEYS` /
   `FIXED_APARTMENT_PICKLIST_KEYS` stay (still needed: they mark picklists
   that already have their own dedicated static UI field, which is a
   different question from "which entity owns this"), but nothing else in
   this file needs to change.

8. Replace the filter logic at each of these call sites with a check against
   `d.entity_type`, combined with the existing fixed-key exclusion:
   - `ContactView.tsx`, `ContactForm.tsx`, `app/dashboard/contacts/page.tsx`:
     ```ts
     d.entity_type === "contact" && !FIXED_CONTACT_PICKLIST_KEYS.includes(d.field_key)
     ```
     (No more prefix-exclusion list — `significant_date.type` is now
     `entity_type: "significant_date"`, so it's excluded structurally, not
     by a special-cased `startsWith` check.)
   - `app/dashboard/apartments/page.tsx`, `apartments/[id]/page.tsx`,
     `components/ApartmentEditor.tsx`:
     ```ts
     d.entity_type === "apartment" && !FIXED_APARTMENT_PICKLIST_KEYS.includes(d.field_key)
     ```

9. `app/dashboard/picklists/page.tsx`:
   - Replace `tabFor(fieldKey)`'s prefix-sniffing with a lookup on
     `field.entity_type` (`"visit"` → visit tab, `"apartment"` → apartment
     tab, `"contact"` or `"significant_date"` → contacts tab — preserving the
     fixes33 decision to manage `significant_date.*` from the contacts tab,
     now driven by data instead of a string check).
   - `AddPicklist` sends `entity_type` explicitly in the `POST
     /api/picklists/definition` body (the value is already implied by which
     tab/section renders the form — `"contacts"`/`"visit"`/`"apartment"` —
     just needs to be passed through instead of only baked into the
     `prefix`-assembled `system_name`).

10. No change to `models.PicklistLink.entity_table` — that's a different,
    already-correct concept (the literal DB table a value row is stored
    against). `PicklistDefinition.entity_type` is the new "which logical
    entity owns this field, for UI purposes" concept; for the visit-family
    keys (`visit.`/`checklist.`/`interaction.`) it's `"visit"` even though
    `PicklistLink.entity_table` varies underneath (`visit_history` today).

## Verification

- `pytest` in backend — extend `tests/test_picklists.py`:
  - `seed_picklist_definitions` backfills the correct `entity_type` per key.
  - `POST /api/picklists/definition` round-trips `entity_type`.
  - `GET /api/picklists` returns `entity_type` for every seeded system field.
- `tsc --noEmit` in the frontend container (project rule — dev mode hides
  build-breaking TS errors).
- Headless-drive regression, generalizing the fixes36 check: from each of the
  3 admin Picklists tabs, create one throwaway custom picklist; confirm each
  one appears **only** in its own tab and **only** in the matching entity's
  dynamic custom-field list (contact detail/form/list, or apartment
  list/detail/editor) — not the others.
- Neon spot-check after the migration runs: confirm org 1's already-seeded
  and already admin-created picklists backfilled to the expected
  `entity_type` (`contact.contact_type`→contact, `apartment.campaign_status`→
  apartment, `visit.type`→visit, `significant_date.type`→significant_date).

## Rollout note

Neon prod is several fixes rounds behind (fixes30 onward are done locally but
not deployed — see project memory). This migration should ship in the same
deploy batch as those, not on its own. Per standing rule, no commit/push
without an explicit ask in-session.
