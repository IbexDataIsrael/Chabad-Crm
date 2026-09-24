# fixes66 — QR on every task sheet + tasks without an activist

Source: Zvi, 2026-09-25 (chat). Follows fixes65 §3/§4, which specified the QR
**only for unassigned tasks** — that is why assigned task sheets printed with
no QR.

## Requests (verbatim intent)

1. "The QR should be on **all** task PDFs." The sheets are printed on paper.
2. "A task **with** an activist should hold the QR URL to the system, since
   these activists don't know the door to the system most of the time."
3. "There is no way to create a task without an activist — change this."
   Creating one with no activist shows a confirm modal: "You are about to
   create a task with no activist. Are you sure?" (Hebrew in the Hebrew UI).
   On approve, create it with no activist.
4. "Once the QR is opened, send them to registration and **automatically**
   bind them to the task." ("maybe more information should be stored in an
   SQL table so the website knows this new activist should be bound to task
   X — the mechanism is more complex than it seems")

## What already existed (fixes65) — findings

- Backend `POST /api/tasks` already accepts `volunteer_user_id: null`. The
  create form hid it behind an explicit dropdown choice ("שיוך מאוחר יותר"),
  and leaving the dropdown empty errored with "יש לבחור פעיל" — so in
  practice it looked impossible.
- QR -> register -> bind is already **server-side and atomic** for
  unassigned tasks: the QR URL `/tasks/claim/<token>` carries a signed token
  (`<task.guid>.<HMAC>`, app/core/claim_token.py) that identifies the task
  itself, and `POST /api/public/register` / `register-google` take
  `claim_token` and create the activist **and** assign the task in one DB
  transaction. The same for a signed-in activist (`POST /api/tasks/claim/<token>`).
- Gap 1: `print-data` returned a token only for unassigned tasks -> no QR.
- Gap 2: scanning an **assigned** task while signed out showed only "task
  already taken" — its own activist got no way in (no sign-in form).

## Decisions

- **One QR per task, the same signed link for every task** (assigned or
  not). The claim page adapts to the task's state:
  - unassigned + signed out -> register (auto-binds) / sign in (auto-binds);
  - assigned to an activist + signed out -> **sign-in form** ("this task
    belongs to an activist — sign in to open it"); the owner lands on
    "this task is yours" -> button into the system;
  - someone else's / office paper entry -> locked message (as before).
  Old printouts of an unassigned task keep working after it gets assigned:
  the same QR becomes the owner's door into the system.
- **No new SQL table.** The binding "new activist -> task X" never needs to
  be remembered between requests: the task travels inside the signed token
  in the QR, and registration binds in the same transaction that creates
  the user. A pending-binding table would only duplicate that. The one
  place that did rely on browser memory (localStorage `pendingClaimToken`)
  is the sign-in detour through the generic `/` login page; the inline
  sign-in on the claim page claims right after sign-in in the same page.
  (If a real multi-step flow is added later — email verification, admin
  approval of activists, password reset — that is the point to add a
  `task_claim_intents` table.)
- PDF captions: unassigned -> "scan to take the task" (as before);
  assigned -> "scan to sign in to the system and open your task".
- Create form: the dropdown's empty value becomes "ללא פעיל (מאגר משימות
  פתוחות)"; the separate "assign later" choice is folded into it. Save with
  no activist -> ConfirmModal -> create.

## Checklist

Verified 2026-09-25 by a live headless drive (Playwright Chromium) against the
local Docker stack + local Postgres: real UI clicks, the real downloaded PDFs
rendered and their QR codes decoded with OpenCV, a phone-sized signed-out
browser for the scans. Drive data (task, activist, contact, QA admin) deleted
afterwards.

- [x] §1 backend print-data returns the token for every task — tasks.py
      `task_print_data`; test_fixes65 `test_claim_flow_states` now asserts the
      reprint of an assigned task carries the same token.
- [x] §1 PDF: QR on every page of every task sheet; captions by state.
      Evidence: unassigned sheet decoded -> `/tasks/claim/<token>`, caption
      "סרקו את הקוד כדי לקחת את המשימה"; after assignment the reprint decoded
      to the **same** URL with "סרקו את הקוד כדי להיכנס למערכת" /
      "התחברו לחשבון שלכם והמשימה תיפתח לפניכם".
- [x] §2 claim page: assigned + signed out -> "המשימה משויכת לפעיל — התחברו
      כדי לפתוח אותה" + sign-in form; the owner signed in -> "המשימה הזו כבר
      שלך." -> "למשימות שלי" lands on /dashboard/activist.
- [x] §2 `GET /api/public/claim/<token>` has `has_activist` (false for an
      unassigned or office-paper task).
- [x] §3 create form: empty activist = "ללא פעיל (מאגר משימות פתוחות)";
      Save -> ConfirmModal "אתם עומדים ליצור משימה ללא פעיל. האם אתם
      בטוחים?" (en: "You are about to create a task with no activist. Are you
      sure?") -> אישור -> task created with volunteer_user_id = null.
      Tasks page "משימה חדשה" only — the Users-page quick action opens the
      same form locked to that user, so it has no activist choice.
- [x] §4 QR -> register -> auto-bind: scanned the unassigned sheet's QR signed
      out, registered (name/email/password) -> "המשימה שלך!"; the task's
      activist became the new user, claimed_via = "qr".
- [x] localization rows in seed.py for all 6 new keys (inserted at boot).
- [x] tests: test_fixes65/58/60 33 pass; `tsc --noEmit` clean.

Environment note: the Docker frontend first 500'd with "Can't resolve
'qrcode'" — the known stale anonymous node_modules volume (fixes65 added the
package); fixed with `docker compose exec frontend npm install`. Not a code
issue; Vercel installs from package.json.
