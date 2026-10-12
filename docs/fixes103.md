Don't push - stop for my review.

Task: route ALL email sending in this project through the email-service microservice. It is already running locally at http://localhost:8000. If this project runs in a container, use http://host.docker.internal:8000 instead - inside a container, "localhost" is the container itself; host.docker.internal is Docker Desktop's name for the real machine.

i added  2 environment variables. Read them at startup and fail fast with a clear error if either is missing:
- EMAIL_SERVICE_URL (local value above, no trailing slash)
- EMAIL_SERVICE_TOKEN (the shared token - it travels in the X-Internal-Token header)

API contract (exact):
POST {EMAIL_SERVICE_URL}/send
Header: X-Internal-Token: {EMAIL_SERVICE_TOKEN}
JSON body: to (string, required), subject (string, required), html (string, optional), text (string, optional) - at least one of html/text required, from_address (optional), reply_to (optional), project (optional - use "minicrm").
Success: 200 {"id": "<uuid>", "status": "queued"} - queued means accepted; a background worker sends it and retries on failure. 401 = wrong/missing token.

Work:
1. One small client module wrapping this call, in the project's existing layout. Log non-200 responses as errors. No retry logic - the service owns retries.
2. Find every place this project sends email today (search: resend, smtp, sendmail, email) and route all of them through the module. Keep existing templates and placeholder replacement unchanged.
3. Add the 2 variables to .env.example with empty values and to the project's env/compose wiring. Never commit the token value.
4. Add one test that sends a real email through the local service and prints the returned id.

Fallback: if the POST to EMAIL_SERVICE_URL throws, times out (use a 5s timeout), or returns non-200, send the email through the existing Gmail path instead so nothing is lost, and immediately send an urgent alert email to the superadmin address through that same Gmail path: subject "EMAIL-SERVICE DOWN", body with the error and which email fell back. Log both events. A 200 is never a failure - it means the service accepted the email and owns delivering it.

---

## Closeout (2026-10-13), committed b4ffccf, not pushed

- [x] 1. Client module `backend/app/core/email_service.py`: `send(to, subject,
      html, text, from_address, reply_to)` → POST `/send`, header
      `X-Internal-Token`, `project: "minicrm"`, 5s timeout, no retries.
      A non-200 is logged as an error. Exceptions, timeouts and non-200s
      raise `EmailServiceError`. A 200 returns the id and is never a failure.
- [x] 2. Every email in the project already went through one function,
      `core/email.py::send_email` (the only `smtplib` use; callers: templated
      mails, activist emails, org pending/approved, password reset, error
      alerts, public registration notices, reminder scheduler, superadmin
      test-email). `send_email` now calls the service. The Gmail code moved
      unchanged into `send_via_gmail`. Templates and placeholder replacement
      are untouched. Comma-separated `to` (the reminder scheduler) → one
      service call per address (the service takes one recipient).
- [x] 3. `backend/.env.example`: `EMAIL_SERVICE_URL=`, `EMAIL_SERVICE_TOKEN=`
      (empty). `docker-compose.yml`: backend gets
      `EMAIL_SERVICE_URL=http://host.docker.internal:8000` and the token from
      the root `.env` (`${EMAIL_SERVICE_TOKEN}`), plus `extra_hosts:
      host.docker.internal:host-gateway` so the name also resolves on Linux
      Docker. Fail fast: `config.py` refuses to start with «Missing required
      environment variable(s): EMAIL_SERVICE_URL, EMAIL_SERVICE_TOKEN …» if
      either is empty; it strips a trailing slash. The token value is not in
      any tracked file.
- [x] 4. `backend/tests/test_fixes103.py::test_real_email_through_local_service`
      sends a real email through the running service and prints the id. It
      sends to `EMAIL_SERVICE_TEST_TO`, defaulting to Resend's test inbox
      `delivered@resend.dev`. It skips when the service is unreachable.
      Run: id `ee04a939-…`; the service's outbox shows `status=sent`,
      `project=minicrm`, with a Resend message id. 11 more unit tests cover
      the contract, fallback, alert, throttle, split and fail-fast. Every
      other test stubs the service (conftest), so the suite never sends mail.
- [x] Fallback: service throws, times out or returns non-200 → that
      recipient's email goes through Gmail, and «EMAIL-SERVICE DOWN» (error +
      which email + recipient) goes to `SUPERADMIN_EMAIL` (else
      `PLATFORM_ADMIN_EMAIL`) through Gmail. Both are logged (`logger.error`,
      no traceback, so the fixes101 error capture doesn't mail them again).
- Live (local Docker): the superadmin `POST /api/admin/test-email` → service
  → `sent`. A forced unreachable service URL → «email-service FAILED …
  falling back to Gmail» + «EMAIL-SERVICE DOWN alert sent to …» (both to
  the dev Gmail account's own inbox).
- Full backend suite: 716 passed.

### Decisions / deviations to review
- **Alert throttle**: the first fallback alerts immediately. Later ones within
  10 minutes are only logged (`SERVICE_DOWN_ALERT_INTERVAL_SECONDS`), so a
  bulk send while the service is down doesn't send one alert per email.
- **Org name as sender**: the old Gmail path showed the org's name as the
  sender. The service sends from its own domain, so the CRM doesn't know
  the address. New **optional** `EMAIL_SERVICE_FROM` (e.g.
  `admin@jewishpoints.com`): when set, org mail goes out as
  `Org name <that address>`. When empty, the service's `DEFAULT_FROM` is
  used with no org name. Not set anywhere yet.
- The text body is always sent too (`text` + `html`), as in the old
  multipart mail.

## Not done / before deploying
- **The VPS needs both variables before this is deployed, or the backend
  won't start** (fail fast, as asked). That means the prod service URL and
  token in the VPS backend env. Pushing `main` auto-deploys
  (`.github/workflows/deploy-vps.yml`).
- If the backend runs outside Docker, the root `.env`'s
  `EMAIL_SERVICE_URL=http://localhost:8000` applies. In Docker, compose
  overrides it with `host.docker.internal`.
- `docs/archive/deployment.md` (env var table) not updated (archived doc).
