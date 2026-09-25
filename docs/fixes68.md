# Feature: Area Column on Report Numbers Page

This task adds an optional, sortable **Area** column to the Report Numbers table with backend endpoint support and bidirectionality (`<bdi>`) formatting.

---

## 1. Requirements & Core Behavior

* **Column Visibility & Preferences:**
  * Add an "Area" column option to the existing display-column controls.
  * Default to **ON** for users without saved preferences. Preserve existing saved user preferences without modification.
* **Cell Content & Layout:**
  * Display area names as clickable links to their respective area pages.
  * Wrap area name text inside `<bdi>` tags to preserve proper text direction (RTL/LTR mixed content).
  * If no area is associated, display `"—"`.
* **Multi-Area Resolution Logic:**
  * **Path:** `Report Number` ➔ Active Apartments (`is_display = True`) ➔ Associated Buildings ➔ `Building.area_id`.
  * Display all associated areas. Order areas by highest building count first.

---

## 2. Backend Implementation

* **File to Modify:** `backend/app/routers/report_numbers.py` (+~50 lines)
* **New Endpoint:** `GET /api/report-numbers/areas`
  * **Access:** Admin-only (`require_admin`).
  * **Route Ordering:** Declare *before* parameter routes like `/{report_number_id}`.
  * **Response Format:** `{ "report_number_id": [{ "id": "<area_id>", "area_name": "<name>" }] }`
* **Database Schema:** No database migrations required.

---

## 3. Frontend Implementation

* **File to Modify:** `frontend/app/dashboard/report-numbers/page.tsx` (+33 / -4 lines)
* **Localization:** Set column header label using existing `sort.area` translation key.
* **Backward Compatibility:** Gracefully handle missing backend data by falling back to `"—"` if deployed before backend API.

---

## Checklist

Verified 2026-09-25: `pytest tests/test_fixes68.py` (6 new tests) + full suite
(`587 passed`, the only 5 failures are pre-existing `test_models.py` cases —
see Environment note below, unrelated to this feature) + `tsc --noEmit`
clean; then a live headless drive (Playwright Chromium) against the local
Docker stack + local Postgres with a temp admin/org (deleted afterwards via
the superadmin org-delete endpoint).

- [x] `GET /api/report-numbers/areas` — admin-only, declared before
      `/{report_number_id}` (confirmed via `openapi.json` route order and a
      passing `GET /api/report-numbers/{id}` call after it). Response keyed
      by `report_number_id`, each entry `{id, area_name}`.
- [x] Resolution path Report Number → active apartments (`is_display=True`)
      → Buildings → `Building.area_id` → Area; a version retired by an
      apartment edit drops out (`test_retired_apartment_version_not_counted`).
- [x] Multiple areas ordered by highest building count first — live API call
      and live UI both showed a 2-building area before a 1-building area for
      the same report number.
- [x] Frontend column: "Area" added to `OPTIONAL_COLUMNS`, defaults ON
      (`["area", "jews", "engaged"]`) for new users; existing saved
      `crm.reportNumbers.fields` prefs untouched (default only applies when
      no localStorage value exists yet).
- [x] Cell content: `<bdi>`-wrapped area name(s), comma-separated, each a
      link to `/dashboard/areas/{id}`; live drive confirmed the exact HTML
      (`<a href="/dashboard/areas/1610"><bdi>שכונת נורדאו</bdi></a>`) and a
      correctly RTL-rendered screenshot. No-area case falls back to `"—"`
      (code path, not separately screenshotted).
- [x] Header label uses `sort.area` (existing key, no new localization
      row needed) — screenshot shows "אזור ⇅" with the standard neutral sort
      indicator.
- [x] Backward compatibility: `reload()` wraps the new fetch in
      `.catch(() => ({}))` so an older-backend 404 degrades to "—" everywhere
      instead of breaking the page.
- [x] Sorting: added an `"area"` case to the grid's sort switch (sorts by
      first area name) — not explicitly required by the spec but needed
      since `OptionalColumn` feeds `SortKey` generically; otherwise it would
      silently fall through to name-sort.

Environment note: local Docker/Postgres had two **pre-existing, unrelated**
issues discovered while verifying live — fixed with the user's explicit
go-ahead:
1. `alembic_version` pointed at a deleted revision (`cfead2898e35`,
   an abandoned `visit_client_uuid` experiment) with no such file left in
   `alembic/versions`. Confirmed via schema diff that the DB already matched
   every model table/column at the real head (`f1a2b3c4d5e6`), so this was
   pure bookkeeping drift, not a missing migration — fixed by stamping
   `alembic_version` to `f1a2b3c4d5e6` (no DDL run). The leftover unused
   `visit_history.client_uuid` column/index was left in place per the user's
   choice.
2. Separately, `docker logs` never showed "Application startup complete" for
   the backend container even after the above fix — turned out to be a
   log-buffering/relay quirk of the Windows-bind-mount `--reload` supervisor,
   not a real hang (confirmed by calling `lifespan()` directly, and then by
   a real `curl` returning `200`). `test_models.py`'s 5 failures are the
   already-documented `host.docker.internal` timeout gap when pytest runs
   directly on the Windows host (not from inside Docker) — pre-existing,
   unrelated to this feature.

---
