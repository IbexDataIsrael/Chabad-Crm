Apartments in the chat helper - CRM API contract and assistant flow
Do not commit or push. Stop for review after each step.
The big picture
The CRM has a chat helper (a web chat today, WhatsApp later). Through it, a logged-in user finds an apartment and edits its apartment fields in plain conversation. The helper never touches the CRM database and never decides permissions: it calls CRM endpoints with the user's login token, and the CRM owns searching, permission checks, validation and saving. In the new flow the helper finds apartments through the combined search (GET /api/assistant/search, specified in the MiniCRM API brief), then opens and re-reads the apartment with endpoint 1 below and updates it with endpoint 2. This document is the complete apartment contract and the complete assistant flow in one place: the reference the helper is built against, and the standard the endpoints are kept at.
Prerequisites
The assistant endpoints live on the CRM's main branch only. Other branches, including the redesign test branch, may not have them. The endpoints must exist with this exact contract, verified by tests, on the branch the helper talks to, before the helper's flow is built or run against that branch.
Nothing in this document authorizes a push, a merge or a deploy. The owner pushes after review.
Test and production stay isolated: a test setup uses a test CRM address and test data, never the production database or production logins.
Rules for everything in this document
JWT only. The user and the organization come from the token, never from the request body.
The CRM decides what this user may see and edit, on every call. The helper never keeps a field list of its own.
A record the user may not see returns a 404, exactly like a record that does not exist. No existence leaks.
Language: every field and every option comes back with one label, already in the user's current CRM interface language. The helper shows what the CRM sent and never invents names. The assistant cannot change the interface language.
No delete. There is no delete endpoint and no delete action, ever.
One field per update call. Nothing is saved without the user seeing the exact change and confirming it.
(Claude - this system is seasonal and the apartment updates are usually around Jewish status / or doing a Jewish mitzvah - if something here doesnt make sense to you point it out)
*****Claude - this system is seasonal and the apartment updates are usually around Jewish status / or doing a Jewish mitzvah - if something here doesn't make sense to you, point it out!!

The apartment object
Note that the list of fields here is only an example. The system will return whatever fields there are available for activist.
Even if the user is admin, still restrict the data returned to the fields that activist is allowed to edit. 
Every apartment answer - in the combined search results and in both endpoints below - uses this exact object shape (the field keys are real, the values are only an example):
{
  "apartment_id": 57797,
  "lineage_id": 35852,
  "building_address": "Appelfield Blvd 12",
  "apartment_name": "2C",
  "floor": "2",
  "resident_name": "Yosef Cohen",
  "editable_fields": [
    {
      "field_key": "apartment.Jewish_status",
      "label": "מעמד יהודי",
      "kind": "single_option",
      "current_value": "Jewish",
      "options": [
        {"value": "Jewish", "label": "יהודי"}
      ]
    }
  ]
}
apartment_id identifies this version of the record. It changes on every save - see Identity and versions.
lineage_id never changes. It is the stable handle for opening and re-reading the record.
editable_fields lists exactly the fields this user may edit on this apartment right now, each with its current value and, for option fields, the current options. Fields the user may not edit are simply not in the list.
Endpoint 1: open and re-read - GET /api/assistant/apartments/getapartment?id={lineage_id}
Returns the current version of the apartment, in the apartment object shape above. The id is the apartment's lineage_id - the stable id that never changes - not apartment_id, which changes on every save. Use it to open the apartment the user picked from the combined search, and whenever the held version may be stale: after a timeout, a 404 or a 409. Answers 404 both when the apartment no longer exists and when the user may not see it - the two cases look the same on purpose. (This read already exists on main as GET /api/assistant/apartments/by-lineage/{lineage_id}.)
Endpoint 2: update one field - POST /api/assistant/apartments/{apartment_id}/update
Body: {"field_key": "...", "value": ...}. One field per call. The server, in order:
404 when the apartment is not in the user's organization or is not active.
409 ("changed meanwhile - load it again") when the sent apartment_id is no longer the current version. The helper re-reads with getapartment?id=<lineage_id> and asks again; it never resends by itself.
403 when an activist tries an apartment not assigned to them.
403 when the field is not in this user's editable set for this apartment. Unknown, hidden and locked fields all get the same 403, so a hidden field is never revealed.
422 when the value does not fit the field kind, with a plain reason per field (see the kinds and value rules).
Sending the current value again writes nothing and answers status "unchanged".
Otherwise the server writes a new version and answers with the saved state read back from the database - the answer is the server's state, never the request.
Answer shape:
{
  "status": "updated" | "unchanged",
  "field_key": "...",
  "value": <the value read back from the saved record>,
  "apartment_id": <the NEW id>,
  "previous_apartment_id": <the id that was sent>,
  "lineage_id": <unchanged>,
  "apartment": <the full apartment object of the new version, with fresh editable_fields>
}
Two concurrent edits: only one wins; the other gets 409 and re-resolves with getapartment?id=<lineage_id>.
Which fields are editable - decided on the server
The helper never hardcodes a field list. The server builds editable_fields from the CRM's own settings:
Apartment fields only, and never a fixed list: the only fields editable through the helper are the apartment fields as the CRM has them configured right now - the fixed lists (Jewish status, campaign status, mezuzah status, languages), the organization's own apartment lists (custom picklists, e.g. a seasonal Chanuka list) and the organization's yes/no apartment fields (e.g. "lit a menorah"). The organization adds, removes and renames them over time, and the helper always works from the current catalog; neither the bot nor this contract hardcodes field names. Everything else is never editable through the helper, for every role, enforced on the server with the same 403 as any other not-allowed field: the apartment number and the building address, the floor, the report number, the resident name, phone, email, notes, to_knock, and the organization's text, number and date custom fields.
A field hidden by the organization's field settings is hidden for everyone.
Every role (admin included - owner decision 1) additionally loses: the apartment fields the active campaign hides, every field when editing is disabled in the activist settings, and each field in the activist lock list.
Every other role follows the organization settings only.
An option field with no active options is left out of editable_fields entirely.
The apartment field kinds and their value rules
A wrong value is a 422 with a plain reason naming the field. Only the apartment field kinds below are editable through the helper; every other kind (text, number, date) exists in the CRM catalog but is never editable through the helper.
single_option (each list field, fixed or organization-defined): exactly one of the listed option values. Cannot be cleared.
yes_no (the organization's yes/no apartment fields, e.g. a seasonal mitzva): true or false. Cannot be cleared. No options in the object.
multi_option (list fields such as languages): a list of the listed option values. An empty list clears it.
Identity and versions
Every save writes a new version of the apartment with a new id. apartment_id changes on every edit; lineage_id never changes.
The helper always keeps lineage_id. After a save it switches to the new apartment_id from the answer.
Updates and the direct link must use the newest apartment_id; opening and re-reading use the lineage id with getapartment?id=.
The assistant conversation, step by step
How the conversation starts: the apartment path begins from the user's own text, not from a fixed question. Whatever the user already typed - an address, an apartment number, a resident's name, or a short request like "change 2C to English" - goes straight to the combined search (GET /api/assistant/search), which returns people and apartments together; the apartment path works with its apartment results. The bot asks "Which apartment?" only when there is no text to search yet.
The text goes to the combined search. No apartment match: "I found no apartment for ... that you can see. Try another address." - the user can simply type more text.
Several apartment matches: a numbered list, each line "address, apartment X, floor Y - resident". When the apartments list is truncated, add "only the first 20 are shown - type a more exact address". The user answers with a number OR with more identifying text (a street, a resident) - more text goes through the combined search again and narrows the list. An answer that fits neither gets a plain ask-again, never a restart. When the user picks an apartment, the bot opens it with GET /api/assistant/apartments/getapartment?id=<its lineage_id> and works from that fresh answer.
Short request forms (phase 1): when the text already names the change ("change 2C to English"), the bot keeps it. After the apartment is resolved, it looks for the field and the value inside that apartment's editable_fields, matching the CRM's labels and options only, never inventing. When field and value both match, it goes straight to the confirm screen. When either does not match, it falls back to the numbered field list and says why. Any other unrecognized text is treated as a plain search. (Labelled design choice to confirm: phase 1 understands these short forms; wider sentence understanding can come later.)
Apartment chosen, no change named: "Which field do you want to change?" as a numbered list built from that apartment's editable_fields, in the user's language. An empty list: "Nothing in this apartment can be edited by you here. Nothing was changed."
The user picks a field. yes_no - a numbered yes / no choice, current value shown; single_option - a numbered list of the options, current value shown; multi_option - a numbered list, the user answers one or more numbers separated by commas.
Confirm screen, always: "Change <field> of apartment #<id>: from: <old> to: <new>. Reply yes to save, no to keep." Only an explicit yes sends the update. A no: "Not changed - <field> stays <old>."
After the CRM answers, show only what the CRM returned: "Saved. The CRM now shows <field>: <value>." or "Nothing changed - the CRM already had ...". "Saved" here is the CRM's own confirmed answer to a request whose response arrived whole - the lost-answer rule below covers the case where it did not. Then offer another field, or back to start.
Clearing a field happens only through a dedicated "Clear the value" action that sends the clear signal. A typed "none" is an ordinary value, and a single_option can never be cleared.
The conversation is stateless on the server: the page holds the state (the step, the candidates, the chosen ids, the pending change) and sends it with every turn. Every turn after the apartment is chosen re-reads it with getapartment?id=<its lineage_id>. If the apartment or the field list differs from what the user was shown, the user is shown the current state and asked again - a number typed for an old list is never applied.
Error and safety rules for the assistant
One update per explicit yes. While a turn is in flight the input is disabled. Nothing is ever resent automatically.
401: the login is no longer valid - ask the user to log in again. Nothing was changed.
403: one fixed message ("The CRM did not allow this request. Nothing was changed."), then reload the apartment.
404 or 409: re-read with getapartment?id=<lineage_id>, show the current state, ask again. Never resend.
422: show the CRM's plain reason per field. Nothing was saved.
A lost answer (timeout, dropped connection, CRM 5xx, an unreadable response): the change is BLOCKED. Nothing is resent, ever. On the user's next "yes" the assistant re-reads with getapartment?id=<lineage_id> and reports what the CRM currently shows. A matching value does not prove our change was saved - someone else may have made the same edit - so the assistant says plainly: "The CRM currently shows <field>: <value>; whether your earlier change was saved is unconfirmed." It may call the change saved only when the CRM proves our write (for example a request audit or an idempotency record for the exact request). Otherwise it never says the change was saved.
The assistant never writes field names, labels or option lists of its own - they all come from the CRM's answers, in any language.
Direct link to the apartment page
An opened apartment also shows a direct link to its full CRM page: /dashboard/apartments/{id} on the CRM web address (a separate environment value, for example CRM_WEB_URL - not CRM_API_URL). After every save, build the link with the NEW apartment_id from the update answer.
Language
The bot's own messages follow the user's current CRM interface language (the stored locale preference). Field labels and option labels arrive from the CRM already in that language; free-text values are shown exactly as the CRM sent them. The assistant has no language switching of its own.
Tests
Same standard as the existing assistant endpoint tests:
The permission matrix: admin, staff, campaign manager, activist with and without assigned apartments.
The no-existence-leak rule: a hidden record and a missing record answer the same 404.
Every field kind: a right value, a wrong value, and clearing where allowed.
unchanged on a same-value send; the read-back matches the database after a real change.
Two concurrent updates: one wins, one gets 409.
Other fields (apartment number, floor, report number, resident name, phone, email, notes, to_knock, text / number / date custom fields) refused for every role with the same 403 as any other not-allowed field.
Labels arrive in the requesting user's current CRM interface language.

---
## Owner decisions (2026-10-30) — binding for the build

1. **Admins edit apartments exactly like an activist.** Admin, staff and campaign manager get the activist's field set: org field settings + the active campaign's hidden fields + the activist lock list; when editing is disabled in the activist settings, nobody edits through the helper. The line "Every other role follows the organization settings only" is void. Non-status edits (apartment number etc.) are never done through the helper. Contacts are a separate, admin/staff-only entity (fixes117).
2. **Mitzvot**: the person's mitzvot are recorded as visits on the contact (fixes117 addition). Apartments carry seasonal mitzvot as org-defined apartment fields (e.g. a Chanuka menorah list or a yes/no "lit a menorah") — covered here as apartment fields.
3. **Language**: one label per field and option, in the user's stored `locale` preference; no stored locale → **Hebrew**. When an English label is missing, the Hebrew label is shown (never a raw technical value).
4. **One label everywhere** in the helper: `label` only, no `label_en` — apartments, the combined search (fixes117, including the people draft label), and the contact endpoints.
5. **404, not 403**, when an activist reaches an apartment not assigned to them — and when an activist sends an old version of an apartment they cannot see. Hidden looks exactly like missing.
6. **Proof of write (idempotency key)** — agreed, written here:
   - Every write call (apartment update, contact update, new visit) accepts an optional `request_id` (a UUID the helper generates once per confirmed "yes").
   - The CRM records `request_id` together with the user, organization, the target and the exact request, in the same database transaction as the write. A write that did not commit leaves no record.
   - The same `request_id` sent again by the same user with the same request returns the original answer with `"replayed": true` and writes nothing. That replay is the CRM's proof that our write was saved — the only case where the helper may say "saved" after a lost answer.
   - The same `request_id` with a different request → 422 (`request_id_reused`), nothing written. A `request_id` of another user or organization is never matched.
   - Without `request_id` the call behaves as today; the lost-answer rule above (blocked, re-read, "unconfirmed") still applies.
   - Note: this relaxes "nothing is resent, ever" for one case only — re-sending the SAME request_id to ask "did my write happen?" is safe because it can never write twice.
7. **Route**: `GET /api/assistant/apartments/getapartment?id={lineage_id}` is the helper's route. `GET /api/assistant/apartments/by-lineage/{lineage_id}` stays as an alias. Both take the stable lineage id.
8. **Helper wording + link**: the confirm screen says "address, apartment <apartment_name>" (never the internal id). The CRM adds a direct apartment link by the stable lineage id that always opens the current version, so links sent earlier keep working.

Decided later the same day: (a) yes/no apartment fields ARE apartment fields, editable (not `to_knock`); the term "status field" is retired — it is "apartment field" everywhere. (b) superadmin on the existing assistant routes — built as refused (403), per "strictly by organization". (c) editable contact fields: all core fields + org contact picklists + contact custom fields, minus hidden (fixes117).

---
## Status (2026-10-30) — Step 1 (CRM apartment endpoints) DONE locally, NOT committed

- [x] Apartment fields only, every role edits like an activist — `backend/app/apartment_edit_rules.py` rewritten: fixed lists + org apartment picklists + org yes/no apartment fields; org hidden + campaign hidden + activist locks for every role; `disable_edit` → empty list for everyone. Other keys (number, floor, report number, resident, phone, email, notes, to_knock, text/number/date custom fields) are the same 403.
- [x] One label in the user's language — new `backend/app/core/user_locale.py` (`locale` preference; none → he; missing English → Hebrew). Applies to apartment fields/options and to the fixes117 combined search (people `status_label`; `status_label_en` removed).
- [x] 404 for an activist's unassigned apartment, also for a retired version of an apartment they cannot see (visibility is checked on the lineage before the 409).
- [x] `GET /api/assistant/apartments/getapartment?id={lineage_id}`; `by-lineage/{id}` kept as alias.
- [x] `request_id` — new table `assistant_requests` (model `AssistantRequest`, migration `118a1b2c3d4e`), written in the same transaction as the write (`_apply_versioned_update(commit=False)`); replay → `replayed: true`; different request → 422 `request_id_reused`; scoped to the user; "unchanged" is recorded too; a failed write leaves no record. Rows are removed on user delete; org delete cascades by FK.
- [x] Superadmin refused (403) on all assistant routes: `require_org_user` in `app/deps.py`, used by search, apartments and the fixes113 proposals.
- [x] Tests: `test_fixes115.py` rewritten to the fixes118 contract (status-only, every role, labels per locale, 404 rules, alias, replay/reuse/scope), `test_fixes117.py` updated. 94 passed (fixes113/115/116/117 + error localization), SQLite.
- [x] Yes/no apartment fields (owner, 2026-10-30): kind `yes_no`, true/false only (never cleared), written through the dashboard's versioned path; hidden/campaign/lock rules apply. Tests added.
- [x] Alembic `118a1b2c3d4e` applied to local Postgres `crm_local_dev` (run from the host with a `localhost` URL — the container could not reach `host.docker.internal` at the time). `test_fixes114_postgres.py` + `test_fixes113_postgres.py`: 6 passed on `crm_fixes113_test`. SQLite: `test_fixes115.py` + `test_fixes117.py` 44 passed.
- [ ] NOT DONE: the CRM web link by lineage id (decision 8) — needs a frontend route; next step.
- Response field added: `replayed` (false on a normal answer).

---
## Status (2026-11-02) — decision 8 (link by lineage) DONE locally, NOT committed
- [x] Every apartment object carries `web_path` = `/dashboard/apartments/lineage/{lineage_id}` (search, combined search, getapartment, update answer).
- [x] Backend `GET /api/apartments/lineage/{lineage_id}` → `{id}` of the current version (caller's org; 404 otherwise).
- [x] Frontend `frontend/app/dashboard/apartments/lineage/[lineageId]/page.tsx` → resolves and `router.replace`s to `/dashboard/apartments/{id}`; not found → `apt.lineage_not_found` (seed.py LOCALIZATION row added).
- [x] Tested: `test_apartment_link_follows_the_lineage` (link stays, resolves to the NEW id after an edit, other org 404); live on local Postgres: lineage 29 → current id 67. `tsc --noEmit` clean.
- [ ] Not live-driven in a browser: the frontend stack was not running this session — the page itself is only type-checked.
- The confirm wording "address, apartment <apartment_name>" (decision 8) is helper-side (`crm-assitant`), not built here.
