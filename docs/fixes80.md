# fixes80 — users: accidental suspension, rename sync, Google signup name

Reported 2026-09-30 (prod, `dashboard/users/<id>`).

## 1. Editing a user "suspends" them; they vanish from the grid; re-adding says email exists

**Findings (prod, read-only):** user 44 (`טסטר ירושלמי`, public signup 14:31) had
`is_active = false` after an admin rename at 16:19. The rename endpoint
(`PUT /api/users/{id}`) never touches `is_active` (reproduced via API for
staff / admin / linked activist, always stays active). The only writers of
`is_active=false` are the "סטטוס כניסה" checkbox on the user page and the
superadmin deactivate button. The checkbox's `<label>` was `flex` (block-level),
so the **entire column width (347px)** right under the name field was an
invisible one-click "suspend", with no confirmation. The grid hides inactive
users by default ("הצג משתמשים לא פעילים" off), which is why the account then
seemed to disappear.

- [x] Label → `inline-flex w-fit`: hit area is now the checkbox + its text only
      (47px). Live-verified: clicking the empty row no longer sends a PUT.
- [x] Unchecking asks for confirmation (`users.suspend_confirm`). Live-verified
      that cancel sends no PUT.
- [x] Add user with an existing email: the form now says the user exists (and
      whether they're suspended), with a link to that user's page. Live-verified.
- [x] Prod user 44 turned back on 2026-09-30 (single-row `UPDATE users SET
      is_active = true WHERE id = 44` on Neon; `RETURNING` confirmed `t`).

## 2. List-page rename doesn't show in the activist system

The activist picker (`ActivistActivityPanel.tsx`) filters out inactive users,
so this was the same suspension as §1. The rename itself reaches `/api/auth/me`
immediately (verified). An open activist session shows the new name after a
reload.

- [x] Also found `users.first_name/last_name` were never updated on rename, so
      the Google name lingered in email templates and search. Now synced
      (test `test_admin_rename_updates_split_name`).

## 3. Registration uses the Gmail name instead of the typed name

`POST /api/public/register-google` ignored the form and used Google's profile
name (user 44 was created as "zvi shmuel naiman").

- [x] `PublicGoogleRegisterRequest.full_name` is required (blank → 422) and is
      the name used for the account (test `test_google_registration_uses_typed_name`).
- [x] The form sends the typed name with the Google credential. If the name is
      blank, it tries an org-scoped Google sign-in (returning user), otherwise
      it shows "יש למלא שם מלא". The label is marked `*`.

Tests: test_fixes65 + test_users + test_fixes14 → 39 passed. `tsc --noEmit` clean.
Not committed or pushed.
