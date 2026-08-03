# Fix Task: `PicklistDefinition.entity_type` as real data

## Context & Target
- Follow-up from fixes36 (duplicate "Contact Type" / leaked "Date type" on
  `Contact_mekurav`). That bug's root cause was a broader pattern, not a
  one-off: which entity a picklist belongs to (contact / apartment / visit /
  significant_date) is only encoded as a **string-prefix convention** on
  `field_key` (e.g. `apartment.mezuzah_status`, `significant_date.type`).
  Nothing in the database says "this picklist belongs to contacts." Every
  screen that needs to know re-derives it itself, in code.

## Issue
- 8 frontend files independently parse `field_key` prefixes / maintain their
  own fixed-key exclusion lists to decide "does this picklist belong to me":
  `lib/picklists.ts`, `components/ContactView.tsx`, `components/ContactForm.tsx`,
  `app/dashboard/contacts/page.tsx`, `app/dashboard/apartments/page.tsx`,
  `app/dashboard/apartments/[id]/page.tsx`, `components/ApartmentEditor.tsx`,
  `app/dashboard/picklists/page.tsx` (`tabFor()`).
- The contact-side files use an "exclude known-foreign-prefixes, keep
  everything else" heuristic — that's exactly what let `contact.contact_type`
  and `significant_date.type` leak through in fixes36. The same bug shape can
  recur any time a new entity or field_key namespace is added and someone
  forgets to update all the exclusion lists in lockstep.
- The apartment-side files happen to use a safer "must start with
  `apartment.`" positive match, so they didn't have this specific bug — but
  that's inconsistency, not a designed guarantee.
- Backend: `PicklistDefinition` has no `entity_type` column at all (unlike
  the newer, more general `CustomFieldDefinition`, which already has one from
  fixes35). The backend's own system registry (`PICKLIST_FIELDS` in
  `picklist_utils.py`) also only maps `system_name -> hebrew label`, no
  entity.

## Action Required
- Promote "which entity owns this picklist" into a real, required column
  (`PicklistDefinition.entity_type`), set explicitly at creation time and
  returned by the API, so every frontend consumer reads a fact instead of
  guessing from a naming convention.
- Replace every prefix-sniffing / exclusion-list check in the 8 files above
  with a lookup against that column.

## Expected Outcome
- Adding a new entity, or a new picklist under an existing entity, can never
  again silently render in the wrong place (or duplicate) because someone
  forgot to update a hardcoded list — the frontend asks the data, not a
  convention.
- The admin Picklists page's tab grouping (contacts / visit / apartment) is
  driven by the same column, not its own copy of the prefix logic.

## Status: DONE (2026-07-24, uncommitted)

Plan: `docs/fixes37-plan.md`.

- [x] `PicklistDefinition.entity_type` added (`backend/app/models.py`),
      values `contact_mekurav | contact_shliach | apartment | visit |
      significant_date` — matches `CustomFieldDefinition.entity_type`'s
      existing vocabulary exactly.
- [x] Migration `a0b1c2d3e4f5` adds the column and backfills every existing
      row from its `system_name` prefix, including `shliach.*` →
      `contact_shliach` (a real sub-namespace discovered mid-implementation,
      not in the original plan — see below). Local Postgres backfill spot
      checked directly via `psql`; matched expectations across all 41 local
      orgs (org 1's real dataset: all 15 system picklists correct, zero
      custom ones).
- [x] `PICKLIST_FIELDS` registry, `seed_picklist_definitions`, and
      `set_value`'s self-heal path all carry entity_type now
      (`backend/app/picklist_utils.py`, `seed.py`).
- [x] `PicklistFieldOut`/`PicklistDefinitionCreate` schemas + the
      `/api/picklists/definition` router return/accept `entity_type`; the
      router auto-upgrades `contact_mekurav` → `contact_shliach` when the
      typed name starts with `shliach.`, so the admin Picklists page's
      "contacts" tab needed no new UI control.
- [x] All 8 originally-planned frontend filters (`ContactView.tsx`,
      `ContactForm.tsx`, `contacts/page.tsx`, 3 apartment files,
      `lib/picklists.ts`/types, `app/dashboard/picklists/page.tsx`'s
      `tabFor()`) now read `entity_type` instead of guessing from
      `field_key` prefixes.
- [x] **Beyond the original plan:** found and fixed 2 more prefix-sniffing
      sites while implementing — `field_registry.py`'s `picklist_entity()`
      (used by `/api/field-settings`, whose own comment already flagged the
      inconsistency: "entity comes straight from the definition's own
      entity_type column — no prefix-sniffing needed, unlike picklists")
      removed entirely in favor of reading `d.entity_type` directly; and
      `routers/custom_fields.py`'s select-type auto-provisioning of a
      `PicklistDefinition` (fixes35 §5) now passes `entity_type` through
      instead of silently defaulting to `contact_mekurav` regardless of the
      field's real entity — this one was a live, real bug, caught by a
      pre-existing fixes35 test (`test_shliach_select_field_uses_shliach_
      prefix_and_entity`) failing red before the fix.
- [x] Backend: 362/362 pytest passing (incl. 3 new fixes37 tests: seed
      backfill correctness, `create_definition` round-trip, the
      shliach-prefix auto-upgrade).
- [x] Frontend: `tsc --noEmit` clean in the container.
- [x] Live smoke check against the real local dev app (not just tests):
      org 1's actual backfilled data spot-checked via `psql`; contacts,
      apartments, and admin Picklists pages all compile and return 200 with
      no console/build errors on the running dev server.
- [x] Local Postgres backed up before the migration ran:
      `backend/backups/local_pre_fixes37_20260724.sql`.

**Not done:** Neon (prod) migration — prod is still several fixes rounds
behind (fixes30+ never deployed, per project notes) and this should ship in
the same batch, not on its own. No commit/push made (standing rule: only on
explicit ask).
