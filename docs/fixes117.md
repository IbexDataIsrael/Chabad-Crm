Do not commit or push. Stop for review after each step.
The big picture
The CRM has a separate chat helper (a web chat today, WhatsApp later). The helper never touches the CRM database. It calls CRM API endpoints with the user's login token, and the CRM owns searching, permission checks, validation and saving. Some endpoints for this already exist on main. This task adds the missing ones: one combined free-text search, and contact read/edit for the helper.
Prerequisites
The existing assistant endpoints live on the CRM's main branch only. Other branches, including the redesign test branch, do not have them. Before the helper relies on any endpoint in this document, the endpoint must exist with this exact contract on the branch the helper will talk to, verified by its tests.
Nothing in this document authorizes a push, a merge or a deploy. The owner pushes after review.
Test and production stay isolated: a test setup uses a test CRM address and test data, never the production database or production logins.
Rules for everything in this task
JWT only. The user and the organization come from the token, never from the request body - same as the existing assistant routers.
The helper's permission rule: activists never get contact results or contact details, and a campaign manager never gets contacts - only roles that may see contacts get them, always inside the user's own organization. Note for review: the main search in the CRM today is more permissive for activists (coverage-scoped contacts under the organization's mekurav opt-in). That is an existing discrepancy between the product rule and the current code, flagged for the owner's review - this document changes no existing permissions.
A record the user may not see answers 404, exactly like a record that does not exist. No existence leaks.
Bilingual labels: every field the helper can show or edit comes back with label and label_en, like the apartment endpoints do today.
No delete. There is no delete endpoint for the helper, ever.
Already on main - do not rebuild
GET /api/search - the main global search (contacts, apartments, buildings and more), with the permission rules above.
GET /api/assistant/apartments/search?q= - apartment search for the helper. Returns up to 20 apartments, each with editable_fields: [{field_key, label, label_en, kind, current_value, options?}], plus a truncated flag.
GET /api/assistant/apartments/by-lineage/{lineage_id} - re-reads the current version of an apartment (an apartment's id changes on every save; its lineage id never does).
POST /api/assistant/apartments/{apartment_id}/update with {field_key, value} - updates one apartment field. The server recomputes the editable set before writing. Answers {status: updated | unchanged, the value read back, apartment_id (the new one), previous_apartment_id, lineage_id}.
POST /api/assistant/proposals and POST /api/assistant/proposals/{proposal_id}/confirm - creates a contact as a draft. Validation first (needs_information / invalid), nothing is saved until confirm. The role rules are enforced server-side: an activist may add mekurav contacts only, a campaign manager may not add people. Phone must be unique in the organization; the server locates the address on the map.
New endpoint 1: GET /api/assistant/search?q=
One search for the helper over people and apartments together.
Minimum 2 characters; shorter input is a 400.
The same matching as GET /api/search, but only contacts and apartments - no buildings, areas, streets or users. Permissions follow the helper's rule above: activists and campaign managers get apartment results only. (Design choice: the helper's results are people and apartments only.)
Up to 20 results per group.
Every result carries its id, so the helper can open the record when the user picks it.
Apartment results use the exact same object shape as GET /api/assistant/apartments/search, including editable_fields, so the helper does not need a second call.
Answer shape:
{
  "people": [{"id", "name", "last_name", "phone", "address"}],
  "apartments": [same objects as the apartment search, with editable_fields],
  "people_truncated": true | false,
  "apartments_truncated": true | false,
  "can_add_person": true | false
}
can_add_person is computed on the server from the existing create-contact permission rules - the same rules the proposals endpoint already enforces. It only reports today's CRM permission; it does not decide product behavior. Until the owner decides whether activists may add people through the helper, the helper holds the offer for activists even when this flag is true (an activist never sees contacts, so a missing name proves nothing to them).
New endpoint 2: GET /api/assistant/contacts/{contact_id}
Returns the contact's details for the chat: the core fields (name, last name, phone, email, address, pipeline status, color tag, priority) plus the organization's picklists and custom fields.
Also returns editable_fields for this user on this contact - the same idea and shape as apartments: [{field_key, label, label_en, kind, current_value, options?}]. Which fields are editable is decided on the server, per role and organization settings, never by the helper. Fields the user may not edit are simply not in the list. (Open choice for the owner: the exact editable field list per role.)
New endpoint 3: POST /api/assistant/contacts/{contact_id}/update
Body {field_key, value} - one field per call, like the apartment update.
The server recomputes the editable set and revalidates before writing. An unknown, hidden or not-allowed field is the same 403 for every reason, so hidden fields are not revealed. A bad value is a 422 with a plain reason per field. A phone number that already belongs to another contact in the organization is refused with a plain message.
Answer: {status: updated | unchanged, field_key, value (read back from the saved contact), contact: the saved contact}. Sending the current value again changes nothing and answers unchanged.
If the contact save path ever writes a new record version, return the new id and a stable key the helper can re-read by - the same pattern as apartments (apartment_id / previous_apartment_id / lineage_id). If contacts keep a stable id on save, note that in the code and this contract stands as-is.
Tests
Same standard as the existing assistant endpoint tests: the permission matrix (admin, staff, campaign manager, activist with and without coverage), validation failures, the no-existence-leak rule, read-back after save, and bilingual labels.

remember that the data given by api is only data that user is allowed to view!
---
## Status (2026-10-30) — Step 1 (endpoint 1) DONE locally, NOT committed. Steps 2–3 not started (stopped for review).

### Endpoint 1 — `GET /api/assistant/search?q=`
- [x] New router `backend/app/routers/assistant_search.py`, registered in `main.py`.
- [x] `q` shorter than 2 characters (after trim, including missing) → 400 "Search needs at least 2 characters" (Hebrew added to `PLAIN_ERRORS`).
- [x] People: same matching as `GET /api/search` (name / last name / phone / email, case-insensitive contains). Only admin and staff get people, org-wide. Shape `{id, name, last_name, phone, address}`.
- [x] Apartments: reuses the apartment search's visibility (`_visible_query`: active versions only, no Instinct drafts, activist sees only assigned) and object builder (`_views`), so the objects are identical to `GET /api/assistant/apartments/search`, `editable_fields` included (a test compares the two answers for equality).
- [x] Up to 20 per group, `people_truncated` / `apartments_truncated`.
- [x] `can_add_person` = `role != "campaign_manager"` — the exact rule `POST /api/assistant/proposals` enforces (`forbid_campaign_manager`). True for activists, as the spec anticipates.
- [x] Tests `backend/tests/test_fixes117.py` (11): shape; people matching; apartments identical to the apartment search + bilingual labels; admin / staff / campaign manager / activist with coverage / activist without coverage; org isolation from the token; caps + truncated flags; 400 short query; 401; LIKE wildcards literal.

### Owner decisions (2026-10-30)
1. **Apartment matching includes the building address** — "the first thing about an apartment is its address". Matches address, number, notes, resident name, phone.
2. **Drafts are included and labelled.** Each person carries `status` ("active" | "draft") and `status_label` / `status_label_en` (from the contacts page's `contacts.draft_badge` localization row: טיוטה / Draft; null for an active contact). People shape is now `{id, name, last_name, phone, address, status, status_label, status_label_en}`.
3. **Every user gets data by their own permission** — activists get no people, even with the mekurav opt-in or contacts assigned to them. `GET /api/search` unchanged.
4. **No superadmin — strictly per organization.** A superadmin token gets 403 "Not available for the platform superadmin" (`org_user` dependency in `assistant_search.py`; Hebrew in `PLAIN_ERRORS`). Will be used by the contact endpoints too.
   - Not changed (flag): the existing `/api/assistant/apartments/*` and `/api/assistant/proposals*` routes still accept a superadmin token. Apply `org_user` there too?

Tests: 13 in `test_fixes117.py` (added: draft label, superadmin 403).

---
## Addition (2026-10-30, owner): contact → edit OR record a new visit (mitzvot)

Why: mitzvot done with a person (tefillin, candles, tzedaka, letter in the Torah, Torah thought, the org's own checklist items…) are recorded on **visits** (`visit_history` + entity_type="visit" custom fields / picklists, fixes25/fixes39), not on the contact. A contact flow that can only edit contact fields misses the main seasonal action.

Flow: the user types a name → `GET /api/assistant/search` → picks a person → `GET /api/assistant/contacts/{id}` returns all of the contact's data → the helper offers **edit a field** (endpoint 3) **or record a new visit** (endpoint 4). Admin and staff only, like every contact endpoint here (activists and campaign managers never reach contacts through the helper). No superadmin.

### Endpoint 2 (extended): `GET /api/assistant/contacts/{contact_id}`
On top of the contact details and `editable_fields` already specified, also returns:
- `recent_visits`: the last 5 visits, newest first — `{visit_id, visit_date, visit_type (label), done: [labels of the mitzvot checked / options picked], notes}`.
- `new_visit_fields`: the fields a new visit can take, built on the server from the org's current visit catalog (never a fixed list): `[{field_key, label, kind, options?, default?}]`. Covers visit date (default today), visit type, Torah thought, the org's visit yes/no fields (the mitzvot), visit select fields, visit text fields (e.g. connection to the Rebbe) and notes. Fields hidden by the org's field settings are left out; an option field with no active options is left out. Not included: the `interactions` log, location, follow-up task, apartment link (open — see questions).

### New endpoint 4: `POST /api/assistant/contacts/{contact_id}/visits`
Creates one visit for the contact. Body:
```
{"request_id": "<uuid from the helper>", "values": {"<field_key>": <value>, ...}}
```
- The whole visit in one call, after one confirm screen listing every value ("Record a visit for <name>: date …, tefillin ✓, candles ✓. Reply yes to save").
- Server recomputes `new_visit_fields` and validates: an unknown / hidden field is 403 (same for every reason); a bad value is 422 with a plain reason per field; visit date required (defaults to today when omitted).
- **Idempotent by `request_id`** (stored in the existing unique `visit_history.client_uuid`): a repeat of the same request_id returns the visit already created (`replayed: true`) and creates nothing. This solves the lost-answer case for creates — after a timeout the helper may resend the SAME request_id and get a proven answer. A request_id reused with different values → 409.
- Writes through the dashboard's own visit path (`routers/visits.py _apply_payload`), so the visit looks exactly like one made on the contact page.
- Answer: `{status: "created", replayed, visit_id, visit: <read back from the DB, same shape as recent_visits>, contact_id}`.
- No edit and no delete of existing visits through the helper (open — see questions).

### Tests (added to the fixes117 list)
Permission matrix (admin/staff yes; activist, campaign manager, superadmin no — 404 for activist/CM on contacts, 403 superadmin); another org's contact = 404; every visit field kind right/wrong; hidden field 403; replay by request_id creates one visit; same request_id + other values = 409; read-back matches the DB; labels in the user's language.

### Owner answers (2026-10-30)
1. **No apartment link.** Apartments have no visits today and there is no link between a contact and an apartment (an apartment's resident name is plain text). A helper visit is contact-only.
2. **No visit edits** through the helper — new visits only (and no delete, ever).
3. **Visit type: yes**, the org's whole current active list.
4. **Torah thought** = the existing visit dropdown "דבר תורה" (`checklist.torah_thought`, Fields page key `visits.torah_thought`), options in org 1: נמסר / לא נמסר / מתוכנן — on the dashboard visit form (VisitForm.tsx). Owner could not find it — pending: keep it in `new_visit_fields` like the visit form does (it follows the same hide setting), or leave it out?

---
## Owner decision (2026-10-30, from fixes118): one label only
Every label the helper receives — fields, options, the people draft label, contact fields, visit fields — is ONE `label` in the user's stored `locale` (no locale → Hebrew; English missing → the Hebrew label). `label_en` / `status_label_en` are removed. The "Bilingual labels" rule at the top of this file is replaced by this. Also from fixes118: `request_id` idempotency on every write (contact update, new visit), replacing the `visit_history.client_uuid` idea above; a hidden contact = 404.

---
## Owner decisions (2026-10-30, round 3)
- **Priorities:** the main things the helper does with people are **create a new contact** (already on main: proposals + confirm) and **record a new visit** (endpoint 4). Editing a contact (endpoint 3) is secondary — build order: contact read (endpoint 2) → new visit (endpoint 4) → contact edit (endpoint 3).
- **Editable contact fields** (admin + staff): all core fields (name, last name, phone, email, address, pipeline status, color tag, priority) + the org's contact picklists + contact custom fields, minus anything hidden on the Fields page. Everything else = the same 403.
- **Torah thought** stays a visit field in the helper, following the same Fields-page hide setting as the dashboard visit form.
- Terminology (from fixes118): "apartment field", not "status field".

---
## Owner decisions (2026-11-02, round 4) — binding
1. **Activist contacts (contact_type = shliach) are out of the helper entirely**: never returned by `GET /api/assistant/search`, and every contact endpoint answers 404 for them (same as missing).
2. **Drafts**: open and edit yes; recording a visit only on an active contact (a draft → 409 "Approve the contact first"; `can_add_visit` false in the read).
3. **Mekurav section**: `potential_next_step` (picklist) is editable; recommendations, background, tzedaka potential, admin area, apartment link, first visit are not. Fields-page hide settings apply; `contact_shliach.manager_jewish_status` stays admin-only (moot — activists are out).
4. **New visit = every visit field**: date, visit type, location, Torah thought, the Mivtzoim (visit yes/no fields), visit select fields, visit text fields (connection to the Rebbe), notes, and the interactions log. Hidden fields (Fields page / inactive custom fields) are left out.
5. Apartment link by lineage: frontend route `/dashboard/apartments/lineage/{lineage_id}` opens the current version; every apartment object carries `web_path`.
6. Build everything in one go; no commit until asked.

---
## Status (2026-11-02) — endpoints 2, 3, 4 DONE locally, NOT committed

Code: `backend/app/contact_edit_rules.py` (which contact / new-visit fields, from the org's settings), `backend/app/routers/assistant_contacts.py` (the 3 endpoints), `backend/app/core/assistant_requests.py` (shared request_id helper). Writes go through the dashboard's own paths (`contacts.update_contact`, `visits._apply_payload`).

- [x] Activists out: `GET /api/assistant/search` returns mekurav contacts only; every contact endpoint answers 404 for an activist contact (same as missing).
- [x] Who: admin + staff only; activist / campaign manager → 404 on every contact endpoint; superadmin → 403; another org's contact → 404.
- [x] **Endpoint 2 `GET /api/assistant/contacts/{id}`** → `{contact_id, status, status_label, name, last_name?, phone?, email?, address?, web_path, editable_fields, can_add_visit, new_visit_fields, recent_visits}`. A core value hidden on the Fields page is not sent at all (org 1 hides phone → no `phone` key). `web_path` = `/dashboard/contacts/{id}`.
  - `editable_fields`: name (never hidden, never cleared), last name, phone, email, address, pipeline status, color tag, priority score — each by its own `contacts.*` Fields key; when the prospect section (`contact_mekurav.section`) is shown: next step, the org's prospect picklists (Jewish status, affiliation, language, admin-added), prospect custom fields (yes/no, text, number, date). Kinds: `text | number | date | yes_no | single_option`. An option list with no active options is left out.
  - `new_visit_fields`: `visits.visit_date` (date, `required`, `default` today), `visits.visit_type`, `visits.location`, `visits.torah_thought`, every active visit custom field as `customfield.visit.<key>` (Mivtzoim yes/no with `default: false`, text, number, date, lists), `visits.notes`, `visits.interactions` (kind `entries`: `[{category, note}]`, options = interaction categories). Hidden by the Fields page (`visits.*` / `customfield.visit.<key>`) or inactive → left out.
  - `recent_visits`: last 5, newest first: `{visit_id, visit_date, visit_type (label), location?, done: [labels], notes, interactions?}`. `done` = each ticked yes/no label, and "label: value" for picked lists (Torah thought, visit lists) and filled text/number/date fields.
- [x] **Endpoint 3 `POST /api/assistant/contacts/{id}/update`** `{field_key, value, request_id?}` → `{status: updated|unchanged, replayed, field_key, value (read back), contact_id, contact: <endpoint 2 view>}`. Contacts keep a stable id on save (no versions) — `contact_id` never changes, so no lineage key is needed (noted in the router docstring). Not editable / hidden / unknown → the same 403. 422 codes: `required` (first name), `too_long`, `invalid_phone` (the dashboard's phone rule), `phone_taken`, `invalid_email`, `expected_text|number|whole_number|date|option|yes_no`, `value_not_allowed`. Lists and yes/no are never cleared; text, number, date clear with `null`. A changed address is located on the map (dashboard geocoding).
- [x] **Endpoint 4 `POST /api/assistant/contacts/{id}/visits`** `{values: {field_key: value}, request_id?}` → 201 `{status: "created", replayed, visit_id, contact_id, visit: <recent_visits shape, read back>}`. Draft contact → 409 "Approve the contact first" (Hebrew in `PLAIN_ERRORS`). Unknown / hidden / inactive field → 403. An unticked yes/no is not stored.
- [x] `request_id` on both writes (fixes118 decision 6, `assistant_requests` table, actions `contact_update` / `visit_create`): replay → `replayed: true`, nothing written; same id + other request → 422 `request_id_reused`; scoped to the user.
- [x] One `label` in the user's locale everywhere (fallback labels in code when a localization row is missing).
- [x] Tests: `backend/tests/test_fixes117_contacts.py` (18) — read shape, every visit field, hidden visit fields, prospect section opt-in + hidden phone, permission matrix (admin/staff/activist/CM/superadmin/activist contact/other org/missing/401), labels per locale, update read-back + unchanged, staff + address geocode, prospect fields, every 422 code, same-403, drafts, update replay/reuse/scope, visit with every field + read-back, date default, visit validation, visit replay creates once, apartment lineage link. `test_fixes117.py` updated (activist contact excluded from search).
- [x] Live against local Postgres `crm_local_dev`, org 1, as admin (host uvicorn + minted JWT): search excludes activist contact #430 (and GET #430 = 404); contact #1 read shows the real catalog (14 editable fields incl. prospect picklists + custom numbers/dates; phone omitted because org 1 hides it; 14 visit fields incl. all 7 Mivtzoim yes/no); last-name update → replay → revert; visit created → replay returned the same visit_id → test visit deleted, test request rows removed.
- [x] Full backend suite (SQLite, Postgres-only tests excluded): 908 passed, 1 skipped.
- Not done / open: the helper side (`crm-assitant`) does not call these endpoints yet.
