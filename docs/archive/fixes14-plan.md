# fixes14 — Implementation Plan

Spec: `docs/fixes14.md` — user/contact sync bugs, per-org email uniqueness,
multi-org login selection, navbar full name, and a login audit log.

## Root-cause analysis

* **Bug 1 (shliach email edit not reaching `users`):** `update_contact`
  (`backend/app/routers/contacts.py`) has a contact→user sync block that copies
  `full_name` / `first_name` / `last_name` / `phone` to the linked login user —
  but **not `email`** (nor `username`, which was set to the email when the user
  was provisioned). The shliach therefore keeps logging in with the old address.
* **Bug 2 (duplicate shliach email in one org):** `_provision_shliach_user`
  looks the email up **globally** and silently reuses whatever user it finds —
  including a user in *another* org (a cross-tenant leak) or a user already
  linked to a different shliach contact in the same org. Nothing rejects a
  second shliach contact with the same email in the same org.
* **Bug 3 (users ↔ contacts desync):** the sync is one-directional and partial.
  Editing a user on the users page (`PUT /api/users/{id}`) cannot change email
  or phone at all, and nothing propagates back to the linked shliach contact.
* **Multi-org premise:** `users.email` currently carries a **global** unique
  index, and signup/user-creation checks are global — so "same email in two
  orgs" (explicitly required by the spec) is impossible today. Login matches
  `username` with `.first()`, i.e. an arbitrary row if the identifier exists
  twice.

## 1. Schema changes (`models.py` + new Alembic revision `d0e1f2a3b4c5`)

* `users.email`: drop the global unique index `ix_users_email`; recreate it
  non-unique; add `UniqueConstraint(organization_id, email)` →
  `uq_user_org_email`. (No backfill risk: emails were globally unique, so no
  per-org duplicates can exist.)
* `users.google_sub`: drop unique index → recreate non-unique (the same Google
  identity may now be bound to one user per org).
* New table **`system_access_logs`** (house style: `id` + `guid`):
  `id`, `guid`, `date` (Date), `time` (Time), `username` (String 255 — the
  identifier as typed), `status` (String 50), `created_at`.
  Index on `date`. Statuses written: `SUCCESS`, `FAILED_INVALID_PASSWORD`,
  `FAILED_NO_USER`, `FAILED_NOT_VERIFIED`, `FAILED_ORG_DISABLED`,
  `ORG_SELECTION_REQUIRED`.

## 2. Bug fixes (backend)

### 2.1 Contact → user email sync (`update_contact`)
Extend the existing sync block: when the shliach contact's email changed,
* reject with 400 if another user **in the same org** already has that email;
* set `user.email`; if `user.username` equaled the old email, move it to the
  new email too (guarding the per-org username constraint).
Empty contact email does **not** blank the login email (it's the auth identity).

### 2.2 Per-org uniqueness (per spec: unique *within* an org, free *across* orgs)
* `_provision_shliach_user`: scope the reuse lookup to the org
  (`organization_id == org_id`) — never link a user from another tenant.
* New guard `_check_shliach_email_unique`: creating/updating a shliach contact
  whose email is already used by **another shliach contact in the same org** →
  400 (Hebrew detail). Also reject provisioning when the same-org user with
  that email is already linked to a different shliach contact.
* `users.create_user`: duplicate-email check becomes org-scoped.
* `auth.signup`, `auth.google_signup`, `admin.create_organization`: these
  create a **new** org, so an email existing in *other* orgs no longer blocks
  them (this is exactly how one email becomes linked to several orgs).
* `resend_verification`: loop over all unverified users with the email (may now
  be several across orgs) instead of `.first()`.

### 2.3 User → contact sync (`update_user`)
* `OrgUserUpdate` gains `email` + `phone`. Email change is validated per-org.
* When the user is linked to a shliach contact (`ContactShliach.user_id`),
  propagate `email` / `phone` to the contact row (and keep username in step
  with the email as in 2.1).
* Names remain **contact → user** only: the contact holds structured
  first/last fields, the user only a single `full_name`; reverse-splitting a
  Hebrew full name is lossy. The contact form stays the canonical place to
  rename a shliach.

## 3. Features

### 3.1 Multi-org login selection
* `POST /api/auth/token` (password) — new optional form field
  `organization_id`:
  1. Candidates = users where `username == identifier OR email == identifier`.
  2. Verify the password against each candidate (**credentials first** — org
     names are never revealed for a wrong password).
  3. Eligible = verified candidates that pass the active/verified/org-active
     gates. One eligible → token (as today). Several eligible orgs and no
     `organization_id` → `200 {requires_org_selection: true, organizations:
     [{id, name, logo_url}]}` and **no token**. With `organization_id` → log
     into that org's user only.
* `POST /api/auth/google`: same interception — all users with the Google
  email; `GoogleLoginRequest` gains optional `organization_id`.
* Response schema `LoginResponse` (supersedes `Token` on these two routes):
  `access_token?`, `token_type`, `requires_org_selection`, `organizations[]`.
* Frontend (`lib/api.ts`, `lib/auth.tsx`, `app/page.tsx`): `signIn` /
  `signInWithGoogle` return the org list when selection is required; the login
  card switches to an organization picker (logo + name buttons); choosing one
  re-submits with `organization_id`. The Google credential is kept in state
  for the second call.

### 3.2 Navbar full name from the contacts table
* `GET /api/auth/me` returns a new `display_name`: resolved from the linked
  shliach contact (via `ContactShliach.user_id`), else a same-org contact with
  the user's email, else `null`. Built as "first last" from
  `contact.name` + `contact.last_name`.
* `UserOut.display_name: Optional[str]` (None on other UserOut routes).
* Navbar (`dashboard/layout.tsx`): `display_name || full_name`.

### 3.3 Access audit log
* Model per §1. Helper `_log_access(db, username, status)` in the auth router
  commits a row **before** any HTTPException is raised; called on every
  password/Google login outcome (success and each failure class, plus the
  org-selection interception). No UI/read endpoint (not in spec, no
  over-engineering).

## 4. Localization (RULE: every Hebrew UI string gets a seed row)
New `auth.*` keys: `auth.select_org_title` (בחירת ארגון),
`auth.select_org_subtitle`, `auth.select_org_back`; `users.phone` label if
missing. Added to `LOCALIZATION` in `seed.py`.

## 5. Tests (`backend/tests/test_fixes14.py`)
1. Editing a shliach contact's email updates `users.email` (+`username`).
2. Second shliach contact with the same email in the same org → 400.
3. Same email in two orgs is allowed; `_provision_shliach_user` never links a
   user from another org.
4. `PUT /api/users/{id}` email/phone change propagates to the linked contact.
5. Same email+password in two orgs → `/token` returns `requires_org_selection`
   with both orgs; retry with `organization_id` → token for that org (`/me`
   confirms); wrong password → 401, no org list.
6. Every attempt writes a `system_access_logs` row with the right status.
7. `/me.display_name` comes from the contact row.

Existing tests updated for the new spec: `test_auth.py::
test_duplicate_email_rejected` and `test_signup.py::
test_signup_duplicate_email_rejected` asserted **global** uniqueness — they now
assert the per-org rule instead.

## 5b. Mid-implementation user report: "shliach users can't log in"

Root causes found and fixed alongside the plan:
* `_provision_shliach_user` created the login **Google-only**
  (`password_hash=None`) while the welcome email tells the shliach to "sign in
  with your email" — with Google sign-in unavailable there was **no** working
  path in.
* Worse, a password attempt against the `None` hash made passlib **crash the
  login endpoint (500)** — fixed by the §3.1 rewrite (`password_hash and
  verify_password(...)` → clean 401).
* The users-page edit modal always sent `role: "staff"` for a shliach account,
  silently demoting it on any edit (e.g. when an admin tried to set a
  password there). Backend now ignores `role` for shliach users; the modal
  shows the role as fixed.

New capability: the shliach section of the contact form has an optional
**password** field (create + edit; empty keeps the current password), carried
as `ShliachData.password` and hashed into the login user. Covered by
`test_shliach_password_enables_login`.

## 5c. Prod incident: /api/auth/google 403 for some users

Google's ID token always carries the email **lowercased**; the login lookup was
case-sensitive. Prod user 13 (`Mivtzoimsb5786@gmail.com`, provisioned from a
shliach contact — that path stored the email verbatim) could therefore never
match → 403 "לא נמצא משתמש עם כתובת אימייל זו".

* **Data fix (applied directly to Neon):** lowercased the email (and the
  username, which mirrored it) on `users` id 13 and `contacts` id 233 — works
  with the currently deployed code, no deploy needed for this user.
* **Code hardening:** `_normalize_email` field validator stores emails
  lowercased on every input schema (contacts, signup, register, org users,
  resend); login (`/token`, `/google`, resend) and the provisioning/sync/dup
  helpers match emails with `func.lower(...)` so legacy mixed-case rows keep
  working. Regression tests: `test_emails_are_stored_lowercase`,
  `test_legacy_mixed_case_email_row_still_logs_in`.
* Related observation: prod user id 8 has **no email at all** — Google login
  cannot work for that account by definition (password/username only).

## 6. Out of scope / decisions
* No read UI for the access log (spec asks only for the table + writes).
* Full-name propagation user→contact intentionally omitted (lossy split, see
  2.3).
* CLAUDE.md's SQLite note is stale (prod = Postgres/Neon); migration targets
  Postgres, tests keep running on the in-memory SQLite `create_all` schema.
