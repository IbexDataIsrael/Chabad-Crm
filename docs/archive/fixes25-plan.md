# fixes25 Implementation Plan — Visit-Centric Data Restructuring

Source spec: `docs/fixes25.md`. The core move: interactions, Mivtzoim flags,
and custom fields stop being *contact-level* state and become *visit-level*
records — every visit logs what happened on that visit.

## Interpretation decisions (spec ambiguities, resolved)

1. **"hanukkah_party" is not a hard column.** It is an existing per-org custom
   field (`custom_field_definitions.field_key='hanuka_party'`). §3/§4 keep the
   custom-fields engine alive (re-routed to visits), so the field keeps working
   through it; adding a parallel hard column would duplicate state. Only
   `connection_to_rebbe` (today `contact_mekurav.rebbe_connection`) becomes a
   real visit column.
2. **Checklist per-boolean notes** (`tefillin_notes` …) have no home in the
   spec'd visit schema. To avoid silent data loss, the migration folds them
   into the migration-visit's `notes` text ("<label>: <note>" lines); the
   pre-migration JSON backup preserves the raw values regardless.
3. **`torah_thought`** stays driven by the `checklist.torah_thought` picklist
   in the UI; the visit column is plain text as specced (a picklist value *is*
   text).
4. **Mitzvot contact filters** (fixes17 §2.2 `has_mitzvot` / `mitzvot`) survive
   by re-pointing at visits: a contact matches when *any of its visits* carries
   the flags.
5. **Interactions become a JSON array on the visit** (spec offers JSONB/string
   array): `[{category, note, created_at, author_name}]`. The standalone
   `interactions` table, router and timeline UI are removed; the visit form
   gains an inline interactions editor (same category picklist).

## §1 Pre-migration backup (script)

`backend/scripts/fixes25_backup.py` — connects via the app's DATABASE_URL,
dumps `backups/fixes25-pre-migration-<ts>.json`:
`{contact_id: {interactions: [...], checklist: {...}, custom_fields: [...],
rebbe_connection}}` — exactly the data the migration destroys. Run against
local PG now; **must be run against Neon before deploying**.

## §2 Alembic migration (`fixes25_visit_restructure`, down_rev b4c5d6e7f8a9)

1. `visit_history` gains: `interactions` JSON; booleans `tefillin`, `tzedakah`,
   `shabbat_candles`, `torah_pamphlet`, `letter_in_torah` (NOT NULL, false);
   `torah_thought` TEXT; `connection_to_rebbe` TEXT.
2. `custom_field_values` gains nullable `visit_id` FK.
3. **Hydration** (same connection, in-transaction): for every contact holding
   any of {interactions, non-empty checklist, custom values, rebbe_connection}
   insert one migration visit dated `contact.created_at` (fallback now), carrying
   the transformed data; re-point that contact's `custom_field_values.visit_id`.
4. **Destructive clean-up**: drop tables `interactions`,
   `community_checklists`; drop `contact_mekurav.rebbe_connection`; drop
   `custom_field_values.contact_id` (constraint `uq_customval_contact_def` →
   `uq_customval_visit_def` on (visit_id, definition_id); rows without a visit
   are deleted — they can only be all-empty values).

## §3 Backend

- **models.py**: columns above; delete `Interaction`, `CommunityChecklist`;
  `CustomFieldValue.contact_id` → `visit_id`; relationships updated
  (`VisitHistory.custom_values`, drop `Contact.checklist/interactions/custom_values`,
  drop `User.interactions`).
- **visits router**: create/update accept the new fields (validate
  `checklist.torah_thought` + `interaction.category` picklists); new
  `GET/PUT /api/visits/{id}/custom-fields` (values merged with definitions —
  same shape the contact endpoints had). Per-contact sub-resource keeps parity.
- **contacts router**: checklist + custom-fields sub-resources removed;
  `has_mitzvot`/`mitzvot` filters re-pointed at `visit_history` booleans;
  new `visit_from`/`visit_to` (ISO date) params on `/list` — EXISTS on the
  contact's visits within the range (the spec's "inner join" semantics).
- **interactions router** deleted (and unregistered).
- **users/admin routers**: drop interaction re-owning on user delete; org
  delete + superadmin user-deps re-scoped (custom values via visit ids).
- **core/backup.py**: model list updated; `CustomFieldValue` becomes
  visit-scoped (serialized via the org's visit ids); interaction restore
  special-case removed. Old backups containing dropped tables: restore
  tolerates unknown tables by skipping them (guard added).
- **picklist_utils**: `checklist.torah_thought` maps to
  `VisitHistory.torah_thought`; `interaction.category` usage-count falls back
  to 0 (values now live inside JSON); checklist join special-case removed.
- **seed.py**: demo data seeds visits with mivtzoim/interactions instead of
  checklist+interaction rows.
- **Phone validation**: already optional + conditionally validated
  (`_validate_phone` runs only on non-blank input; column nullable since the
  data import). Covered by a new regression test only.

## §4 Frontend

- **Nav**: Visits entry removed from the People menu; `/dashboard/visits`
  still routes (verified by the headless drive).
- **Contacts page**: "טווח תאריכי ביקור" — two `DatePicker`s (from/to) wired
  to `visit_from`/`visit_to`, persisted like the other filters.
- **VisitForm** grows the visit-log workflow: Mivtzoim boolean panel (5 flags +
  torah_thought picklist), connection-to-rebbe textarea, inline interactions
  editor (category picklist + note, add/remove), custom-fields editor
  (definitions fetched; values loaded per visit, saved via the new endpoint
  after create/update).
- **Contact profile/new**: ChecklistFields + CustomFieldsEditor +
  InteractionsTimeline blocks removed (and their save calls);
  `rebbe_connection` leaves the mekurav section; ContactView drops the
  מבצעים/custom-fields display sections.
- **Components**: `InteractionsTimeline` + `ChecklistFields` deleted;
  `CustomFieldsEditor` (pure controlled) reused by the visit form; new
  `VisitExtrasFields` component for the mivtzoim/interactions panel.
- **types.ts**: `Visit` gains the new fields; `Checklist`/`Interaction`
  reshaped (visit-scoped `VisitInteraction`); `CHECKLIST_ROWS` becomes the
  visit flags list (`MIVTZOIM_FLAGS`).

## §5 i18n

- New `visits.*` seed block (dedicated VISITS namespace): flag labels,
  section titles (מבצעים, אינטראקציות, שדות נוספים, קשר לרבי), date-range
  filter label "טווח תאריכי ביקור", plus en translations.
- Picklists page audit: the system-list headings come from the backend
  registry's *Hebrew-only* `PICKLIST_FIELDS` (e.g. "סוג איש קשר") and don't
  switch in English mode unless an admin typed an English name. Fix: seed
  `picklist_def.<field_key>` localization rows and make `defLabel` fall back
  to `t("picklist_def."+key)`; also the literal "עברית"/"English" input labels
  in the definition editor become `t()` calls.

## §6 Logo upload local fallback

- `POST /api/uploads/logo`: when Cloudinary is unconfigured **or** its call
  fails/times out, save the image to `<data>/uploads/logos/<uuid>.<ext>` and
  return the absolute URL (`request.base_url` + `uploads/logos/...`).
- `main.py` mounts StaticFiles at `/uploads` over the same dir (created on
  boot; lives on the Docker volume locally).
- Frontend flow unchanged (LogoUpload → uploadLogo → org settings persist the
  returned URL into `organizations.logo_url`).

## Verification

- Backup script run on local PG (real imported data), then boot-migration and
  data spot-checks (counts of migration visits vs. old rows).
- pytest suite updated (interaction/checklist/custom-field/user-delete/backup
  tests rewritten for the visit model) + new tests (visit extras round-trip,
  date-range filter, phone-optional regression, logo fallback).
- `tsc --noEmit`; headless drive: visits page reachable by URL, nav link gone,
  contact page shows no mivtzoim, visit form logs mivtzoim+interaction, PDF…
  n/a. Commit at the end.
