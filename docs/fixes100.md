# fixes100 — notification emails managed by the superadmin

Requested 2026-10-12: "i want to make a change to the emails for bugs and
registration. the emails should be set in the superadmin configuration
section. enable dynamic adding of more than 1 email. use those emails on
error / new registration"

## Before
- New-organization signup mail went to env `PLATFORM_ADMIN_EMAIL` +
  `SUPERADMIN_EMAIL`, **plus** an optional superadmin list (fixes81).
- Server-error mail went only to the org's own "Errors Admin Emails" list
  (fixes75). An error with no org went to env `PLATFORM_ADMIN_EMAIL`. The
  superadmin got no alert for errors inside an org.

## Now
- [x] System settings (`/dashboard/admin/settings`) shows two cards, each a
      list you can add to and remove from (any number of addresses,
      validated, lowercased, de-duplicated):
      «התראות על הרשמת ארגון חדש» and «התראות על שגיאות מערכת».
- [x] New-organization signup → the signup list. Once it has addresses it
      **replaces** the env addresses (no longer "in addition to").
- [x] Every server error, in any org or none → the error list, on top of
      that org's own errors list (deduped). The 10-minute throttle per
      org + error type + path is unchanged.
- [x] Empty list → falls back to env `PLATFORM_ADMIN_EMAIL` /
      `SUPERADMIN_EMAIL`, so a fresh install never mails nobody. The card
      says so when empty.
- [x] API: `GET/PUT /api/admin/pending-signup-emails` (existing) and
      `GET/PUT /api/admin/error-notify-emails` (new), superadmin only.
      Stored in `system_settings` (keys `pending_signup_notify_emails`,
      `error_notify_emails`); no migration.
- [x] Localization: new rows for the error card + empty-state text; the
      signup card's title/intro reworded via guarded `LOCALIZATION_RENAMES`.
- Tests: `backend/tests/test_superadmin.py` (signup list replaces env;
  error-list endpoint; org + platform recipient combining + env fallback),
  `test_fixes75.py` adjusted. Live: superadmin settings page — added 2
  error addresses, saved, survived reload (then cleared locally).

## Not done / caveats
- Not verified on prod (VPS) — after deploy, add the addresses in System
  settings; until then prod keeps mailing the env addresses.
- Superadmin now gets one alert per org for the same failing endpoint
  (throttle is per org). Fine at today's volume; revisit if it gets noisy.
- The old `admin.pending_signup_emails_none` localization row stays in the
  DB unused (harmless).
