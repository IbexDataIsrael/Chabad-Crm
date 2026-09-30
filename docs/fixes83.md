# fixes83 — superadmin: clone fix, cross-org logs page

Requested 2026-10-01.

## 1. "Clone" doesn't work

**Cause (prod error_logs #1, 2026-09-30 21:43, POST /api/admin/organizations/1/clone → 500):**
`UniqueViolation ix_visit_history_client_uuid`. The clone copies every column
except id/guid. `visit_history.client_uuid` (the offline-sync dedupe key) is
**globally** unique, so any org with synced visits could never be cloned.

A scan of every table in the clone plan also found three silent cross-org leaks,
where the copy kept pointing at the SOURCE org's rows:
`visit_history.apartment_id`, `contact_shliach.root_id` (version lineage) and
`apartments.campaign_id` (campaigns aren't cloned). `buildings.building_type_id`
is fine (global lookup table).

- [x] `core/org_clone.py`: `client_uuid` + `campaign_id` nulled on the copy;
      `VisitHistory.apartment_id` → cloned apartments; `ContactShliach.root_id` → self.
- [x] Tests: the rich-org fixture visit now has a `client_uuid` + `apartment_id`.
      Without the fix the suite fails with the exact prod error; with it, 9/9 pass.
      New `test_clone_rewires_activist_version_lineage`.
- [x] Real local Postgres clone of org 1 (apartments capped at 300): 201,
      0 visits pointing at another org's apartment; copy deleted after.
      Note: it took ~34s even capped. An uncapped clone of prod org 1
      (~24k apartments) may be slow.

## 2. Logs for the superadmin, with org names

- [x] `/api/logs/access` and `/api/logs/errors` rows carry `organization_name`
      (the superadmin already saw all orgs; org admins stay org-scoped).
- [x] Logs UI moved to `components/LogsView.tsx`. `/dashboard/logs` (org admin)
      is unchanged; new `/dashboard/admin/logs` (`platform` mode) adds an "ארגון"
      column / chip ("#3 System") and an organization filter, and hides the
      per-org error-email card. New sidebar item "לוגים".
- [x] Test `test_superadmin_sees_every_orgs_logs_with_org_name`.

## 3. Failed superadmin actions (like clone) visible in the superadmin system

- [x] Unhandled errors in superadmin actions were already written to
      `error_logs` (attributed to the superadmin's own org, "System" #3). The
      new page shows them, e.g. prod's clone failure appears as "#3 System ·
      IntegrityError · POST /api/admin/organizations/1/clone".
- [x] Access-log label for fixes80's `FAILED_SUSPENDED`.

Tests: test_org_clone 9, test_fixes75 11 → all pass. `tsc --noEmit` clean.
Live-verified locally (superadmin + org admin). Not committed or pushed.
