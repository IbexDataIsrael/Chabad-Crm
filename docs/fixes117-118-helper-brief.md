# Brief for the chat helper (crm-assitant): sync with CRM fixes117 + fixes118

Written 2026-11-02 from the CRM side. The CRM endpoints below exist on the CRM's
`main` (round 1 committed as cdb2099; round 2 = the contact endpoints + the
apartment link is local and not yet committed or deployed). The full contract is in
sheepsidebay_crm `docs/fixes117.md` and `docs/fixes118.md`. Read them for the
details. This brief covers what the helper must change.

Do not commit or push without the owner's go. Test against a test CRM and test
data only, never production.

## 0. Already in sync (checked in crm-assitant `app/crm_api.py`, 2026-10-30 head)
- Uses `GET /api/assistant/search` and `GET /api/assistant/apartments/getapartment?id=<lineage_id>`.
- Accepts a missing `label_en`. The CRM no longer sends `label_en` / `status_label_en`: one `label`
  in the user's CRM language.

## 1. Fixes to the existing apartment flow
1. **yes_no is never cleared.** `apartment_chat.py` `CLEARABLE` includes `yes_no`, but the CRM
   answers 422 `expected_yes_no` to null. Remove `yes_no` from `CLEARABLE`, and do not offer
   "Clear the value" for it. `single_option` is not clearable either (already right).
2. **Drop the `label_en` fallbacks** in `apartment_chat.py` (lines ~317/322/489/498). Show `label` only.
   Don't invent a second language.
3. **Send `request_id`** on every apartment update: a UUID generated once per confirmed "yes",
   kept in the page state until the answer is settled.
   - Lost answer (timeout, dropped connection, 5xx, unreadable) → on the user's next "yes", resend
     the SAME request_id with the SAME body. `replayed: true` = the CRM's proof the write was
     saved → say "saved". Only then may the helper say saved after a lost answer.
   - 422 `request_id_reused` = a bug on our side (same id, different body). Show the fixed
     message, nothing was saved, make a new request_id for any new change.
   - Never reuse a request_id for a different change.
4. **The link**: every apartment object now has `web_path`
   (`/dashboard/apartments/lineage/{lineage_id}`). Show `CRM_WEB_URL + web_path`. Do NOT build
   `/dashboard/apartments/{apartment_id}` yourself. The lineage link always opens the current
   version, so an old link keeps working after later edits.
5. **Confirm wording** (fixes118 decision 8): "<building_address>, apartment <apartment_name>".
   Never show the internal apartment id.

## 2. People in the combined search
- People results are prospect contacts only. **Activist contacts are never returned** and the
  helper never shows or edits them (the CRM enforces it; the helper needs no rule of its own).
- People come only for admin and staff. Each person has `status` ("active" | "draft") and
  `status_label` (already translated, null when active). Show the label next to a draft.
- `can_add_person` unchanged. Still open for the owner: offering "add a person" to activists.
  Until then, hold that offer for activists.

## 3. New: the contact flow (admin and staff only)
Pick a person from the search → open → "edit a field" or "record a visit".

### Open: `GET /api/assistant/contacts/{contact_id}`
```
{contact_id, status, status_label, name, last_name?, phone?, email?, address?,
 web_path, editable_fields: [{field_key, label, kind, current_value, options?}],
 can_add_visit, new_visit_fields: [{field_key, label, kind, options?, required?, default?}],
 recent_visits: [{visit_id, visit_date, visit_type, location?, done: [text], notes, interactions?}]}
```
- A key missing from the answer means the org hides that field. Don't ask about it.
- `web_path` = `/dashboard/contacts/{id}`. Prefer it over building the URL in `contact_page_url`.
- Contacts keep the same id after a save (no versions, unlike apartments).
- 404 = not found or not allowed (same answer on purpose). 403 = superadmin.

### Edit one field: `POST /api/assistant/contacts/{contact_id}/update`
Body `{field_key, value, request_id}`. One field per call, same rules as the apartment update.
- Kinds: `text`, `number`, `date` (YYYY-MM-DD), `yes_no` (true/false), `single_option` (one option value).
- Clearing (null): allowed for text, number, date, EXCEPT the first name (`contacts.name`).
  Never for `single_option` or `yes_no`.
- Answer: `{status: updated|unchanged, replayed, field_key, value, contact_id, contact: <the open view>}`.
  Show only `value`, as read back by the CRM.
- 403 "This field cannot be edited here" = not allowed / hidden / unknown (one message for all).
- 422 `{status: "invalid", invalid_fields: [{field, code, value?, max_length?}]}`, codes:
  `required`, `too_long`, `invalid_phone`, `phone_taken`, `invalid_email`, `expected_text`,
  `expected_number`, `expected_whole_number`, `expected_date`, `expected_option`,
  `expected_yes_no`, `value_not_allowed`, `request_id_reused`.
- A changed address is placed on the map by the CRM. Nothing for the helper to do.

### Record a visit: `POST /api/assistant/contacts/{contact_id}/visits`
Body `{values: {field_key: value}, request_id}`. The whole visit in ONE call, after ONE confirm
screen listing every value ("Record a visit for <name>: date …, tefillin ✓, candles ✓. Reply yes to save").
- Build the questions from `new_visit_fields` only. It is the org's live catalog: date, visit type,
  location, Torah thought, the Mivtzoim yes/no fields, connection to the Rebbe (text), the org's
  visit lists, notes, interactions. Never hardcode the field names.
- `visits.visit_date` is required. Omitted = today (`default`).
- yes_no: true/false. An unticked mitzva can simply be left out.
- New kind `entries` (`visits.interactions`): a list of `{category: <option value>, note: text}`.
  Treat it as optional; it is fine to skip it in phase 1.
- `can_add_visit: false` (a draft contact) → don't offer it. The CRM answers 409 "Approve the contact first".
- Answer 201: `{status: "created", replayed, visit_id, contact_id, visit: <recent_visits shape>}`.
  Show `visit.done` as the CRM's read-back.
- Same request_id rules as above. Resending the same request_id after a lost answer creates
  nothing new and returns the original visit.
- No editing or deleting visits through the helper, ever.

## 4. Error handling (unchanged rules, now for contacts too)
401 → log in again. 403 → the fixed "The CRM did not allow this request. Nothing was changed."
404 → re-open (a contact the user can no longer see is gone from the chat). 409 on visits →
"approve first". 422 → the plain reason per field. Lost answer → blocked, re-check with the
same request_id. The input is disabled while a turn is in flight.

## 5. Tests the helper should have
Mocked CRM, same standard as the apartment chat: contact open → edit (each kind, clearing rules,
each 422 code, 403), visit with a full catalog (yes/no + list + text + date default), draft = no
visit offer, lost answer → same request_id resent → `replayed` → "saved", `request_id_reused`
handling, activist role never sees people, labels shown exactly as sent, links built from `web_path`.
