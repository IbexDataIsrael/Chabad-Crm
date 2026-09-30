# fixes82 — explain why an org can't be deleted; show org id

Requested 2026-10-01. Deleting org "System" on prod gave only a short
"can't delete" error.

**Why it's refused (prod, read-only check):** "System" is org id 3, and its only
user is `superadmin` (role superadmin), the platform admin account itself.
`routers/admin.py::_is_system_org` blocks delete, deactivate and impersonate
for any org that holds a superadmin, because deleting it would delete the admin
login and leave the system with no administrator. The block is correct; the
UI just didn't say why.

- [x] `AdminOrganizationOut` gains `superadmin_usernames` + computed
      `is_system` (test extended in `test_superadmin_lists_organizations`).
- [x] Org rows show the org id (`#3`) and a "ארגון מערכת" badge on the system org.
- [x] Delete / השבת / התחבר כארגון on the system org open a modal
      (`OrgActionBlockedModal`) explaining what the org is, why the action is
      blocked, and which superadmin accounts it holds. No request is sent.
      Live-verified locally: modal shown, zero DELETE requests.
- [x] Any other failed delete now shows the server's reason in the same modal
      instead of a toast.

Tests: test_superadmin → 13 passed. `tsc --noEmit` clean. Not committed or pushed.
