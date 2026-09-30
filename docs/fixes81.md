# fixes81 — superadmin menu, org signup time, pending-signup notification emails

Requested 2026-10-01.

## 1. Superadmin gets the same menu style as the rest of the system

Today the superadmin has no sidebar, only a "מנהל מערכת" link in the header,
and one long page.

- [x] Same `Sidebar` component as everyone else, with superadmin items:
      ארגונים (`/dashboard/admin`), חיפוש משתמשים (`/dashboard/admin/users`),
      תבניות מייל (`/dashboard/admin/email-templates`), הגדרות מערכת
      (`/dashboard/admin/settings`).
- [x] The one long page is split into those sub-pages so the sidebar highlights
      the current one. The `?approve=<id>` email link keeps working on
      `/dashboard/admin`.

## 2. Signup date + time on each organization

- [x] `organizations.created_at` already exists (set at signup) and is already
      in the superadmin API. Show it in each org row as local date + time
      (stored as naive UTC, shown in the browser's zone).

## 3. Config: emails notified when an org signup is pending

- [x] New system setting `pending_signup_notify_emails` (one or more
      addresses), superadmin-only API (not in the public `/system-config`).
- [x] Editor on the settings page: add/remove addresses, each validated.
- [x] The "new organization pending approval" email goes to these addresses
      in addition to the existing env recipients
      (`PLATFORM_ADMIN_EMAIL`, `SUPERADMIN_EMAIL`), deduplicated.

## Closeout

- §1: `app/dashboard/admin/SystemAdmin.tsx` (was `page.tsx`) takes a `section`;
  thin route pages `admin/`, `admin/users/`, `admin/email-templates/`,
  `admin/settings/`. `layout.tsx` gives the superadmin the regular `Sidebar`
  (title "ניהול מערכת", mobile drawer + desktop collapse like everyone else);
  the org-wide global search stays hidden for the superadmin (no org data).
  Live-verified locally: login lands on `/dashboard/admin`, each sidebar item
  opens its page and highlights, and the mobile drawer works.
- §2: org rows show "נרשם: <date, time>" from `created_at` (UTC → local).
  Live-verified (e.g. "נרשם: 29.6.2026, 3:48").
- §3: `GET/PUT /api/admin/pending-signup-emails` (superadmin only, validated,
  lowercased, deduped) stored as JSON in `system_settings`;
  `send_org_pending_admin(..., extra_recipients=...)`. Test
  `test_pending_signup_notify_emails` (403 for org admin, 422 invalid, not in
  the public /system-config, signup mails env + configured addresses once each).
  Live-verified add / invalid message / save / reload / remove.

Tests: test_superadmin + test_signup → 19 passed. `tsc --noEmit` clean.
Not committed or pushed.
