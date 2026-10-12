# fixes102 — org on every error + per-org activity log

Requested 2026-10-12: "is there a way to know the org when crash? also i want
to add a log per action per org (for example opened contacts page , added
contact , activist updated apartment) , and have the log off by default and
can be turned on per organization . it is a big change"

## Decisions (user, 2026-10-12)
1. Turn on/off: **superadmin only**.
2. View: **superadmin only** (the tab lives on the superadmin's Logs page,
   not the org admin's).
3. Retention: **90 days**.
4. No old → new values: who / what / when + entity id only.

## Part A — the org on every error
Before: server 500s and browser crashes already carried org + user (from the
login token). Errors that were caught and logged (fixes101 `LOG` rows) had
no org.

- [x] A request middleware (`main.py` `_request_context_and_activity`) puts
      the request's user id in `activity_log.current_user_id` (a
      contextvar). The logged-error handler reads it, so a `LOG` row gets
      the org + user and is also mailed to that org's own errors list.
      FastAPI background tasks keep the context; a raw `threading.Thread`
      does not (no such case logs errors today).
- Test: `test_logged_error_gets_the_requests_org`.

## Part B — activity log
- [x] **Table** `activity_logs` (migration `a2b3c4d5e6f7`): org (CASCADE),
      user (SET NULL), time, kind (`action` | `page_view`), action, method,
      route template, entity id, page, IP. Index (org, time).
- [x] **Toggle**: `organization_prefs` key `activity_log_enabled`, default
      **off**. Superadmin → Organizations → «תכונות» → «יומן פעילות
      (פעולות וצפיות בעמודים)». Exposed in `/me` feature_flags. The cache
      is cleared on save, so it applies at once. Live: clicking the
      checkbox saved, with a toast, and the DB row changed.
- [x] **Data changes, automatic**: every successful (2xx/3xx) POST / PUT /
      PATCH / DELETE under `/api/*` by a logged-in, non-superadmin user of
      an org with the log on. The action comes from the route template,
      e.g. `PUT /api/areas/{area_id}` → `areas.update`. Entity id comes
      from the URL, or for a create from the JSON response's `id`. Not
      logged: `/api/auth`, `/api/admin`, `/api/logs`, `/api/activity`,
      `/api/preferences` (UI-state autosave), `/api/public`,
      `/api/street-activity`, `/api/instinct`, reads, failed requests.
      54 action names exist today; the common ones have Hebrew/English
      labels (`activity.res.*`, `activity.verb.*`), the rest show raw.
- [x] **Page views**: the dashboard layout posts each opened page to
      `POST /api/activity/page-view`, only while the org's flag is on and
      once per navigation. Covers activists' pages too (street2 etc.).
- [x] **Viewing**: superadmin Logs page → «יומן פעילות» tab. Org filter
      (shared with the other tabs), user, kind (actions / page views),
      action, date from/to, pagination. `GET /api/logs/activity` and
      `/api/logs/activity/options`, superadmin only (an org admin gets
      403).
- [x] **Retention**: scheduler job, daily, deletes rows older than 90 days
      (`activity_log.purge_old`).
- [x] Org delete removes its rows; user delete keeps them (user cleared).
      Backups and clones don't include them (fixed table lists).
- Tests: `backend/tests/test_fixes102.py` (9 tests).
- Live (local, org 1 admin): 2 page views + area add/update/delete showed
  up in the tab with the right labels and `#id`. Found and fixed page views
  being recorded twice (effect re-runs) → one report per navigation.
  Test rows, test area and toggles cleaned up afterwards.

## Not done / caveats
- Not deployed. The VPS needs the migration (runs on backend start) and
  then the toggle per org.
- Actions done through the Instinct (WhatsApp/voice) API aren't logged:
  there is no logged-in user behind them.
- A create whose response has no top-level `id` is logged without an
  entity id.
- `tasks.bulk.preview` and `ai.query` are POSTs that change nothing, but
  they still show up as actions.
