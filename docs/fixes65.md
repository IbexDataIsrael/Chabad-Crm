# Implementation Plan: Activist Self-Registration & QR Task Claiming

This task introduces branded public organizational landing pages, activist self-registration, unassigned (orphan) task pooling, QR-code-based task claiming, PDF task printing, and administrative notifications.

---

## 1. Branded Public Landing Page

* **Public Route & Layout:**
  * Build a professionally styled public page per organization (`/org/[slug]`).
  * **Graphic design is part of this task and is created by the implementer (Claude) (added):** no external design assets are provided. Deliver a deliberate, polished design - layout, typography, spacing, color, mobile-first, gallery presented as a real gallery - not default framework styling.
  * Include organization name, subtitle, and an interactive photo gallery.
  * Provide inline forms for user sign-in and registration.
* **Org Settings Management:**
  * Add configuration fields in the Org Admin Settings to edit name, subtitle, and photo gallery without code deployments.
  * Implement an org-level toggle switch for self-registration (default: `OFF`, set `ON` for Sheepshead Bay).

---

## 2. Unassigned ("Orphan") Task Support

* **Database & Schema Updates:**
  * Update the task model to allow `activist_id` / `owner_id` to be nullable.
* **Task Creation Workflow:**
  * Update task creation forms/modals: allow admins to either select an existing activist or select **"Assign Later"**.
  * Tasks marked "Assign Later" enter an orphan task pool.

---

## 3. Printable Task PDF Generation

* **Print Action:**
  * Add a **"Print Task"** button to every task row/detail view.
  * Prevent printing for any task containing zero apartments.
* **PDF Layout & Hebrew Support:**
  * Reuse existing Hebrew PDF generation code from the apartments report, optimized for high-contrast B&W printing.
* **Conditional QR Rendering:**
  * If the task is **unassigned**: Render a secure QR code on every page header/footer.
  * If the task is **assigned**: Omit the QR code.

---

## 4. QR Code Claim Ticket Architecture

* **Token & Route Design:**
  * Encode a signed, cryptographically secure GUID (non-sequential) in the QR link pointing to `/tasks/claim/[token]`.
* **State & Claim Logic:**
  * **Unregistered User:** Redirects to registration -> remembers claim token throughout auth flow -> auto-claims task upon completion.
  * **Registered User (Signed In):** Direct claim execution -> updates task owner -> displays confirmation.
  * **Already Claimed (Same User):** Displays "Already yours" notice.
  * **Already Claimed (Other User / Office Entering Paper Data):** Displays locked error (e.g., "This task has already been claimed or is being handled by the office").
* **Claim Audit (added):**
  * On every successful claim, record `claimed_at` (timestamp) and `claimed_via` (e.g., `qr`) on the task.
* **Token Lifetime (added):**
  * The QR link stops working when the task is done or deleted. Old printouts of a live task keep working; unassign returns the task to the pool and the same printout works for the next claimant.
* **Admin Overrides:**
  * Admin unassign action returns the task to the orphan pool. Existing printouts remain valid for future scanning.

---

## 5. Activist Registration & Identity Collection

* **Public Sign-Up & QR-Claim Registration (corrected):**
  * **Required:** Full Name, Email, Password - OR Google sign-in (which provides the email automatically).
  * **Optional:** Phone Number.
  * The email is the login to the system, so it can never be skipped on public registration.
* **Admin Manual Add (corrected):**
  * Only on the admin's manual add-activist form: a **"No email"** checkbox beneath the email field for paper-only activists who never log in.
  * Checked: email validation is bypassed and the user is marked as a manual/no-login user in the database.
* **Access Rules:**
  * Instant access upon submission (no email verification barrier).
  * Newly registered activists automatically populate the organization's user list with their full name.

---

## 6. Offline / Paper Workflow

* **Manual Data Entry Form:**
  * Allow admins to manually input handwritten results from physical paper task sheets.
* **Attribution Metadata:**
  * Add a mandatory "Who performed the work?" input field during paper entry.
  * Options: Select registered user, enter free-text name (e.g., "Moshe Cohen"), or select "Unknown".
  * Free-text entries log history without creating system user accounts.

---

## 7. Admin Notifications & Dashboard Alerts

* **Email Dispatch:**
  * Trigger email notifications to all org admins upon every new activist registration (public page or QR flow).
  * Wrap email delivery in non-blocking try/catch blocks to ensure registration never fails on email dispatch errors.
* **Dashboard Alert Card:**
  * Add a dismissible dashboard card: *"N new activists signed up"*.
  * Link card directly to the Users list pre-filtered by newly registered activists.

---

## 8. Orphan Task Pool UI Filtering

* Update the main Tasks view to add a dedicated status filter: **"Orphan / Unassigned"** (tasks printed but unclaimed).

---

## 9. Future Roadmap (Phase 2 - Out of Scope for Current Task)

* Granular event logging for apartment visits (tefillin, menorah, mezuzah checks).
* Real-time activity counter dashboards and individual activist personal history tabs.

---

## Implementation decisions (Claude, 2026-09-23)

Mapping the spec onto the existing code (fixes58 `Task`/`Campaign`, fixes61/64 manual activists, fixes24 RTL PDF):

* **"Task" = `models.Task`** (fixes58). The spec's `activist_id`/`owner_id` is `Task.volunteer_user_id` → made **nullable**. Orphan = `volunteer_user_id IS NULL AND claimed_via IS DISTINCT FROM 'paper'`.
* **Task apartments** = apartments (active versions) whose `report_number_id` is one of the task's report numbers. "Zero apartments" → print disabled (button disabled in UI + backend `print-data` returns 409).
* **Claim token (§4):** no new column. Token = `<task.guid>.<HMAC-SHA256(SECRET_KEY, "task-claim:"+guid) truncated>` — `Task.guid` is already a random uuid4 (non-sequential); the HMAC makes it signed/unforgeable. Verified with `hmac.compare_digest`. Lifetime rules fall out naturally: deleted task → guid not found; `COMPLETED` → rejected; unassign → same guid → same printout works again. (Rotating `SECRET_KEY` would invalidate old printouts — acceptable/documented.)
* **Claim states:** `available` → claim sets `volunteer_user_id`, `claimed_at=now`, `claimed_via='qr'`; `yours` → "already yours"; `taken` (other user, or office paper entry `claimed_via='paper'`) → locked message; `invalid` (bad signature / deleted / completed). Only `shliach`-role users in the task's org can claim (admins get a clear message).
* **Unregistered QR flow:** `/tasks/claim/[token]` is public. Not signed in → inline register form (+ sign-in link). The token rides in the register call (`claim_token`) so the backend registers **and** claims atomically; it is also kept in `localStorage` (`crm.pendingClaim` is swept by `clearToken`, so key is `pendingClaimToken`) so a sign-in detour (`/?redirect=/tasks/claim/<token>`) returns and auto-claims. A valid, live, orphan claim token authorizes QR registration even when the org's public self-registration toggle is OFF (the org printed the QR on purpose).
* **Public landing (§1):** new org columns `slug` (unique), `public_subtitle`, `public_gallery` (JSON list of image URLs), `self_registration_enabled` (default false). Migration turns it ON + slug `sheepshead-bay` for the Sheepshead Bay org (matched by name). Public route `/org/[slug]`; public API `GET /api/public/orgs/{slug}`. Sign-in form on the page logs in scoped to that org (`organization_id`). Gallery images upload through a new admin-only org-scoped `POST /api/uploads/gallery-image`.
* **Registration (§5):** `POST /api/public/register` (full name, email, password, optional phone, `org_slug` or `claim_token`) and `POST /api/public/register-google` (Google credential; email from Google). Creates the same trio an admin-created activist gets: `Contact(contact_type='shliach')` + `ContactShliach` + `User(role='shliach')`, immediately active, returns a JWT. New `users.registration_source` (`public`|`qr`) marks self-registrations. Duplicate email in the org → 409 "already registered, sign in". A phone that collides with an existing contact is kept on the user but not the contact (contacts.phone is org-unique).
* **Admin manual add "No email" (§5):** the checkbox already exists (fixes61 Users form, fixes64 activist ContactForm). Gap closed: an email-less activist now gets a real `User(role='shliach', is_manual=True)` (was: no user at all), so they appear in the users list, can be assigned tasks and picked as paper-entry performer. Adding an email later upgrades that same user (`is_manual=False`).
* **Admin notifications (§7):** after commit, emails every active org admin with an email via FastAPI `BackgroundTasks`, each send wrapped in try/except (registration never waits on or fails from SMTP). Dashboard card: `GET /api/dashboard/new-signups` counts self-registered users created after the admin's dismissal timestamp (stored as the per-user preference `dashboard.new_signups_dismissed_at`). Card links to `/dashboard/users?new_signups_since=<iso>`, which filters the Users list to those registrations.
* **Paper workflow (§6):** `/dashboard/tasks/[id]/paper-entry` — grid of the task's apartments with the paper-sheet columns (Jewish status, mezuzah, languages, notes) + mandatory "Who performed the work?" (registered user / free-text name / Unknown). `POST /api/tasks/{id}/paper-entries` applies the changed apartments through the existing versioned apartment update and writes a `task_paper_entries` history row (performer_user_id / performer_name / performer_unknown, entered_by, apartment count). An orphan task becomes locked (`claimed_via='paper'`; if a registered performer was chosen they become the task's volunteer).
* **Admin unassign/assign (§4):** `POST /api/tasks/{id}/unassign` (clears volunteer + claim audit + paper lock → back to pool), and the Tasks grid's activist cell becomes an inline picker for assigning.
* **Orphan filter (§8):** Tasks page gets an "Orphan / Unassigned" assignment filter (`assignment=orphan|assigned`).
* **PDF (§3):** `lib/taskPdf.ts` reuses `lib/pdfRtl.ts` (Alef font + bidi patch + org header) with a black-on-white, grid-bordered, no-grey-fill layout. QR (via the `qrcode` npm package) is stamped in every page's header only when the task is unassigned.

---

## Closeout (2026-09-23)

**Status: all 8 in-scope sections done and verified locally (real local Postgres + live browser drive). NOT committed / pushed.** §9 is out of scope per the spec.

Verification: backend `pytest` full suite **554 passed** (before the last two small additions), `tests/test_fixes65.py` **20/20**; `tsc --noEmit` clean; a 15-step Playwright drive against the running app (org 1, real data) passed every check, and its test data was deleted afterwards.

### §1 Branded public landing page
- [x] `/org/[slug]` public page — `frontend/app/org/[slug]/page.tsx`, `components/public/{PhotoGallery,PublicAuthForms,WaveRule}.tsx`. Custom design (bay navy / sea-foam / one candle-gold action color; Frank Ruhl Libre display serif for the org name + Heebo; the gallery is the hero on mobile, beside the name + forms on desktop). Checked with screenshots at 390px and 1440px — no horizontal overflow at phone width.
- [x] Org name, subtitle, interactive gallery (swipe, arrows, arrow keys, thumbnails, fullscreen lightbox, RTL-aware direction; wave-pattern panel when there are no photos yet).
- [x] Inline sign-in (scoped to the org via `organization_id`) + registration forms on the page.
- [x] Settings → new "דף הארגון הציבורי" card (`components/PublicPageSettingsCard.tsx`): page address, subtitle, gallery upload/reorder/remove (`POST /api/uploads/gallery-image`, admin-only, org-scoped), self-registration switch. Name = the existing org name field. No deploy needed to change any of it.
- [x] Self-registration switch default OFF (`organizations.self_registration_enabled`, server default false); migration `d5e6f7a8b9c0` turned it ON + slug `sheepshead-bay` for the Sheepshead Bay org (local: org 1 "שליחות בשיפסיידביי" matched). **On Neon the migration runs automatically at backend startup — confirm afterwards that the right org got the slug** (it matches by name `%שיפסיידביי%` / `%sheepshead%`).

### §2 Unassigned ("orphan") tasks
- [x] `tasks.volunteer_user_id` nullable (migration `d5e6f7a8b9c0`).
- [x] Task create modal: new "שיוך מאוחר יותר" (Assign Later) option + hint (`TaskQuickCreateForm.tsx`). Drive: created an orphan task through the real modal.

### §3 Printable task PDF
- [x] "Print task" button on every Tasks row; disabled (with explanation) when the task has 0 apartments; backend `GET /api/tasks/{id}/print-data` also returns 409 for that case (tested).
- [x] `lib/taskPdf.ts` reuses `lib/pdfRtl.ts` (Hebrew font, bidi patch, org header). Black-on-white: white fills, solid black rules, no zebra/grey; blank columns + tall rows for handwriting, plus a "performed by" line.
- [x] QR only while unassigned, stamped on **every** page (bottom-left strip); assigned tasks print without it. Evidence: rendered the downloaded 2-page PDF and decoded the QR on both pages with OpenCV → the exact `/tasks/claim/<token>` URL.

### §4 QR claim ticket
- [x] Token = task guid (random uuid4) + HMAC-SHA256 signature (`core/claim_token.py`); forged/altered tokens rejected (tested). Link: `/tasks/claim/[token]`.
- [x] Signed-out → register on the claim page → registers **and** claims in one request; token also kept in localStorage so a detour through the regular login screen comes back to the claim (`lib/pendingClaim.ts`, `app/page.tsx`). Drive: new user registered from the claim page → "המשימה שלך!".
- [x] Signed-in activist → claimed on arrival; same user again → "already yours" (drive). Another activist → locked message (drive). Office paper entry → locked (drive).
- [x] Claim audit `tasks.claimed_at` + `tasks.claimed_via` (`qr` / `paper`), shown as a QR icon next to the activist in the grid.
- [x] Lifetime: dead after COMPLETED or delete (tested); unassign keeps the same printout working for the next claimant (tested + drive).
- [x] Admin unassign button (`POST /api/tasks/{id}/unassign`) + inline activist picker in the grid to assign by hand.

### §5 Registration & identity
- [x] Public / QR registration: full name + email + password required, phone optional; or Google (`/api/public/register-google`, email from Google). Email can't be skipped (validated client + server). The Google button only shows when Google sign-in is configured.
- [x] Admin manual add "No email" checkbox: already existed (fixes61 Users form, fixes64 activist form). **Gap fixed:** an email-less activist now gets a real `User` marked `is_manual=True` (was: no user at all), so they show in the user list, can be assigned tasks and credited on paper entries; adding an email later upgrades the same user. Existing email-less activists get their user on their next edit (no backfill was run).
- [x] Instant access (no email verification); the new activist is in the org's user list with their full name (drive + test).

### §6 Paper workflow
- [x] `/dashboard/tasks/[id]/paper-entry` (clipboard button on each task row): the sheet's columns (Jewish status, mezuzah, languages, notes) per apartment; only changed cells are sent; saves go through the normal versioned apartment update.
- [x] Mandatory "מי ביצע את העבודה?": registered user / free-text name / Unknown. Free text creates no account (tested: user count unchanged). History list per task (`task_paper_entries` table).

### §7 Admin notifications
- [x] Every self-registration emails all active org admins that have an email, as a FastAPI background task; each send in its own try/except (tested: SMTP failure → registration still 201).
- [x] Dismissible dashboard card "N פעילים חדשים נרשמו" (per admin), linking to the Users list filtered to exactly those registrations (drive).

### §8 Orphan filter
- [x] Tasks page filter "יתומות / לא משויכות" (`assignment=orphan|assigned`), plus an "לא משויך" badge on orphan rows (drive).

### Notes / not done
- Nothing in scope left undone. Deliberate choices are listed under "Implementation decisions" above.
- Deploy needs: the new npm dependency `qrcode` (package.json updated; Vercel installs it); migration `d5e6f7a8b9c0` (runs automatically at backend startup); nothing new in env vars. Admin notification emails use the existing SMTP settings.
- All new Hebrew UI strings have LOCALIZATION rows (102 added, with English).
