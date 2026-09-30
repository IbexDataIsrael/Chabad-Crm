# fixes78 — superadmin check + bilingual new-org emails + approve link

Request (2026-09-30): "go to superadmin make sure it's all working. make sure that a
person that wants to create a new org gets notified in hebrew and english (in the same
mail)" + "notify that the request is examined — have the system send the superadmin an
email with link so superadmin can approve new org quickly".

## 1. Signer-up gets one bilingual "request received / under review" mail
- [x] Bodies of `aignummail1` (received, under review) and `aignummail2` (approved)
  were already Hebrew + English in one mail. Subjects were Hebrew-only → now
  `בקשתך התקבלה / Request received — מיני CRM` and `הארגון אושר / Organization approved — מיני CRM`.
- [x] Existing DB rows are upgraded on startup (`seed_email_templates`) **only** while
  they still hold the old default subject (`LEGACY_EMAIL_SUBJECTS` in `core/email.py`);
  a superadmin-edited subject is left alone. Prod (Neon) gets it on the next deploy.
- Evidence: `test_signup_notice_is_hebrew_and_english_in_one_mail`,
  `test_seed_upgrades_legacy_subject_but_keeps_edited_one`; local DB rows upgraded after restart;
  live signup against local Postgres captured the mail with both languages.

## 2. Superadmin gets an email with an approve link
- [x] `send_org_pending_admin` now mails `PLATFORM_ADMIN_EMAIL` **and** `SUPERADMIN_EMAIL`
  (deduped, case-insensitive; previously only `PLATFORM_ADMIN_EMAIL`, skipped if unset).
  Bilingual subject/body, branded HTML with a green "אישור הארגון / Approve organization"
  button → `{FRONTEND_URL}/dashboard/admin?approve=<org id>`.
- [x] `/dashboard/admin?approve=<id>`: logged-out → login → back (existing `?redirect`
  deep link), org card highlighted + scrolled to, confirm dialog "לאשר את הארגון …?" →
  approve (which sends the approved mail). Already-approved → toast; unknown id → error
  toast. The param is stripped from the URL so reload doesn't re-prompt.
- [x] New strings seeded in LOCALIZATION: `admin.confirm_approve_org`,
  `admin.approve_link_already`, `admin.approve_link_missing` (`{name}`/`{email}` replaced client-side).
- Evidence: `test_signup_emails_superadmin_an_approve_link`; headless Chromium drive:
  link → login redirect → dialog → approve → org 128 `approved`/active in DB, owner login 200;
  reload shows no second prompt; `?approve=999999` shows the not-found message; no page
  errors, no API ≥400.

## 3. Superadmin page sweep
- [x] Org list, approve/reject, users panel, features panel all render and work locally;
  `test_superadmin.py` + `test_signup.py` + `test_auth.py`: 27 passed; `tsc --noEmit` clean.

## Not done / notes
- Prod not touched (nothing committed or pushed). For the superadmin mail on prod,
  `SUPERADMIN_EMAIL` (or `PLATFORM_ADMIN_EMAIL`) on Render must be a real inbox.
- Local test org "ארגון בדיקה Live" (id 128) left in the local DB.
- The shared ConfirmModal's confirm button is red (destructive style) — also for approve.
