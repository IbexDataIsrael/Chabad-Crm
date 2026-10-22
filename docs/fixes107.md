# fixes107 — server stall under load (logins failing, pages/translations timing out)

Status: **committed 6668936 — not pushed, not deployed. Further production load tests stay on hold until this is reviewed.**

## Incident (prod)
- After a load test, the frontend loaded but translations and `/api/health` timed out.
- Backend log: `QueuePool limit of size 10 overflow 20 reached, connection timed out, timeout 30.00` inside `get_current_user`.
- A backend-only restart restored service.
- A smoke test afterwards (2 users, 30s) passed; Postgres showed 7 idle connections, no lock waits.

## Round 1 (first version) and what the review found
Round 1 had: a thread cap of 25, a gate of 25 in-flight `/api` requests, `pool_timeout` 5s, a 503 on pool timeout, async login with bcrypt on its own executor, and a frontend GET timeout. The review asked for evidence and found gaps; verified in this round:

| Review point | Finding |
|---|---|
| "25 requests ≠ 25 connections" | **Confirmed.** Measured: one request held 2 connections at once (`POST /api/users`). Sessions outside `get_db` (activity log, background-task emails, error logging, scheduler) shared the pool. |
| Activity log / error logging accounted? | **No.** The two `@app.middleware` functions were added after the gate, so they were *outer* to it — their threads and sessions were uncounted. `record_error` runs in Starlette's outermost error middleware, also outside. |
| Browser timeout covers the body? | **No.** The timer was cleared when headers arrived; the caller-abort listener was never removed. |
| GET retries prolong overload? | **Yes.** It retried 503 up to 4× (1+3+6+10s), with no overall bound. |
| Login POST covered? | **No.** `login()` used a bare `fetch` with no timeout. |

## 1. Connection trace — cyclic wait vs slow requests
Instrumented production-like server: same command as the Dockerfile (1 uvicorn process, no `--reload`), local Postgres, dev backend stopped. Pool checkout/checkin events are tagged with the request that took them, sampled every second together with Postgres states, process CPU and thread-pool use.

**Baseline (committed code before fixes107), 100 users:** repeated windows of ~25s where:
- CPU was 0–1% and nothing completed;
- the pool had 30/30 checked out, and Postgres showed all 30 sessions `idle in transaction` (no query running), 0 lock waits;
- worker threads were 40/40 borrowed, with 60–128 waiting;
- all 30 connections had been held for more than 5s by requests of every route.

Progress came only in bursts when the 30s pool timeouts fired. That is a **cyclic wait broken only by timeouts**:
- holders of the 30 connections wait for a worker thread (FastAPI runs the endpoint and response validation in the shared pool, and `get_db`'s session holds its connection across those gaps);
- all 40 threads are held by requests waiting for a connection (`get_current_user`, as in the prod log).

Slow requests would instead show active queries or busy CPU, and a steady completion rate.

**bcrypt:** in the baseline, login held its connection a median of 416 ms (≈ the bcrypt time) — yes, it held a connection. Now `_login_candidates` calls `db.rollback()` before bcrypt (connection returned), and bcrypt runs on its own executor. `test_login_checks_password_off_the_worker_pool_with_no_db_connection` asserts this. Measured login checkout holds dropped to a 105 ms median (3 short checkouts).

**When the request session is closed** (read from the installed FastAPI 0.141 / Starlette 1.6 source):
- `get_db` has the default "request" scope, so it exits after `await response(...)` — after the body is sent and **after background tasks** ran;
- an exception unwinds the exit stacks (session closed) before it propagates;
- `BaseHTTPMiddleware` waits for the inner app to finish and doesn't cancel it on client disconnect (nor does uvicorn).

## 2. Changes this round
- **Connection budget split, total unchanged (30)** (`database.py`):
  - request pool **25** (`get_db` only);
  - side pool **5** (`SideSessionLocal`) for every session opened outside `get_db`: `activity_log._session`, `activist_emails` (background tasks), `error_log` (`record_error` + background handler), `scheduler.scan_reminders`.

  Side work is one short operation that never waits on a request, so it can't join a cycle. Request pool timeout 5s; side pool 15s (no cycle, so waiting is safe and keeps a welcome email from being dropped).
- **Gate = 25 = request pool** (`core/concurrency.py`). Middleware order is now (outermost first) GZip > CORS > gate > activity-log middlewares > routes: CORS wraps the gate's 503, and activity-log work runs inside an admitted request.
  - Queue timeout 15s → 503 + `Retry-After: 5`; the handler is never entered.
  - `/api/health` and `OPTIONS` are never queued.
  - The slot is released when the inner app returns, i.e. after `get_db` closed the session.
- **Thread cap removed.** With the gate matching the request pool, no thread ever waits on the request pool, so the thread count is no longer part of the cycle. anyio's default of 40 stays (measured peak 25, 0 waiting).
- **Error logging** (`error_log.py`): a shared non-blocking cap of 2 DB writes (`_DB_LOG_SLOTS`) for `record_error` and the background handler; over the cap the error goes to the server log only. It uses the side pool.
- **Unchanged from round 1:** pool timeout → 503 "Server is busy, please try again" without writing the error log; async login with bcrypt on `ThreadPoolExecutor(cpu_count)`.
- **Frontend** — new `lib/fetchPolicy.ts` (alias-free, unit-tested), used by `apiFetch` and `login()`:
  - one timer covers headers **and body**; the timer and caller-abort listener are always removed;
  - GET: one 30s budget across all attempts;
  - 503: at most **one** retry, after Retry-After + up to 1s jitter, only if it fits the budget;
  - 502/504/network: at most 2 retries (1s, 3s), within the budget;
  - writes: no default budget, never retried;
  - `login()`: 30s budget (headers + body), no retry.

Tried and removed: the gate also closing any still-open tracked request sessions before release, against cancellation. A counterfactual run showed the cancellation test passes without it (the connection is returned before the slot either way), so it wasn't kept.

## 3. Tests
- `tests/test_fixes107.py` (16):
  - budget split and total;
  - gate limit = request pool, and middleware order (CORS > gate > activity log);
  - side sessions use the side pool;
  - against a real FastAPI app + real QueuePool (file SQLite), checkout/checkin/release order on success, error, background task (bg runs before checkin, inside the slot) and cancellation;
  - queue timeout → 503 and the handler is never entered;
  - 200-request storm with timeouts + cancellations → slots fully restored;
  - health/OPTIONS not queued;
  - **real app 503 carries CORS headers** (and a preflight passes);
  - pool-timeout detection; pool timeout → 503 without the error log;
  - error log never waits for a slot;
  - login bcrypt off the worker pool with no open transaction; 401s unchanged.
- `frontend/lib/fetchPolicy.test.mjs` (11):
  - body stall times out;
  - never-answering request times out;
  - timer and listener removed on success and failure;
  - caller abort passed through;
  - 503 retried once (Retry-After + jitter), never twice;
  - no retry past the budget;
  - 502/504/network ≤ 2;
  - persistent 503 → one retry then returned;
  - budget spans attempts;
  - writes never retried.
- **Results:**
  - `tests/test_fixes107.py` 16/16;
  - frontend node tests 26/26; `npx tsc --noEmit` clean.
  - Full backend suite (`pytest -q --ignore=tests/test_models.py`, backend container):
    - run 1: 737 passed, 1 skipped, **1 failed** — `test_fixes102.py::test_actions_are_logged_when_enabled`, whose assertion diff wasn't captured (only the last 6 lines of output were kept);
    - run 2: **738 passed, 1 skipped**;
    - the file alone passes 8/8; test files 1–10 in order (through fixes102) pass 94/94; fixes107 then fixes102 passes 24/24.
    - **Intermittent, cause unknown.** That test reads activity-log rows written via `activity_log._session()`, which this patch moved to `SideSessionLocal` (patched to the test DB in conftest), so a link to fixes107 isn't ruled out.
  - `tests/test_models.py` not run: it uses `app.database.engine` directly and needs a real Postgres.

## 4. Local load tests (exact settings)
- **Server:** `python /harness/serve_instrumented.py` = `uvicorn.run(app, 1 process, no reload)` in a separate container of the backend image (`docker compose run -p 8002:8000`), local Postgres 18 with the real ~26k-apartment org 1 data, dev backend stopped, 12 CPUs available.
- **Client:** Node 26 `fetch`, closed loop (no think time), 30s client timeout per request, admin JWT, one test login user.
- **Mix:** login 15%, `/api/apartments/list?page=1&page_size=20` 25%, `/api/apartments` 10%, `/api/search?q=כה` 15%, `/api/apartments/{id}` 15%, `/api/metadata/localization` 15%, `/api/health` 5%.
- **Phases:** load → drain in-flight → recovery probes (health, translations, list, login once per second, no other traffic).

| Run | Requests | Success | Statuses | Stall windows | Recovery after traffic stops |
|---|---|---|---|---|---|
| Baseline (pre-fixes107), 100 users, 40s | 290 | ~32% (login 6%) | 200 / client timeouts | yes, ~25s at 0% CPU | 2s after drain (backlog cleared), no restart |
| Fixed, 100 users, 40s | 867 | **100%** | all 200 | none (~20 ok/s steady) | immediate (probe second 0) |
| Fixed, **400 users**, 40s (overload) | 1,380 | 67–80% per route; health 100% | 200 + **fast 503s** (0 client timeouts) | none (~18 ok/s steady) | immediate, no restart |
| Fixed, 100 users, 30s, 50% tracked writes (activity log on) | 550 | **100%** | all 200 | none | immediate |

Server-side peaks:

| Run | Request pool | Side pool | Gate | Threads (waiting) | Held > 5s | Max request-pool conns / request |
|---|---|---|---|---|---|---|
| Fixed, 100 users | 25 | 1 | 25/25, queue 75 | 25 (0) | 0 | 1 |
| Fixed, 400 users | 23 | 0 | 25/25, queue 379 | 24 (0) | 0 | 1 |
| Fixed, writes | 25 | 3 | 25 | 25 (0) | 0 | 1 |

- Writes run: all 264 writes produced their activity-log row.
- No `QueuePool` / "pool exhausted" / "error log busy" lines in any fixed run (the baseline had 195).
- After each run: pool 0, gate 0/25, threads 0, Postgres only idle connections.
- Local data was restored afterwards: activity log pref off, test rows and test user deleted.

## Proven vs uncertain
**Proven locally:**
- The stall is a cyclic wait between worker threads and pool connections, not slow requests.
- With the fix, an admitted request never waits for a connection: request pool ≤ 25, ≤ 1 per request in the measured mixes.
- The server keeps a steady completion rate under 4× overload, answering the excess with fast 503s that carry CORS headers.
- Health and DB-backed requests recover without a restart.
- Login's bcrypt holds no connection.

**Uncertain / not covered:**
- "≤ 1 request-pool connection per request" is measured for this mix, plus a code audit (only `get_db` and the disabled-by-default diagnostics endpoint use the request pool). A future endpoint that opens `SessionLocal()` directly would break the budget; no test enforces this.
- An error storm (many 500s at once) was not load-tested — only unit-tested (cap of 2, never waits).
- Queued requests whose client already disconnected still run when they get a slot (within the 15s queue limit). uvicorn doesn't cancel them; this is wasted work under overload, not a hang.
- At 400 users `/api/health` (not gated) slowed to p95 7.5s — the event loop and CPU were saturated. It still answered.
- Login under a burst holds gate slots while waiting for CPU on the bcrypt executor (no DB connection). With few cores, a login burst can delay other requests. bcrypt cost (12) unchanged.
- Production differs (VPS cores, network, Postgres config). These are local numbers; the prod load test is pending review.
- One intermittent full-suite failure in the activity-log test (see Results) — not explained.
- Not deployed; nothing committed.
