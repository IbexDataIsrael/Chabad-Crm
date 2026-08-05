# Code Review Fixes — Plan

Source: `docs/CODE_REVIEW.md` (antgravity's review). Triaged against the
current codebase (not all findings are still accurate/actionable — noted
below) before writing this plan, per project convention.

## Triage

| Finding | Status | Action |
|---|---|---|
| Diagnostic endpoints unauthenticated | **Confirmed** — `/api/_diagnostics/superadmin` leaks username/active/verified flags, `/api/_diagnostics/tables` leaks schema, both open to anyone | Fix now |
| CORS regex accepts any `*.vercel.app` | **Confirmed** — `allow_origin_regex=r"https://.*\.vercel\.app"` + `allow_credentials=True` means any Vercel-hosted site can make credentialed requests | Fix now |
| No SQLAlchemy connection pooling | **Stale** — `backend/app/database.py` already sets `pool_pre_ping=True, pool_size=10, max_overflow=20` for non-SQLite engines | No action — note as already resolved |
| Missing composite indexes | **Confirmed** — `contacts` has individual indexes on `organization_id`/`assigned_user_id` but no composite; `visit_history.visit_date` has no index at all despite being the primary date-range filter | Fix now (additive migration) |
| Router monoliths (contacts.py 1492 lines, apartments.py 1010, models.py 993) | **Confirmed**, sizes verified | **Deferred** — a service/repository extraction touching the CRM's two busiest routers is a large, behavior-risking refactor across 395 backend tests + the frontend that consumes them; not something to attempt opportunistically inside a bug-fix pass. Flagging as a real, standalone future initiative rather than doing a rushed partial extraction. |
| JWT in `localStorage` vs. `httpOnly` cookies | Confirmed as designed | **Deferred** — this is an auth-flow architecture change (cookie issuance, CSRF token handling, SameSite/cross-site considerations for the Vercel/Render split-domain deployment), not a contained fix. Flagging for a dedicated round with explicit sign-off given the blast radius (every authenticated request). |
| "Finalize SortableJS drag-and-drop overhaul (docs/fixes39.md)" | **Stale** — fixes39 shipped this already (`frontend/lib/useSortableList.ts`, live-drive verified) | No action — checklist item in the review is outdated |

## Scope for this round

1. **Gate diagnostic endpoints** behind an `ENABLE_DIAGNOSTICS` env flag
   (default `False` — secure by default in any environment that doesn't
   explicitly opt in, e.g. Render unless set). Local `backend/.env` gets it
   set to keep using them for deploy-sanity checks.
2. **Narrow the CORS regex** from "any `*.vercel.app`" to this project's
   actual Vercel project (`minicrm*-ibexdata.vercel.app`), configurable via
   an env var so a project rename is a config change, not a code change.
3. **Add composite indexes**: `(organization_id, assigned_user_id)` on
   `contacts`, `(organization_id, visit_date)` on `visit_history` — one
   additive Alembic migration, no data change, safe to run against the live
   Neon DB.

Backend tests + `tsc --noEmit` after; live-verify the diagnostics gate and
CORS behavior don't break local dev. No commit/push without explicit ask.

---

## Status: DONE (2026-08-04)

395 backend tests passing (no regressions), frontend `tsc --noEmit` clean
(no frontend files touched this round), all 3 fixes live-verified against
the local docker-compose stack.

- [x] **Diagnostic endpoints gated.** `Settings.enable_diagnostics: bool =
  False` (`backend/app/config.py`); both `/api/_diagnostics/*` routes in
  `backend/app/main.py` are now registered only inside `if
  settings.enable_diagnostics:` — when off, the routes don't exist at all
  (not just 403'd). Verified locally with `ENABLE_DIAGNOSTICS=true` set in
  `backend/.env` (both return 200) — **this flag must NOT be set on
  Render**, so production stays closed by default.
- [x] **CORS narrowed.** `allow_origin_regex` changed from
  `https://.*\.vercel\.app` (any Vercel-hosted site) to a project-scoped
  `cors_vercel_preview_regex` matching only `minicrm*-ibexdata.vercel.app`
  (covers both the production alias and per-deploy preview URLs). Verified
  live: a preflight from `minicrm-ibexdata.vercel.app` still gets
  `access-control-allow-origin` back; a preflight from a fabricated
  `some-random-attacker-app.vercel.app` origin gets no CORS header at all
  (silently rejected, as intended).
- [x] **Composite indexes added.** New migration `f5a6b7c8d9e0`:
  `ix_contacts_org_assigned_user (organization_id, assigned_user_id)` and
  `ix_visit_history_org_visit_date (organization_id, visit_date)` — the
  latter is notable since `visit_history.visit_date` had **no index at
  all** before this, despite being the primary date-range filter for
  `visits_summary` and the contacts date-range filter. Matching `Index()`
  declarations added to the SQLAlchemy models (`Contact`/`VisitHistory`
  `__table_args__`) so the ORM metadata and the migration agree, and so
  the test suite's SQLite `Base.metadata.create_all()` creates them too.
  Verified live via `\d contacts` / `\d visit_history` in psql — both
  indexes present on the local dev Postgres DB after migration.

### Not done (deliberately deferred, not silent gaps)

- **Connection pooling** — already implemented (`pool_pre_ping=True,
  pool_size=10, max_overflow=20` in `backend/app/database.py`). The
  review's finding predates this or missed it; no action needed.
- **"Finalize SortableJS drag-and-drop overhaul (docs/fixes39.md)"** —
  already shipped in fixes39 (`frontend/lib/useSortableList.ts`,
  live-drive verified at the time). Stale item in the review.
- **Router monoliths** (`contacts.py` 1492 lines, `apartments.py` 1010,
  `models.py` 993 — sizes confirmed) — extracting a service/repository
  layer is a large, behavior-risking refactor spanning the CRM's two
  busiest routers and the 395-test suite that exercises them. Not
  attempted as a drive-by inside this fix pass; needs to be its own
  planned round with dedicated verification, not squeezed in alongside
  unrelated security fixes.
- **JWT in `localStorage` → `httpOnly` cookies** — a genuine
  auth-architecture change (cookie issuance, CSRF handling, SameSite
  behavior across the Vercel/Render split-domain deployment), touching
  every authenticated request path. Flagged for a dedicated round with
  explicit sign-off given the blast radius, not attempted here.
