# fixes29-urgents — Urgent Prod Bugs: Contacts & Mivtzoim Filter

## Status: RESOLVED (code + prod data), pending one user action

**⚠️ USER ACTION REQUIRED: the Render backend service is SUSPENDED (owner
suspension — `https://minicrm-3xtt.onrender.com` returns 503 "Service
Suspended by its owner"). Nothing in prod works until it is resumed from the
Render dashboard.** Good news: Neon is already migrated to the current head
(`c5d6e7f8a9b0`), so resuming + deploying current `main` runs **no**
migrations — the fixes25 destructive step already happened safely. A fresh
full Neon dump was archived first: `backups/neon_backup_fixes29urgents_20260716.sql`.

---

## Root causes found (verified on a copy of the production database)

The prod DB (Neon, 118 contacts, org 1 «חבד שיפסד-ביי» = 109 mekuravim) was
dumped and restored locally; a backend was booted against the copy and probed
as org-1 `admin` and staff logins. The API itself is healthy — no 500s, no
truncation, no serialization errors: an unfiltered
`/api/contacts/list?contact_type=mekurav` returns all 109.

### Issue 1 — Contacts not displaying all items
The frontend's **owner filter defaulted to the logged-in user** (fixes11
§2.2). In org 1, 107/109 contacts are assigned to the `admin` login, so:
- `admin` saw 107 of 109 (verified: `assigned_user_id=<admin guid>` → 107);
- staff logins (jmcsbay, yonaiman) saw **0** (verified: 0 with the default
  filter, 109 without) — "the UI displays a subset (or none)" exactly.

Two aggravators made the narrowing invisible:
- fixes29 §1 lets the whole filter section collapse while filters keep
  applying — nothing on screen hinted the list was filtered;
- a persisted `pipeline_status` selection kept filtering even after the org
  hid the field (org 1 hides `contacts.pipeline_status`), with its dropdown
  no longer rendered — unclearable. (Same class fixes28 §3 fixed for mitzvot,
  missed for status/admin-areas.)

### Issue 2 — Mivtzoim filter missing most options
Org 1's `field_settings` had **all seven `visits.*` fields explicitly hidden**
(`tefillin, tzedakah, shabbat_candles, torah_pamphlet, letter_in_torah,
torah_thought, connection_to_rebbe` — rows id 15–21, written via the admin
toggle UI that shipped with the fixes20–28 frontend deploy). Under fixes27
§4 / fixes28 §3, hidden visit fields are removed from the מבצעים filter
options — leaving only the 2 custom fields (`hanuka_party`, `Kesher_Larabi`).
Verified on the prod copy: `/api/field-settings` returned the 7 hidden rows.
This also removed the mivtzoim checkboxes from visit forms/cards.

---

## 1. Issue 1: Contacts Not Displaying All Items

### Diagnostics & Investigation
- [x] **Verify API Response payload** — backend returns the complete list
  (109/109 unfiltered on prod copy); pagination envelope correct; zero 500s.
- [x] **Inspect Frontend State Management** — state binds whatever the server
  returns; no hardcoded limit. Found (and fixed) a stale-response race: the
  first fetch fired before field-settings loaded and its late response could
  overwrite the corrected refetch with an empty page.
- [x] **Check Client-Side Logic** — implicit default filter confirmed as the
  cause: owner filter auto-defaulted to the logged-in user.

### Execution & Fix (frontend `contacts/page.tsx`, commit this round)
- [x] Owner filter now defaults to **"" (all users)**; the fixes11 §2.2
  default-to-self is removed. New storage key `crm.contacts.assigned2` so
  browsers with the old persisted auto-default reset once. The stale-guid
  reset (fixes17 §5.1) now resets to "" instead of the current user.
- [x] `effectiveStatus` / `effectiveAdminAreaIds`: a hidden pipeline-status
  field or a shliach's inaccessible admin-area filter no longer sends
  persisted values the user can't see or clear (fixes28 §3 pattern).
- [x] Active-filter **count badge** on the collapsed "הצג סינון" button, and a
  filtered-empty-state message with a one-click **"נקה את כל הסינונים"**
  button (both strings seeded in `seed.py` LOCALIZATION).
- [x] List fetch waits for field settings and drops out-of-order responses
  (`fetchSeq` guard) — no more empty-list flash/overwrite.

## 2. Issue 2: Mivtzoim Filter Missing Most Filter Options

### Diagnostics & Investigation
- [x] **Check Filter Options Endpoint** — options = static `MIVTZOIM_FLAGS`
  gated by `/api/field-settings` visibility + `/api/custom-fields`. Both
  endpoints healthy on the prod copy.
- [x] **Verify Dynamic Extraction Logic** — extraction correct; the options
  were removed *by design* (fixes27 §4) because the org's 7 `visits.*` rows
  were flipped to hidden in prod.
- [x] **Inspect UI Render Logic** — no render bail-out; empty states render
  fine.

### Execution & Fix
- [x] **Prod data restored**: `UPDATE field_settings SET is_visible = TRUE`
  for the 7 `visits.*` rows of org 1 on Neon (7 rows updated, re-queried and
  confirmed). Mivtzoim options, visit-form checkboxes and visit-card flags
  all return once the backend is resumed. Full pre-change dump archived in
  `backups/`.
- [x] No schema/extraction change needed — keys unchanged.
- [x] Empty states handled (filtered-empty-state + clear-all above).

## 3. Verification & Regression Prevention
- [x] **Local Integration Test** — prod copy (PG18 container) probed via API:
  109 unfiltered / 107 owner-filtered / staff 0→109; 7 hidden `visits.*`
  reproduced the missing options. Plus a 9/9 headless-Chrome drive on the
  local stack: default owner filter shows other-owner contacts, מבצעים shows
  all 5 base flags, no-match search → filtered empty state → clear-all
  restores, hidden+persisted status does NOT narrow the list (request
  captured without `pipeline_status`), collapsed toggle shows the badge.
- [x] **Sanity Check** — query params verified in the drive (request URL
  capture); 320 backend tests pass; `tsc --noEmit` clean (Vercel-build rule).

## Follow-up (user request, 2026-07-17 chat)
- [x] **Clear-all always available:** the customer's list silently shrank to
  24 via a saved פוטנציאל לצדקה="1" filter (browser localStorage; data intact
  — 24/109 contacts carry that value). The "נקה את כל הסינונים" button now
  renders in the contacts page header whenever any filter is active — not
  only on an empty result — and works with the filter section collapsed.
  Verified 4/4 headless checks (button visible collapsed, filter applied,
  cleared from request, full list restored); tsc clean. Uncommitted — the
  user commits/pushes themselves.

## Not done / follow-ups
- **Resume the Render service** — owner-only action (no API key available
  locally). After resume, verify `https://minicrm-3xtt.onrender.com/docs`
  and that the deployed commit is current `main`.
- The visits page has the same collapsible filter section but no badge /
  clear-all affordance yet — candidate for a future round.
- Who flipped the 7 `visits.*` toggles in prod is unknowable from data
  (field_settings has no timestamps; each hide is an individual admin PUT).
  If it recurs, consider an access-log entry or timestamps on field_settings.
