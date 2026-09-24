MINICRM - INSTINCT API PHASE 2 SPEC
===================================
Repo: IbexDataIsrael/minicrm
Backend base URL: https://minicrm-1-phw9.onrender.com
Extends: docs/system_api.md (phase 1)

IMPORTANT - WHO WRITES THE REPO
All repo writes are Zvi's. Claude Code PROPOSES file contents only; Zvi alone
saves, commits and pushes. Do not commit, do not push, do not open PRs.

CONTEXT FROM THE REAL REPO (verified by reading the code, do not re-invent):
- Phase 1 router: backend/app/routers/instinct.py. Auth: dependency check_key
  (header X-Instinct-Key == env INSTINCT_API_KEY; unset key never matches).
  Target org: env INSTINCT_ORG_ID (default 1). Reuse both.
- Contact model: contacts.name (first), contacts.last_name, contacts.phone
  (unique per org, nullable), contacts.email, contacts.address, source
  ('crm'|'instinct'), status ('active'|'draft'), created_at. Phase 1 create
  also inserts a ContactMekurav row (contact_type='mekurav').
- ContactMekurav (contact_mekurav): 1:1 kiruv data; has apartment_id FK to
  apartments.id - THIS is the contact<->apartment link.
- VisitHistory (visit_history): contact_id (nullable), visit_date (DateTime,
  required), location, notes, interactions (JSON). Indexed on
  (organization_id, visit_date).
- Custom fields ALREADY EXIST as a generic mechanism:
  CustomFieldDefinition (organization_id, entity_type ['contact'|'visit'|
  'apartment'|...], field_key, hebrew_label, english_label, field_type
  ['text'|'number'|'boolean'|'date'|'select'], is_active) and
  CustomFieldValue (organization_id, entity_table, entity_id, definition_id,
  value as Text, unique on entity_table+entity_id+definition_id). The Mivtzoim
  booleans (tefillin etc.) already live there as entity_type='visit' fields
  (see app/seed.py seed_visit_mivtzoim_custom_fields). DO NOT add tefillin/
  mezuza columns - use this mechanism.
- Apartment (apartments): VERSIONED (is_display, root_id, last_edit,
  editor_id) - exactly one is_display=True row per lineage. Fields:
  building_id (NOT NULL FK to buildings), apartment_name, apartment_notes,
  floor, name (resident), phone, email. Building (buildings): building_name,
  building_address, is_town_house, building_type_id. So "search apartment by
  address" = search buildings.building_address + apartments.is_display=True.
- Task (tasks): campaign-scoped volunteer assignment (campaign_id NOT NULL,
  volunteer_user_id). It is the WRONG fit for a visit follow-up like "bring
  mezuza". Do NOT reuse it. This spec adds two lightweight columns on
  visit_history instead (see section 3).
- Existing helper to reuse: _check_phone_unique(db, org_id, phone) and
  _geocode_fallback(data) from app/routers/contacts.py; _normalize_email from
  app/schemas.py.
- Alembic versions live in backend/alembic/versions/, named
  <hex>_<slug>.py (e.g. e6f7a8b9c0d1_contacts_source_status.py).

GENERAL RULES FOR ALL NEW ENDPOINTS
- All under /api/instinct/, all guarded by the same check_key dependency.
- Draft-first philosophy: anything the API CREATES that a human would
  normally review lands as source='instinct', status='draft' and waits for
  approval in the app. Updates (PATCH) to existing approved records apply
  directly - they are data entry, not new entities.
- NEVER validate names. Any string is a legal name (Zvi's explicit ruling).
  Ambiguous name splitting (which word is the surname) is the caller's
  problem; the API stores what it is given.
- Notes/comments are the universal parking lot: every create/update endpoint
  accepts a free-text notes field; anything the assistant cannot map to a
  structured field goes there, and the assistant tells the user it parked it.
- Compact list responses: id + summary fields only. No ORM dumps.
- All errors: 422 with a clear English message (Hebrew label optional).
- Pydantic schemas in the router file, same style as phase 1.

=====================================================================
1. CONTACT SEARCH BY NAME
=====================================================================
Entry point of every voice flow ("do you have Moshe Mizrahi?").

GET /api/instinct/contacts/search?q=<string>[&status=active|draft|all]
- q required, min 1 char. Case-insensitive substring match on
  name || ' ' || last_name AND on each part separately (so "Mizrahi Moshe"
  also matches). Use ILIKE '%q%' on name and last_name, plus the
  concatenation; de-dup results.
- Default status='all' (the assistant needs drafts too, to avoid creating a
  duplicate of a contact that is still pending approval).
- Return 200: {"results": [{"id", "name", "last_name", "phone", "email",
  "source", "status", "apartment_id"}...]} capped at 20, ordered drafts
  first then by name. apartment_id from contact_mekurav (NULL if none).

Acceptance:
  curl -H "X-Instinct-Key: $INSTINCT_API_KEY" \
    "https://minicrm-1-phw9.onrender.com/api/instinct/contacts/search?q=Moshe%20Mizrahi"
  -> 200, results is a list; a contact named "Moshe Mizrahi" appears with id.

=====================================================================
2. PHONE FORMAT VALIDATION (applies to every endpoint taking a phone)
=====================================================================
Mirror the phase-1 email validation: Israeli mobile only.
- Rule: strip spaces, dashes, parentheses; accept optional leading +972
  (convert to 0) or 972 (convert to 0); result must match ^05[0-9]{8}$
  (05X, 10 digits total).
- On failure: 422 {"detail": "invalid Israeli mobile phone: expected 05X + 8
  more digits (10 total), e.g. 0501234567"}.
- Normalized form (05XXXXXXXX) is what gets stored (and uniqueness-checked
  via _check_phone_unique on create).
- NEVER apply any equivalent rule to names.
- Add the validator to POST /api/instinct/contacts (phase 1 endpoint) too -
  this is a bug-compatible change: previously any string was accepted.

Acceptance:
  curl -X POST https://minicrm-1-phw9.onrender.com/api/instinct/contacts \
    -H "X-Instinct-Key: $INSTINCT_API_KEY" -H "Content-Type: application/json" \
    -d '{"first_name":"Moshe","last_name":"Mizrahi","phone":"12345"}'
  -> 422 with the message above.
  Same call with "phone":"050-123-4567" -> 201, stored as "0501234567".

=====================================================================
3. VISITS
=====================================================================
POST /api/instinct/visits
Body:
{
  "contact_id": 123,              // optional but must exist in this org if sent
  "apartment_id": 45,             // optional, must exist (is_display=True) if sent
  "date": "2026-09-24",           // required, YYYY-MM-DD
  "time": "21:30",                // optional, HH:MM 24h
  "location": "1414 Eastern Parkway, Brooklyn",  // optional
  "notes": "danced with him until midnight",     // optional free text
  "followup_task": "bring mezuza",               // optional free text
  "custom_fields": {"tefillin": true, "tefillin_count": 1}   // optional
}
- visit_date = date + time (default 12:00 when time absent), stored as the
  existing visit_history.visit_date DateTime.
- At least one of contact_id / apartment_id is required (422 otherwise).
  contact_id -> visit_history.contact_id. apartment_id is stored in
  location as "apartment:<id>" ONLY if location is empty? NO - do not hack
  columns. Instead: migration adds visit_history.apartment_id (nullable FK
  to apartments.id). Clean and indexable.
- followup_task: migration adds visit_history.followup_task (Text, nullable)
  and visit_history.followup_done (Boolean, default false). Rationale: the
  existing Task entity is a campaign-scoped volunteer assignment
  (campaign_id NOT NULL) - wrong shape for "bring mezuza". Two columns keep
  it simple and queryable in the daily summary.
- custom_fields: for each key, look up CustomFieldDefinition
  (organization_id, entity_type='visit', field_key=key, is_active=True).
  Unknown key -> do NOT fail; append "key=value" to notes instead and list
  the parked keys in the response as "parked_in_notes": ["..."]. Known key
  -> upsert CustomFieldValue (entity_table='visit_history', entity_id=
  visit.id, definition_id, value=str(value)); for boolean field_type also
  set checked. This is exactly how tefillin gets logged on a visit.
- Return 201: the visit as JSON: {"id", "contact_id", "apartment_id",
  "visit_date", "location", "notes", "followup_task", "followup_done",
  "custom_fields_written": {...}, "parked_in_notes": [...], "created_at"}.
- Visits are NOT draft-first (they are a log of something that happened);
  they write directly, same as UI-entered visits.

PATCH /api/instinct/visits/{id}/followup  {"followup_done": true}
- Marks the follow-up done. 404 if the visit is not in this org.

Acceptance:
  curl -X POST https://minicrm-1-phw9.onrender.com/api/instinct/visits \
    -H "X-Instinct-Key: $INSTINCT_API_KEY" -H "Content-Type: application/json" \
    -d '{"contact_id":123,"date":"2026-09-24","time":"23:50","notes":"danced with him until midnight","followup_task":"bring mezuza","custom_fields":{"tefillin":true}}'
  -> 201, id present, followup_task "bring mezuza", followup_done false.
  curl -X PATCH .../api/instinct/visits/<id>/followup -d '{"followup_done":true}' -> 200.

=====================================================================
4. CUSTOM FIELDS ON CONTACT (tefillin / mezuzot counters)
=====================================================================
Seed (migration data step, idempotent) these CustomFieldDefinition rows for
the org, entity_type='contact':
  field_key              field_type  hebrew_label
  tefillin_laid_count    number      הנחות תפילין
  tefillin_last_date     date        הנחת תפילין אחרונה
  mezuzot_ordered        number      מזוזות שהוזמנו
  mezuzot_installed      number      מזוזות שהודבקו

PATCH /api/instinct/contacts/{id}/fields
Body: {"fields": {"tefillin_laid_count": 3, "tefillin_last_date": "2026-09-24",
       "mezuzot_installed": 2}, "notes": "optional - appended to contact notes"}
- Contact must exist in this org (404 otherwise).
- For each field: find the definition (entity_type='contact', field_key,
  is_active). Unknown key -> park into notes (append "key: value") and list
  in "parked_in_notes"; never 422 on an unknown field key.
- Validate by field_type: number -> int, date -> YYYY-MM-DD, boolean -> bool,
  text -> str. Wrong type -> 422 naming the key.
- Upsert CustomFieldValue (entity_table='contacts', entity_id=contact.id).
- notes: migration adds contacts.notes (Text, nullable) - Contact has no
  notes column today; ContactMekurav.background is NOT the parking lot.
  Appended with a timestamp line, never overwritten.
- Return 200: {"id", "fields_written": {...}, "parked_in_notes": [...]}.

Acceptance:
  curl -X PATCH https://minicrm-1-phw9.onrender.com/api/instinct/contacts/123/fields \
    -H "X-Instinct-Key: $INSTINCT_API_KEY" -H "Content-Type: application/json" \
    -d '{"fields":{"tefillin_laid_count":3,"mezuzot_installed":2}}'
  -> 200, fields_written echoes both. Re-run -> same 200 (upsert, no dup rows).

=====================================================================
5. APARTMENTS
=====================================================================
The entity exists; this section adds Instinct access + draft-first.

5a. GET /api/instinct/apartments/search?q=<address string>
- ILIKE '%q%' on buildings.building_address joined to apartments
  (is_display=True) in this org. Also match apartment_name and
  apartments.name (resident).
- Return 200: {"results": [{"apartment_id", "apartment_name", "floor",
  "resident_name", "building_id", "building_address", "status"...]} cap 20.

5b. POST /api/instinct/apartments   (draft-first, like contacts)
Body: {"building_address": "1414 Eastern Parkway, Brooklyn",   // required
       "apartment_name": "4F", "floor": "4",                    // optional
       "resident_name": "...", "phone": "...", "email": "...",
       "notes": "free text - anything unmapped lands here"}
- If no building in this org matches building_address exactly
  (case-insensitive, trimmed), create it (buildings row, building_type_id
  'building', geocode via _geocode_fallback if it applies to buildings -
  check how routers/buildings.py does it and reuse).
- Create the apartment with is_display=True and the migration's new columns
  source='instinct', status='draft' (see section 8). Draft apartments are
  excluded from any UI list that already excludes drafts - check how the
  apartments page lists rows; if it has no status filter, add one mirroring
  contacts ("Pending approval" section optional this phase, the status
  column is the requirement).
- phone validated per section 2; email per the phase-1 regex; name fields
  never validated.
- Return 201: {"apartment_id", "building_id", "building_address", "source",
  "status"}.

5c. PATCH /api/instinct/apartments/{id}
Body: any of apartment_name, floor, resident_name, phone, email, notes,
status ('active' to approve).
- Apartments are VERSIONED: do not UPDATE in place. Mirror what
  routers/apartments.py update does - retire current row (is_display=False,
  last_edit, editor_id NULL since there is no user), insert the new active
  row with same root_id/lineage. Reuse the existing helper if one exists.
- notes -> apartment_notes (append with timestamp, don't overwrite).

5d. POST /api/instinct/contacts/{id}/link-apartment {"apartment_id": 45}
- Sets contact_mekurav.apartment_id (create the ContactMekurav row if the
  contact lacks one and is contact_type 'mekurav'; 422 if contact is not a
  mekurav or the apartment is not is_display=True in this org).
- Return 200 {"contact_id", "apartment_id"}.

Acceptance:
  curl -H "X-Instinct-Key: $INSTINCT_API_KEY" \
    "https://minicrm-1-phw9.onrender.com/api/instinct/apartments/search?q=1414%20Eastern%20Parkway"
  curl -X POST .../api/instinct/apartments -d '{"building_address":"1414 Eastern Parkway, Brooklyn","apartment_name":"4F"}' -> 201, status "draft".
  curl -X POST .../api/instinct/contacts/123/link-apartment -d '{"apartment_id":<id>}' -> 200.

=====================================================================
6. READ QUERIES FOR WHATSAPP ANSWERS
=====================================================================
6a. GET /api/instinct/stats/registrations?date=YYYY-MM-DD (default: today,
    server local time)
- Count contacts in this org with created_at on that date, split by source.
- 200: {"date": "...", "total": 7, "by_source": {"crm": 2, "instinct": 5}}.
  Answers "how many registered today?"

6b. GET /api/instinct/contacts?created_on=YYYY-MM-DD&status=active&limit=50
- Compact rows only: {"results": [{"id", "name", "last_name", "phone",
  "status"}...]}. created_on optional; status optional.
  Answers "who registered today?" with a name+phone list.

6c. GET /api/instinct/stats/daily?date=YYYY-MM-DD (default today)
- Visits on that date in this org:
  {"date": "...", "visits_count": 4,
   "visits": [{"id", "contact_id", "contact_name", "apartment_id", "time",
               "followup_task", "followup_done"}...],
   "tefillin": {"visits_with_tefillin": 2, "total_pairs": 3},
   "open_followups": ["bring mezuza (Moshe Mizrahi)", ...]}
- tefillin numbers come from the entity_type='visit' custom field values
  (boolean 'tefillin' and/or number 'tefillin_count' definitions - read both
  if they exist, zero otherwise). contact_name = name + last_name join.

Acceptance:
  curl -H "X-Instinct-Key: $INSTINCT_API_KEY" \
    "https://minicrm-1-phw9.onrender.com/api/instinct/stats/registrations"
  curl -H "X-Instinct-Key: $INSTINCT_API_KEY" \
    "https://minicrm-1-phw9.onrender.com/api/instinct/stats/daily?date=2026-09-24"
  Both 200 with the shapes above.

=====================================================================
7. NOTES/COMMENTS EVERYWHERE (summary of the parking-lot rule)
=====================================================================
- contacts.notes        - NEW column (migration). PATCH-able via section 4.
- visit_history.notes   - exists; section 3 writes it.
- apartments.apartment_notes - exists; section 5c appends to it.
- Unmappable custom-field keys never fail a request: they are appended to
  the entity's notes and reported back as "parked_in_notes" so the
  assistant can tell the user "I parked X in notes".

=====================================================================
8. ALEMBIC MIGRATION (one file, backend/alembic/versions/)
=====================================================================
Name: f1a2b3c4d5e6_instinct_phase2.py (any fresh hex id; run `alembic heads`
and set down_revision to the current head - DO NOT guess it).

upgrade():
  1. contacts: ADD COLUMN notes Text NULL.
  2. visit_history: ADD COLUMN apartment_id Integer NULL FK apartments.id,
     ADD COLUMN followup_task Text NULL,
     ADD COLUMN followup_done Boolean NOT NULL DEFAULT false,
     index on (organization_id, visit_date) already exists - add
     ix_visit_history_org_followup on (organization_id, followup_done)
     WHERE followup_task IS NOT NULL if you want the open-followups query
     fast (partial index, postgresql_where).
  3. apartments: ADD COLUMN source String(20) NOT NULL DEFAULT 'crm'
     (server_default 'crm'), ADD COLUMN status String(20) NOT NULL DEFAULT
     'active' (server_default 'active'), index on status. NOTE: apartments
     are versioned - the new columns need no backfill logic beyond the
     server default; existing rows are 'crm'/'active' which is correct.
  4. Seed (idempotent INSERT ... WHERE NOT EXISTS, or check-then-insert in
     Python) the four entity_type='contact' CustomFieldDefinition rows from
     section 4 for organization_id = value of INSTINCT_ORG_ID fallback 1.
     CustomFieldDefinition has a guid column - check how existing seeds
     generate it (app/seed.py) and do the same.

downgrade(): drop the index, the columns, and the seeded definitions.

Acceptance: `alembic upgrade head` on a copy of the prod schema runs clean;
`alembic downgrade -1` runs clean; contacts list in the UI unchanged.

=====================================================================
9. WHAT TO CHANGE IN EXISTING FILES
=====================================================================
- backend/app/routers/instinct.py: add everything above (keep it one router
  file; it is still small enough - if it passes ~400 lines split into
  routers/instinct/ package with the same prefix).
- Add the phone validator (section 2) to the existing
  InstinctContactIn as well.
- No changes to contacts.py / apartments.py / visits.py except reusing
  their helpers. If reuse is awkward, copy the 3-line logic into the
  instinct router with a comment saying where it came from.
- docs/system_api.md: Zvi will paste a phase-2 section himself after merge;
  Claude proposes the doc text as a separate block at the end of its reply.

DONE CRITERIA
- Every curl in this spec returns the stated status and shape against
  https://minicrm-1-phw9.onrender.com after Zvi deploys.
- No name validation anywhere. Phone rule is exactly section 2.
- Nothing writes to the repo except Zvi.

=====================================================================
IMPLEMENTATION STATUS (2026-09-24, working tree only - NOT committed/pushed)
=====================================================================
Verified: tests/test_instinct.py + tests/test_instinct_phase2.py (29 pass,
SQLite) AND every curl above run live against a uvicorn on a copy of the
local Postgres DB (crm_mig_test, TEMPLATE crm_local_dev) - all returned the
stated status + shape. Prod (Render) not verified: needs Zvi's deploy.

[x] 1  search - full-name ILIKE or every word on first/last name; drafts
       first; status=active|draft|all (default all).
[x] 2  phone rule - common.clean_phone, applied to POST /contacts (phase 1),
       POST/PATCH /apartments. Exact 422 message. Phase-1 test phone
       "+1 718 555 0100" now 422s by design (tests switched to 05X numbers).
[x] 3  visits + PATCH followup. visit_history.apartment_id is ON DELETE SET
       NULL (verified on Postgres) and follows the apartment's new version
       on every versioned edit (routers/apartments.py, both update paths).
[x] 4  PATCH contacts/{id}/fields. DEVIATION: definitions use entity_type
       'contact_mekurav' (or 'contact_shliach' for a shliach), NOT
       'contact' - 'contact' does not exist in custom_field_utils and the
       contact form would never render it. Values still store under
       entity_table='contacts'. select-type definitions are parked in notes
       (their values live in picklists).
[x] 5a-5d apartments. 5b: create_building does not geocode, so neither does
       this. Missing floor names get a Floor row so the apartment appears in
       the building grid. 5c: response apartment_id is the NEW version id
       (+ previous_apartment_id). Drafts are excluded by default from
       GET /api/apartments, /api/apartments/list (?status=draft to see them;
       ?apartment_id=X resolves drafts so the detail page works),
       building-aggregates and bulk-update (shared _apply_apartment_filters).
       source/status added to _VERSIONED_COLUMNS - without it any UI edit
       silently approved a draft and reset source to 'crm'.
       Not done (optional per spec): a "Pending approval" apartments UI -
       drafts are approvable only via PATCH status='active' for now.
[x] 6a-6c stats. 6c open_followups = ALL open follow-ups in the org (not
       just that day's), newest first, cap 50. total_pairs: a
       tefillin_count > 0 wins, else a checked 'tefillin' = 1 pair.
[x] 7  notes parking lot - contacts.notes new; appends are timestamped.
[x] 8  migration f1a2b3c4d5e6_instinct_phase2.py, down_revision e6f7a8b9c0d1
       (`alembic heads` confirmed). upgrade/downgrade -1/upgrade on the
       Postgres copy all clean; seed is idempotent (pre-existing key kept).
[x] 9  router split into app/routers/instinct/ package (same prefix;
       main.py unchanged). Only change to apartments.py beyond helper reuse:
       the draft filter + _VERSIONED_COLUMNS + visit re-pointing above.
