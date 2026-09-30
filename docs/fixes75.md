MINICRM - FIX LIST 2

Work in the existing minicrm repository. Read the current code first; the notes below describe requested changes and the current code may differ. Make small commits. Do not push or deploy. When done, stop for review and report what changed by item number. If a fix needs a product decision that is not covered here, stop and ask before coding that part.

1. BUG - USER NAME NOT UPDATING IN ACTIVIST SYSTEM
After changing a user's name, the old name still appears in the activist system. Probably a wrong correlation between the users table and the activist table. Fix the join so the activist system always shows the current name from the users table. The users table is the source of truth - do not store a second copy of the name that can go stale.

2. TASKS - SHOW ASSIGNED REPORT NUMBERS AS SELECTED
When adding a new task and selecting report numbers, report numbers that are already assigned to a task should appear as selected in the select box.

3. SUPERADMIN - RESET USER PASSWORD
Add an option for the superadmin to reset a user's password.

4. ADMIN - ERROR LOG IN DATABASE
Add an error log saved in the database.

5. ADMIN - USER ENTRY LOG IN DATABASE
Add a user entry log in the database: every login attempt, successful or failed, with user, time, and IP address.

6. ADMIN - LOGS SECTION
Add a logs section for the admin role to view the content of both logs (error log and entry log).

7. LOGIN PAGE - FORGOT PASSWORD
Add a "forgot password" mechanism so users can reset their password by email. First check if the project already sends email somewhere. If there is no working email sending, stop and report before building this - do not invent an email setup.

8. LOGIN PAGE - HARDCODED ENGLISH ERRORS
On failed login in the Hebrew version, the error shows in English: "Incorrect username or password". Move this and all other login-related messages into the translation system. No hardcoded login messages.

9. NEW FEATURE - ERRORS ADMIN EMAILS
Add a setting "Errors Admin Emails": a list of one or more email addresses. When an error happens: write it to the error log (item 4) AND send an email to every address on the list. Same email-sending check as item 7 applies.

10. EDITED USER EMAIL - SEND WELCOME EMAIL
On the users page, when a user's email address is edited, send the welcome email to the new address, the same email a new user gets. This was requested before and is still not happening - find out why the edit flow does not trigger it and fix it.

11. DELETING A USER - CLEAN UP BINDINGS
Activists can be bound in TWO ways: to tasks, and directly to report numbers and areas. BOTH models are permanent - do not remove or deprecate the direct report-number/area binding. This system serves many organizations; most do not use report numbers and work with "area" at most. (Later, a superadmin will be able to enable/disable features per organization - not in this round.)
Today, deleting a user who has assigned tasks FAILS with a database error. Change the delete flow:
a. Unassign all the user's tasks - those tasks become unassigned (פנוי).
b. Clear the deleted user's own report-number and area bindings (the binding feature itself stays fully working for everyone else).
c. History stays: paper entries, building completions, and edit-history rows keep their records with the user reference cleared.
After the change: deleting any user succeeds, with no orphans and no blocked deletes.

NOT IN THIS ROUND
- Text file error log with superadmin-only access: deferred until the move to our own server (VPS), because files do not survive on Vercel.

Relevant areas: users/activists tables, /dashboard/tasks new-task form, superadmin screens, admin screens, login page.

---

## Closeout (2026-09-30) — done locally, committed, NOT pushed

All tests pass. The full backend suite passed; `tests/test_fixes75.py` has 10 new tests. `tsc --noEmit` is clean. Each item below was also checked live against local Postgres, and the UI items were driven in a real browser (Playwright).

- [x] **1. User name not updating in activist system.** The cause: `GET /api/auth/me` built `display_name` (the activist header and greeting) from the linked **contacts** row. That is a second copy of the name, and it drifted: 9 local users had a contact name that no longer matched `users.full_name`. Now `display_name` is `users.full_name`. The activist names shown on the admin's messages-from-activists page and in the report-number and area conflict warnings also come from the users table when the contact has a login (new `core/shliach.activist_names_by_contact`). No second copy is stored. Commit `5ad5299`.
- [x] **2. Tasks: assigned report numbers shown as selected.** In the new-task form, the report numbers that already belong to a task *in the chosen campaign* are shown checked, locked, and at the top of the list, marked "כבר במשימה". They are also counted in the picker's summary, and a hint explains them. They are not sent with the new task. A number already in a task can't join a second task in the same campaign (the fixes74 conflict rule), so they are view-only. Commit `6f5e170`.
- [x] **3. Superadmin: reset a user's password.** There is a new "איפוס סיסמה" button on every user row in /dashboard/admin, both in the org user lists and in the user search. It opens a dialog for the new password. The backend endpoint is `POST /api/admin/users/{id}/reset-password` (superadmin only; same strength rule as change-password). Verified live: I reset a password, then signed in with it.
- [x] **4. Error log in the database.** New `error_logs` table (migration `75d1e2f3a401`). Every unhandled error (a 500) is recorded with its time, org, user (from the bearer token), method and path, error type and message, traceback, and IP. The response now carries `error_id`. Verified live on Postgres with a real exception.
- [x] **5. User entry log.** This builds on the existing `system_access_logs` (fixes14), which already recorded every attempt. It now also stores the **IP** (the first `X-Forwarded-For` entry, which is the real client behind Render's proxy), the **user** and the **organization**. User and org are set when the typed identifier resolves to exactly one of each; a failed attempt for an unknown username can't be attributed to an org.
- [x] **6. Logs section for the admin.** New page /dashboard/logs with a "לוגים" entry in the admin nav. It has two tabs:
  - **Entry log:** time, typed username, user, IP and result. You can filter by success or failure, search, and page through it.
  - **Error log:** time, error, request and user, with the traceback shown on demand.

  An org admin sees only their own organization's rows. The API (`/api/logs/access`, `/api/logs/errors`) also lets the superadmin see all of them.
- [x] **7. Forgot password.** Email sending already works: SMTP in `core/email.py`, the same channel as the welcome emails. There is now a "שכחת סיסמה?" link on the login page and on the org sign-in page. It leads to /forgot-password, which emails a reset link, and the link opens /reset-password. How it behaves:
  - The link is valid for 60 minutes.
  - It is single-use, because it stops working once the password changes.
  - The page gives the same answer whether or not the address exists.
  - The same address gets at most one reset email per minute.
  - The reset token can't be used to log in.

  The email is a new superadmin-editable template, `password_reset`. ⚠️ Known risk (see memory prod-deploy-env-and-email): Gmail has in the past spam-filtered *link-bearing* mail sent from the personal sender address, which is how the verification mail got lost.
- [x] **8. Login messages translated.** Login-flow errors now carry a translation key (`detail: {code, message}`). The UI shows `t(code)`; it never shows the backend's English text. This covers wrong credentials, email not verified, org pending or disabled, the Google errors, an invalid reset link, a weak password, and network failure. It applies on the login page, the org sign-in and join forms, and the verify page. All keys are seeded in `seed.py` LOCALIZATION. Verified live: Hebrew UI shows "שם משתמש או סיסמה שגויים"; English UI shows "Incorrect username or password".
- [x] **9. Errors Admin Emails.** This is an org-level list, edited on the Logs page's error tab. Every server error is written to the error log (§4) and emailed to every address on the list. An error with no org behind it goes to `PLATFORM_ADMIN_EMAIL`. The same error (type + path) is emailed at most once every 10 minutes, so a storm can't flood the inboxes or get the Gmail account blocked. Verified live: Gmail accepted the alert.
- [x] **10. Welcome email when a user's email is edited.** The users page (`PUT /api/users/{id}`) *does* send it. I confirmed that live: Gmail accepted it. Two reasons it looked like nothing was happening:
  - A logging bug. `alembic/env.py`'s `fileConfig()` ran at startup and switched off every `app.*` and `uvicorn` logger, so the Render log showed no email lines at all, and no request lines either. Fixed in `1e7b2ed`.
  - A second edit path that never sent it. Changing the email on the activist's **contact form** also changes their login email, but it sent no welcome email. It now does. Commit `34f62ad`.

  If an address still doesn't receive it after this deploys, the Render log will now show `send_email START/SUCCESS/FAILED` for it.
- [x] **11. Deleting a user.** Both the org admin's delete and the superadmin's use the new `core/user_delete.clear_user_references`:
  - (a) The user's tasks go back to the pool as unassigned (פנוי). A COMPLETED task keeps its status; only the user reference is cleared.
  - (b) The user's own report-number and area bindings are cleared, as a new shliach version, so the history still shows what they had. The binding feature is untouched for everyone else.
  - (c) Paper entries, building completions, and apartment and shliach edit history keep their rows, with the user reference cleared.

  The superadmin's delete dialog now also lists the number of assigned tasks. Before the fix, the delete failed on `tasks_volunteer_user_id_fkey`. Verified on real Postgres: a user with an assigned task deletes (204), and the task comes back AVAILABLE. Commit `56f9e38`.

**Also fixed along the way:** an email-verification token could be used as a login token, because it carries the same `sub` and the access-token decoder never checked the token type. The decoder now rejects any token that has a `type` claim.

**Choices I made that the spec didn't cover (easy to change):**
- The logs are org-scoped for org admins.
- Errors Admin Emails is a per-org list; errors with no org go to `PLATFORM_ADMIN_EMAIL`.
- Error emails are throttled to one per error per 10 minutes.
- Street-activity log rows (fixes74) are still deleted along with a deleted user (existing ON DELETE CASCADE); they were not on the spec's list of history to keep.

**Deploy note:** migration `75d1e2f3a401` (after `74c3e1a4d523`) must run on Neon. It runs automatically at startup.
