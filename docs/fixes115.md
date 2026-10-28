1.Contacts
the new contacts that come in from the api, and are displayed for approval. Need to have a disapprove option! Right now there is only the option to approve 
2. apartment edit endpoints in the CRM
Rules first
•	Work locally only. Do not push. Do not commit. Stop when done and wait for my review.
•	Do not run against the live CRM. Do not call any AI provider. Use the CRM's own test suite and a test database.
•	This task is the CRM backend only. Do not touch the chat service or the popup. They come later.
Big picture
The AI chat will let a user edit any apartment field that they are allowed to edit. The user types an address, the chat finds the apartment and shows which fields can be edited, the user picks a field and gives a new value, and the chat shows what the server saved.
The list of fields is not fixed. Some fields are dynamic (for example campaign fields such as Chanuka). Some fields are hidden or read-only for activists. So the chat must never decide which fields exist. The CRM decides, for each user and each apartment, and sends the list. The CRM also owns the options, the current values, the validation and the saving. The chat only displays what the CRM sends. This task adds those CRM endpoints.
"Any field" means any field the CRM lets this user edit today. It does not mean every database column, and it must never bypass the CRM's visibility or lock rules.
Step 0: check the code before you change anything
The notes below were checked on 25 Oct 2026 against an earlier checkout. The code may have changed. Before coding, open the files named here, confirm what they say, and tell me about any difference. Do not assume. If something does not match the code, show me the difference and propose a fix before you build on it.
Files to read:
•	backend/app/routers/apartments.py (the dashboard update PUT /api/apartments/{id} and the list rules)
•	backend/app/routers/assistant.py (the existing contact flow these endpoints should copy)
•	backend/app/routers/instinct/apartments.py (address matching to reuse; its shared-key login is NOT to be used)
•	backend/app/routers/picklists.py (GET /api/picklists/{field_key})
•	backend/app/models.py (class Apartment), backend/app/deps.py (get_current_user), picklist_utils
•	The code that defines custom (dynamic) apartment fields, the per-campaign hide/show flags, the lock setting in shliach-config, and the role rules. Find out exactly which fields a given user can see and edit in the dashboard today, and where that is decided. Tell me what you find. If there is no single place, tell me before you build.
What the notes say the CRM already does (verify each point)
•	Dashboard update: login token required. User and org come only from the token, never from the request body. A shliach can edit only apartments assigned to them (403 otherwise) and, per the notes, cannot change the apartment number. Every value is checked against the org's picklist before writing (422, nothing written, if invalid).
•	Edits are versioned (_apply_versioned_update): the current row is retired and a new row with a NEW id is inserted. The editor is stamped from the current user. The to_knock field is kept in sync when jewish_status changes. The response is the saved apartment with the new id.
•	Visibility (list): org from the token, only active versions, only status="active" (drafts stay out), and a shliach sees only apartments assigned to them.
•	Some fields are not columns. jewish_status, language, campaign_status and mezuzah_status are org picklists linked to the apartment. jewish_status is single value (field key apartment.Jewish_status, capital J). language is multi value (apartment.language). Read current values with the same helpers _apartment_out uses. Custom (dynamic) fields, such as campaign fields, also exist.
•	Per-campaign hide/show: for the active campaign, each apartment field has a visible flag, and activists see only visible fields. Separately, a "lock" setting in /dashboard/shliach-config makes a field read-only for activists.
•	Lineage: every edit makes a new row. root_id links all versions. The stable identity of an apartment is root_id, or the row's own id when root_id is null. Never treat null as the identity.
•	Full address = building address (buildings table) + apartment number (apartment_name) + floor.
•	Address search to reuse: substring match on building address, apartment number, or resident name. Up to 20 results.
What to build (check first whether any of these already exist)
Everything in this section is a design choice made with me. The field names in the responses are proposals. If the code already has a better shape, tell me and use it. Do not claim a metadata field exists unless you saw it in the code.
All endpoints go under /api/assistant/, in the style of the contact endpoints. Login token only. User and org from the token. Never a shared service key.
1.	GET /api/assistant/apartments/search?q=
a.	Same visibility as the dashboard list. Cap 20.
b.	Each result has: apartment_id (the current version id), lineage_id, building address, apartment number, floor, resident name, and editable_fields.
c.	editable_fields is the list of fields this user can edit on this apartment right now. Each entry has: field_key (the stable key the CRM uses), label (the display text to show), kind (for example single option, multiple options, text, number, yes/no, date, using the kinds the dashboard really supports), current_value (as the CRM shows it; an array for multiple options), and options (only for option fields; an array of value and label pairs, read from the org's current options).
d.	Fields that are hidden for this user or this campaign are left out completely. Fields that are locked (read-only) are not editable, so they are left out too. Internal system fields are never listed: record identity and version fields (ids, root_id, is_display), editor and timestamps, and login fields. Do not leave out a field just because of its name. Decide from the CRM's real rules. For example, to_knock is synced automatically from jewish_status, so it is system-derived; but if the CRM lets a user edit a business status field, list it. The apartment number is listed for any user the dashboard lets edit it (for example an admin), and not for a shliach if the dashboard blocks it. Tell me which fields you left out and why.
e.	Build this list from the same definitions and rules the dashboard uses, not from a copy or a hardcoded list.
2.	POST /api/assistant/apartments/{id}/update with body {field_key, value}
 .	The server works out again, for this user and this apartment, which fields are editable. If field_key is not in that set (hidden, locked, unknown or internal), refuse with 403 and the same message for all of them, so hidden fields are not revealed. Never trust the chat to have filtered the list.
a.	Check the value by kind. For single option the value must be one of the org's current options. For multiple options the value must be an array and every item must be a current option. For other kinds, apply the same validation the dashboard uses. If invalid: 422 naming the field, nothing written.
b.	Write through the same versioned update the dashboard uses (_apply_versioned_update), with the real current user, so the editor is stamped and to_knock stays in sync. Reuse the dashboard's write code for each kind. Do not write columns directly.
c.	Same write rule as the dashboard: 403 if a shliach edits an apartment not assigned to them.
d.	Response: the saved apartment in the same shape as a search result (including a fresh editable_fields), plus the changed field_key and saved value, the NEW apartment_id, the previous id, the lineage id, and an unchanged marker when nothing changed.
e.	Race safety: claim the current version with a conditional write (match on id AND is_display = true), the same way the contact confirm does. If two updates race, the loser gets 404 or 409 and the caller re-reads. Check how the contact confirm does this and copy it.
f.	No-change rule: if the sent value equals the current value, do not create a new version. Return the current state with the unchanged marker. The existing instinct PATCH already treats a no-change update this way, so reuse that behaviour. This covers a repeat of the same update. It is not a race guarantee. The conditional claim handles races.
3.	GET /api/assistant/apartments/by-lineage/{lineage_id}
 .	Returns the current active version of that lineage in the same shape as a search result, with editable_fields for this user.
a.	Same visibility rules as search. Return 404 when the lineage does not exist or the user cannot see it, so nothing is disclosed.
b.	Reason: after a timeout or a 404/409, the chat must re-read by lineage. The capped address search cannot do that job.
4.	Options come inside editable_fields, so the chat needs no separate options route. If the response gets too large for 20 results, tell me before you change the contract.
Tests (CRM test suite, test database)
•	Search returns the right editable_fields for different users: a superadmin or admin, a normal user, and a shliach (activist). Each entry has field_key, label, kind, current_value, and options for option fields.
•	A field hidden for the active campaign is not listed. A locked field is not listed. Internal system fields are not listed. The apartment number is listed for a user the dashboard lets edit it, and not for a shliach if the dashboard blocks it. A business status field the CRM lets the user edit is listed.
•	A dynamic or campaign field (for example Chanuka) is listed when visible and editable, and its current value and options are correct. A newly added org option shows up without any code change.
•	Update with a field_key that is hidden, locked, unknown or internal returns 403 and writes nothing, even when the request is sent directly.
•	Update checks values by kind. A single-option field accepts one current option. A multiple-option field accepts an array of current options and rejects a plain string. Invalid values give 422 naming the field and write nothing.
•	Update makes a new version, stamps the editor, and keeps to_knock in sync when jewish_status changes.
•	A no-change update creates no new version and returns the unchanged marker.
•	The conditional claim rejects a second writer on a retired row (assert the loser's 404 or 409). Do not claim a one-version guarantee under a race unless you built real locking and can show it in the code.
•	A shliach is blocked (403) from editing an unassigned apartment.
•	The response of update has the new and previous ids, the lineage id, the saved value, and a fresh editable_fields.
•	By-lineage returns the current version, and 404 when not visible.
•	Search excludes drafts and apartments outside a shliach's assignment, and caps at 20.
•	Wrong or missing login gives 401. Org always comes from the token.
Out of scope
•	The chat service and the popup.
•	Creating apartments, linking contacts, contact updates, editing draft apartments, building or geocoding work.
•	Any use of the shared-key instinct API.
•	An operation-status or idempotency-key route. The chat will handle timeouts by blocking the edit.
When you finish
Tell me, in short plain English: what you checked and what differed from these notes, how the dashboard decides which fields a user can edit, what files you changed, what tests you ran and their results, and anything you were unsure about. Do not push or commit. Wait for my review.


---

## Step 0 findings (28 October 2026) - STOPPED before building, waiting for your decision

Nothing was built for part 2. The spec says "If there is no single place, tell me before you build", and there is no single place.

### Part 1 (deny for pending contacts)
- [x] Already done before this file arrived: commit 306e8cb, Deny button + `POST /api/contacts/{id}/deny` (deletes the draft; 409 on an active contact). Nothing more to do.

### Notes checked against the code
- [x] Dashboard PUT `/api/apartments/{id}`: token only, shliach 403 when not assigned, shliach cannot change apartment_name (403), picklist values validated (422 before any write), `_apply_versioned_update` (new id, editor stamp, to_knock sync). All match.
- [x] List visibility (org, active version, status="active", shliach scope): matches.
- [x] jewish_status / language / campaign_status / mezuzah_status are picklists; jewish_status single (`apartment.Jewish_status`), language multi (`apartment.language`): matches. Custom apartment picklists are always single value (no multi flag exists).
- [x] Lineage (root_id or own id), full address, instinct search (address / apartment_name / resident, 20): match.
- Small difference: the instinct PATCH no-change case returns the current row with `previous_apartment_id: null`. There is no "unchanged" marker. The idea (no new version) matches.
- Small difference: custom field values on the dashboard PUT are checked by type (number, date) with a 400, not a 422.
- Difference that matters: the dashboard PUT does NOT check the campaign hide flags, the org field settings or the shliach-config locks. All three are enforced only in the browser. The server checks only "shliach not assigned" and "shliach changes apartment_name".

### Where "which fields can this user edit" is decided today
There are three separate rules in three places, and two screens use different combinations of them:

1. **Org field settings** (`field_settings` table, `routers/field_settings.py`, frontend `useFieldSettings`). Admin show/hide per field for the whole org.
2. **Active campaign hide flags** (`campaign_field_visibility`, `routers/campaigns.py` GET /active `hidden_field_keys`, frontend `useActiveCampaignFieldVisibility`). The field catalog is `app/apartment_fields.py` (fixed fields + custom picklists + custom fields, to_knock always excluded).
3. **Activist locks** (`Organization.shliach_view_config`: `disable_edit`, `apartment_edit_locked_fields`), shliach role only. The lock list uses its OWN key names, not the field keys: `resident`, `phone`, `email`, `notes`, `language`, `jewish_status`, `campaign_status`, `mezuzah_status`, `report_number`, `building`, `area`. Custom picklists use their field_key and custom fields use `customfield.apartment.<key>`.

How each screen combines them:

| | Apartment card `/dashboard/apartments/[id]` (admin, staff, campaign manager, shliach) | Street2 `/dashboard/street2` (activist field screen) |
|---|---|---|
| Which fields show | org field settings (1) | active campaign flags (2) only; org settings ignored |
| Locks | shliach: `disable_edit` only; per-field locks ignored | shliach: `disable_edit` + per-field locks (3) |
| apartment_name | shown; shliach read-only | not shown |
| floor, building move | editable (floor from the building's floor list) | not shown |
| report_number | editable (pick from the org's report numbers) | shown, always read-only |
| name / phone / email / notes / status picklists / language / custom picklists / custom fields | editable | editable unless hidden or locked |

So the same shliach can edit a locked field on the apartment card but not on street2, and a field a campaign hides is still on the apartment card.

### Proposal (needs your OK before I build)
One server-side function, `editable_fields(db, user, apartment)` in a new `app/apartment_edit_rules.py`, used by search, by-lineage and update, built from the existing catalog (`apartment_fields.list_apartment_field_keys`) and the existing settings tables. No hardcoded field list beyond the catalog itself.

- **Shliach** follows street2: field is listed only if the active campaign does not hide it, `disable_edit` is off, and it is not in `apartment_edit_locked_fields` (lock keys translated to field keys). apartment_name, floor, building and report_number are never listed.
- **Admin / staff / campaign manager** follow the apartment card: field is listed unless org field settings hide it. apartment_name and report_number are listed; floor is listed as an option field (the building's floors).
- **Never listed for anyone:** ids, root_id, is_display, guid, editor/timestamps, campaign_id, source/status (draft approval), to_knock (synced from jewish_status), building_id (moving buildings is building work, out of scope).
- **Kinds:** `single_option` (status picklists, custom picklists, floor, report_number), `multi_option` (language), `text` (name, phone, email, notes, apartment_name; phone/email use the dashboard's validators), and for custom fields `text` / `number` / `date` / `yes_no`, validated by `custom_field_utils` (returned as 422 here).

Questions for you:
1. Is "copy each screen's rule per role" right? The other choice is one stricter rule for everyone (org settings AND campaign flags AND locks).
2. Should a shliach also respect the org field settings (street2 ignores them today)?
3. The fixes114 endpoints (uncommitted) already exist with a different contract (`field` not `field_key`, a separate `/fields` route, 422 for unknown fields). I plan to replace them in place with this contract. The uncommitted fixes114 chat code in crm-assitant will then no longer match the CRM until the chat is updated in a later task. Is that OK, or should I keep the old `/fields` + `field` shape working alongside until then?
4. Should I also make the dashboard PUT enforce the same rule? It is out of this file's scope, so I left it alone.

---

## Your answers (29 October 2026)
1. Two main users. Admin edits everything except hidden fields. Activist sees only what the admin marked visible (seasonal fields).
2. Activists respect org settings too, and street2 must be fixed: org settings are for the whole org.
3. Replace the fixes114 endpoints with the new contract.
4. Asked what it meant. Explained: today the hide/lock settings are enforced only by the screens; the server's normal dashboard save still accepts a hidden or locked field if the request is sent directly. The question is whether the dashboard save should refuse them too. Still open; not done.

## Closeout (29 October 2026) - built locally, NOT committed, NOT pushed, waiting for review

Nothing ran against the live CRM and no AI provider was called.

### The rule (`backend/app/apartment_edit_rules.py`, one place, used by every endpoint)
- Candidates: the apartment field catalog the campaign visibility screen already uses (`apartment_fields.list_apartment_field_keys`: fixed fields + the org's custom picklists + its custom fields; to_knock never). No other field list.
- Hidden in the org field settings: not listed for anyone (admin included).
- Activist (shliach) also loses: fields the active campaign hides, everything when "disable editing" is on, and each locked field. The lock list's own names are translated (`resident` -> resident name, `notes` -> notes, and so on).
- Activist never gets: apartment number (the dashboard save refuses it), floor and report number (street2 never offers them).
- Staff and campaign manager follow the admin rules. You named only admin and activist, so tell me if they should be stricter.
- Never listed for anyone: ids, root_id, is_display, guid, editor and timestamps, campaign_id, source/status (draft approval), to_knock (set automatically from Jewish status), building_id (moving buildings is building work, out of scope).
- An option field with no active options is not listed (nothing to pick).

### Endpoints (`backend/app/routers/assistant_apartments.py`, fixes114 contract replaced)
- [x] `GET /api/assistant/apartments/search?q=`: dashboard visibility, cap 20 + `truncated`. Each result: apartment_id, lineage_id, building_address, apartment_name, floor, resident_name, editable_fields.
- [x] editable_fields entries: field_key, label (Hebrew), label_en, kind, current_value (array for multi), options (option fields only: value, label, label_en). Kinds: `single_option`, `multi_option`, `text`, `number`, `date`, `yes_no`. Floor options are the building's floors; report number options are the org's report numbers (value = id).
- [x] `POST /api/assistant/apartments/{id}/update` `{field_key, value}`: recomputes the set for this user and apartment. Hidden, locked, unknown or internal = 403 "This field cannot be edited here" (same message for all). Shliach on an unassigned apartment = 403, as on the dashboard. Values checked by kind (422 `{status: invalid, invalid_fields: [{field, code[, value]}]}`; codes expected_option, expected_list, value_not_allowed, expected_text, expected_number, expected_date, expected_yes_no, invalid_format). Phone and email use the dashboard's validators. Written through `_apply_versioned_update` (editor stamp, to_knock sync). Response: status (`updated` / `unchanged`), field_key, value (read back), apartment_id (new), previous_apartment_id, lineage_id, apartment (with fresh editable_fields).
- [x] Conditional claim (`UPDATE ... WHERE id AND is_display`) before the write; loser = 409. A retired id sent directly = 409. Same value again = `unchanged`, no new version.
- [x] `GET /api/assistant/apartments/by-lineage/{lineage_id}`: same shape and visibility; 404 for missing and not-visible alike.
- [x] `/fields` route removed (options now come inside editable_fields).
- Error texts: added "This field cannot be edited here" (Hebrew: "לא ניתן לערוך את השדה הזה כאן"), removed the fixes114 "activists cannot edit this field" text (no longer used).
- Size: options repeat on each of up to 20 results. With the real org (8 + 6 options plus a few custom fields) that is small. I didn't change the contract.

### street2 fix (answer 2)
- [x] `frontend/app/dashboard/street2/page.tsx`: a field shows only if the org field settings AND the active campaign both show it (was campaign only).
- [x] Same one-line fix in `frontend/app/dashboard/route/page.tsx` ("Jewish points BETA"), which is a copy of street2 with the same rule. The old `/dashboard/street` page is untouched (it never used the campaign flags).
- Not done: not seen in a browser. `tsc --noEmit` shows no new errors; the only errors are the 3 already there (`canvas-confetti`, `qrcode` missing in the container's node_modules).

### Evidence
- `backend/tests/test_fixes115.py`: 30 tests passed (SQLite). They cover:
  - fields per user (admin, staff, activist), labels, kinds, values and options
  - campaign-hidden fields (activist only), org-hidden fields (everyone), locks with the shliach-config keys, and disable_edit
  - a seasonal picklist (Chanuka): its current value, plus a newly added option showing up with no code change
  - every kind written through the dashboard path; report number picked by id
  - unchanged; 403 for hidden, locked, unknown and internal fields; 422 for each kind
  - 409 plus the lineage read; the simulated claim race; activist on an unassigned apartment
  - identity in the body; search, drafts, other org and the 20 cap; 401 with no token and with a bad token
- `tests/test_fixes114.py` was deleted (it tested the old contract; its cases moved into test_fixes115.py).
- `tests/test_fixes114_postgres.py` (updated to the new body): 1 passed on the throwaway Postgres DB `crm_fixes114_test`. 6 concurrent edits gave exactly one 200 and five 409s, with one active row.
- Mutation checks:
  - With the campaign hide flags removed, 2 tests fail.
  - With the 403 removed (trusting any field_key), 1 test fails.
  - Code restored both times.
- Full backend suite (excluding test_models.py): **853 passed, 7 skipped**.

### Unsure / for you
- The chat side (crm-assitant) still uses the fixes114 contract (`field`, `/fields`), so it will not work against this CRM until the chat is updated. That's a later task, as you said.
- Staff and campaign manager get the admin rules.
- Single-option fields cannot be cleared (the value must be one of the options); text, number, date and yes/no can be cleared by sending null.
- Answer 4 is still open.
