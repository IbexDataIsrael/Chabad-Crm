# fixes94 — every error message through the localization table; app name "Jewish Points"

Requested 2026-10-01: "implement your finding — everything has to go to
localization" (fixes93 §3) + "the name of the app on the login page should be
Jewish points / נקודות יהודיות, not mini crm".

## 1. App name

- [x] `auth.app_title` → "נקודות יהודיות" / "Jewish Points" (login page heading
      and the sidebar fallback name); code fallbacks and the site description
      updated.
- [x] Existing databases: `LOCALIZATION_RENAMES` updates the stored row only
      while it still says "מיני CRM" / "Mini CRM" (prod's row does → upgrades on
      deploy; an edited title is left alone). Live-verified locally (he + en).
- Note: the browser-tab title ("Jewish Points CRM") is the superadmin's
  system setting "fallback name" — editable there.

## 2. Every API error message in the localization table

Before: ~205 backend raise sites sent plain text (mostly English, 3 Hebrew),
shown as-is by the frontend in 97 places — never in the table, never
translated. Only the login errors used codes.

- [x] `backend/app/error_localization.py` — the registry, category `error`
      (153 rows): every fixed message (key derived from its English text,
      `error_key()` → `error.<slug>`) with Hebrew, plus coded messages
      (templates with `{placeholders}`), validation (422) messages and generic
      HTTP messages. Loaded into the seed's `LOCALIZATION`.
- [x] `app/core/errors.py api_error(status, code, template, **params)` —
      for messages that include values; sends `{code, message, params}`.
      The 32 value-building messages, the activist-email error and clone
      failures now use it; the 3 Hebrew-only messages are English in the code
      (Hebrew in the table); two validator messages dropped the echoed value.
- [x] Frontend `lib/errorText.ts` + one change in `api.ts readErrorDetail`:
      every failed response is translated (plain → `t(error.<slug>)`, coded →
      `t(code)` + params, 422 lists → their first message), so all 97 places
      that show `err.message` now show the user's language. Unknown keys fall
      back to the server text.
- [x] Safety net `tests/test_error_localization.py`: parses the backend and
      fails if any HTTPException / validator message has no row, if a message
      builds in values without `api_error`, or if an `api_error` code/template
      doesn't match the registry. Key algorithm pinned on both sides
      (`frontend/lib/errorText.test.mjs`, same examples).
- Excluded on purpose: the Instinct API (`routers/instinct/`, an external
  machine client, not our UI).

Verified:
- Backend: full suite green — 651 passed + 5 (test_models). Updated tests
  that compared old texts: fixes14 (now coded), fixes28 (Hebrew → English),
  fixes15 (the welcome subject — this one had been failing since the fixes90
  commit, which I hadn't run the full suite for).
- Frontend: `tsc --noEmit` clean; `node --test lib/errorText.test.mjs` 3/3.
- Live (local): adding an activist with an email another activist uses →
  real 400 shown as "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון: בדיקה53
  (#430)" in Hebrew and "This email already belongs to another activist in the
  organization: בדיקה53 (#430)" in English.

Not committed.
