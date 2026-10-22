# fixes105 — Users: show password, username visible/editable, unique per org

## Request (verbatim)
> on users when adding a password add option to see the password. also the "user name" field cannot be seen, found or edited. show user name on /dashboard/users/57 (example) and make sure there are no username duplicates per organization. if a username is in more then 1 org show the user his orgs and let him choose (like in google email entries)

## Items
- [x] **Show-password toggle** on both password inputs: new-user form (`dashboard/users/page.tsx` UserForm) and the user page (`dashboard/users/[id]/page.tsx`). Reuses the existing `components/ui/PasswordInput` (eye icon). Live-verified: type `password` → `text` after clicking the eye.
- [x] **Username on the user page** (`/dashboard/users/{id}`): new "שם משתמש / Username" row, inline-editable (InlineEdit → `PUT /api/users/{id} {username}`; that API already existed from fixes99 but nothing in the UI used it). Live-verified: shows the username, a valid edit saves, a taken one shows the toast "Username already taken" and the field stays in edit mode.
- [x] **Username on the users list**: new `username` grid column (inline-editable, on by default); the search box also matches usernames. Note: an admin with an already-saved column preference (`users.columns`) has to turn the column on once from the column chooser.
- [x] **Username in the new-user form**: optional field (blank = the email, the existing default); checks against loaded users before submitting and links to the existing user, same as the duplicate-email check.
- [x] **No duplicate usernames per org**: a DB unique constraint `uq_user_org_username` already existed (case-sensitive). The create/update checks in `routers/users.py` now compare **case-insensitively** (`func.lower`), so "Moshe" and "moshe" can't both exist in one org. Existing rows are untouched, and there is no DB-level change.
- [x] **Same username in several orgs → org picker**: already worked (fixes14). `POST /api/auth/token` matches username *or* email, and when the password checks out for users in 2+ orgs it returns `requires_org_selection` + the org list, which the login page shows. Only orgs where the password is correct are listed. This round adds a test covering the username case (fixes14's test only covered email).
- [x] Localization rows in `seed.py`: `users.username_required`, `users.username_taken`, `users.username_hint`.

## Evidence
- `tests/test_fixes105.py` (3 new) + fixes99/fixes14/users suites: 32 passed.
- `npx tsc --noEmit`: clean.
- Live drive (playwright-core + bundled Chromium, admin JWT minted in the container) against local Docker; the test users were deleted afterwards.

## Not done
- Login match on username is still case-sensitive (`username == identifier`). Making it case-insensitive could make legacy rows that differ only in case ambiguous, so I left it unchanged.
