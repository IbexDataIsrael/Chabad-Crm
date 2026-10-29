Do not push, commit to main or deploy. Make the changes, run the tests, then stop for review.
User language in the CRM: use what already exists, close three gaps
Big picture
The CRM is used in Hebrew and English. A separate chat assistant (its own project, signs in with the user's CRM login and calls the CRM API with that user's token) and later a WhatsApp client must talk to each user in the language that user last used. The CRM user is the single source of truth for that language. The assistant may hold it in memory for the current session only; the CRM value wins at every new session.
This task is the CRM side only. A matching task for the assistant project reads and writes the language through the endpoints below.
What already exists (do not rebuild)
Table user_preferences (model UserPreference): one row per user and key, unique on user_id + key, value is JSON text. The key locale holds "he" or "en".
API GET /api/preferences and PUT /api/preferences (body {"key": "locale", "value": "en"}). Self-scoped: a user only reads and writes their own rows.
Frontend frontend/lib/localization.tsx: language is also kept in the browser (localStorage key crm_lang). setLang saves locale to the account when logged in. After login the stored locale overrides the browser value. <html> gets lang and dir (rtl for Hebrew). LanguageToggle is the only switch.
Decision: no new column and no new table. The existing locale preference is the stored "user language". One row per user, with updated_at, is enough. Adding a column would create a second place that can disagree.
Gaps to close
Validation. PUT /api/preferences accepts any JSON for any key. For key locale only accept the strings "he" and "en"; otherwise answer 400 (Invalid language). Other keys behave exactly as today. Report any stored locale row that holds another value; do not change them silently.
Only an explicit choice is saved; a browser default never is. Two different things exist: an explicit switch (the user pressed the language toggle, or the assistant saved a language the user chose or clearly wrote in) and a passive fallback (the language the screen shows only because of the browser or a default). Only an explicit switch may write locale. Nothing writes locale because of a passive fallback, including at first login: a user with no stored value stays "unknown".
Current gap: a language toggled on the login screen (before login) is not saved, because the stored account value overrides it after login. Change: when the toggle is pressed while logged out, mark it as explicit for this browser session (for example sessionStorage). After login, if that mark exists, use that language and save it to locale, then clear the mark. If the mark does not exist, the stored value wins as today, and the browser's crm_lang value is never saved on its own.
Write semantics (verify, do not assume). PUT /api/preferences upserts one row for one key and returns the user's full map. Confirm with a test that a locale write leaves every other key (for example contacts.columns) unchanged, and that a write for another key leaves locale unchanged. Concurrency rule: the last explicit write wins (several tabs, the assistant, a future WhatsApp client). Other open sessions pick the new value up at their next login or page load; no live push is needed.
Saving stays non-blocking: if the save call fails the screen keeps working in the chosen language and the value is not shown as saved.
Contract the assistant relies on (keep stable)
GET /api/preferences with the user's bearer token returns a map; the assistant reads only locale and ignores every other key. Missing key means language unknown.
PUT /api/preferences with {"key": "locale", "value": "he" | "en"} saves it for the token's user only.
Custom labels and picklist values are shown exactly as stored. Nothing is translated, and IDs and keys are never translated.
Assistant-facing endpoints that return labels must keep returning both languages (for apartment edit: editable_fields[].label is Hebrew, label_en is English). If any assistant-facing field, option or picklist value has only one language, list them in the report; do not invent translations.
Assistant-facing errors must keep stable machine codes or statuses. The assistant shows its own Hebrew or English text for them, so message wording is not part of the contract.
Out of scope
No WhatsApp work, no phone-to-user matching, no new endpoints, no changes to other preference keys, no translation of stored CRM data.
Tests (add and run)
PUT locale with he and en works; with fr, empty, number, null and object returns 400 and changes nothing; other keys still accept their current values.
A locale write leaves other keys unchanged and the reverse; two writes in a row: the last one is stored.
One user cannot read or change another user's locale; unauthenticated calls return 401.
Same account on two browsers: toggle in one, log in on the other, it shows the saved language.
Toggle on the login screen, log in: that language is shown and saved even if a different one was stored.
No toggle on the login screen, stored value exists: stored value wins, nothing is written.
No stored value and no toggle: nothing is written at any point, before or after login (browser default is never saved).
Save call fails (network error): screen still switches and works.
<html lang> and dir follow the language after every switch, including right after login.
Report back
Say what changed, what was not changed, that the single-key write behaviour was verified, the stored values found in the database by language count (he, en, other, none), and any one-language items found in assistant-facing data.

---
## Status (2026-10-29) — DONE locally, NOT committed

### Changed
- [x] Validation — `backend/app/routers/preferences.py`: key `locale` only accepts the strings `"he"` / `"en"`; anything else (fr, "", "HE", " he", number, null, object, list, bool) → 400 `"Invalid language"` and nothing is written. Other keys unchanged. Hebrew text added to `PLAIN_ERRORS` in `backend/app/error_localization.py` (fixes94 convention; the AST test passes).
- [x] Explicit-only writes — `frontend/lib/localization.tsx`: toggling while logged out sets sessionStorage `crm_lang_explicit`. After login, if that mark exists, that language is shown and saved to `locale`, and the mark is cleared once the save succeeds (a failed save is retried on the next load). With no mark, the stored value wins as before. `crm_lang` (localStorage) is display-only and is never saved by itself. "Logged in" is now `useAuth().user` rather than `getToken()`, so a stale token on the login screen counts as logged out.
- [x] Non-blocking save — a failed PUT leaves the screen in the chosen language.

### Not changed
- No new column, table or endpoint. GET/PUT `/api/preferences` contract unchanged except for the 400 on bad locale. Other preference keys untouched. LanguageToggle is still the only thing that calls `setLang`. Nothing else in the frontend writes `locale` (grep verified).

### Verified
- [x] Single-key write: `backend/tests/test_fixes116.py` (23 tests) — a locale write leaves `contacts.columns` / `apartments.columns` intact and vice versa; last write wins with exactly one row; user isolation (a smuggled `user_id` in the body is ignored); 401 when unauthenticated. Existing `test_fixes17::TestPreferences` and `test_error_localization` still pass.
- [x] Frontend tests 29–34: live Playwright drive against the local stack, with a throwaway staff user that was deleted afterwards — 20/20 checks passed: T32 nothing written ever; T31 stored wins, no write; T30 login-screen toggle wins + saved once + mark cleared; T29 second browser shows saved value; T33 aborted PUT → still switches, DB unchanged, no page errors; T34 `<html lang/dir>` correct after every switch, including right after login.
- tsc: the same 3 pre-existing errors with and without this change (`canvas-confetti`/`qrcode` missing from the container's stale node_modules); none from this change.

### Stored locale values (LOCAL DB crm_local_dev only — prod/VPS not queried)
183 users: he = 2, en = 0, other = 0, none = 181. No invalid rows to report.

### One-language items in assistant-facing data (apartment edit, local DB)
Nothing was translated. Where English is missing, the API falls back: field `label_en` = the Hebrew label, option `label_en` = the stored technical value.
- Field labels with no English: `customfield.apartment.aptnote35`, `apartment.drivetest33`, `customfield.apartment.sync_check_*` (3 keys) — all look like leftover test-drive fields.
- Apartment picklist options with no `english_value` (so `label_en` = the raw value, e.g. `jewish_interested`): `Jewish_status` / `apartment.Jewish_status` (6), `apartment.mezuzah_status` (2), `language` (`na`), `diet34drive` / `apartment.diet34drive` (2, test data).
- Same gap in non-apartment picklists (not assistant-facing today): affiliation, contact.*, checklist.torah_thought, interaction.category, shliach.*, significant_date.type, visit.type, contact_shliach.manager_jewish_status. `shliach.role35` values are stored in Hebrew.
