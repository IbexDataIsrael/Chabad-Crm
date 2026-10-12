# fixes101 — error-mail visibility, catch every error, "not configured" warning

Requested 2026-10-12: "also add to superadmin config the mail that errors are
sent to . and make sure that errors a caught ( i think we have this for logs)
once an error is caught send an email to the email . also notify superadmin
user when the 2 emails are not confgured"

Builds on fixes100 (the two superadmin lists: new-org signups, errors).

## Done
- [x] 1. Each notify card in System settings shows where mail **actually**
      goes right now («נשלח כעת אל: …»), including the env fallback while
      the list is empty. Backed by `GET /api/admin/notify-emails-status`
      (superadmin only): per list `{configured, effective}`.
      Live: both cards showed the env fallback; after saving an error
      address the error card switched to it.
- [x] 2a. Request errors (500s): already caught (fixes75), unchanged. Mail
      subject is now «Server error: …».
- [x] 2b. Errors the code catches itself and logs (`logger.exception` under
      the `app` logger: background emails, Cloudinary cleanup, geocoding,
      threads, handled failures inside requests) → `BackgroundErrorHandler`
      in `core/error_log.py` writes an error_logs row (method `LOG`, path
      `logger:function`) and emails it («Logged error: …»). Only ERROR
      records that carry a traceback. The alert mailer's own failures
      (`app.errors`) are skipped, and a thread-local guard stops recursion.
      Same 10-minute throttle. Live: a logged ConnectionError became row
      `LOG app.core.geocode:…`.
- [x] 2c. Browser crashes → `POST /api/logs/client-error` (works without
      login, attributed to the user's org when logged in; 20 reports / 10
      min per IP; size-capped) → error_logs (method `BROWSER`, path = page)
      + email («Browser error: …»). Sources: `window` error +
      unhandledrejection (`components/ClientErrorReporter.tsx`), React
      render errors (`app/error.tsx` with retry/reload, `app/global-error.tsx`
      as a last resort). API errors and dropped connections are not
      reported (the server already logs 5xx; network drops are not bugs).
      Each error is reported once per page load, at most 10.
      Live: a thrown TypeError on the settings page became an error_logs
      row, and Gmail accepted the alert mail.
- [x] 3. Orange warning banner at the top of every superadmin page while
      either list is empty, naming which, with a link to System settings.
      It refreshes as soon as a list is saved. Live-verified.
- Localization rows: `admin.notify_emails_effective/_nobody/_missing/_configure`,
  `error_page.title/body/retry/reload`.
- Tests: `backend/tests/test_fixes101.py` (8 tests). conftest turns the
  logged-error capture off by default (tests log expected failures).

## Not done / caveats
- `app/error.tsx` (React render crash screen) was not triggered live, since
  no page crashes on purpose. Only the window-level reporter was.
- Errors logged by third-party loggers (uvicorn, sqlalchemy) are not
  captured, only our own `app.*` loggers.
- A logged error has no org or user attached (the logger doesn't know
  them), so it goes to the superadmin list only, not an org's list.
- Live drive sent one real alert mail to `bugs@example.com` (reserved
  domain, goes nowhere) through the dev Gmail account.
