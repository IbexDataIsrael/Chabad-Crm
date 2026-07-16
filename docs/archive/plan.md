# Build Plan — Bilingual Mini CRM MVP

This plan describes how to build the bilingual (Hebrew/English) Mini CRM defined in
[`CLAUDE.md`](../CLAUDE.md) and [`DATABASE.md`](./DATABASE.md). It is organized into
phases. Each phase is independently testable and leaves the app in a runnable state.

## Guiding principles (from spec)

- **Strict separation of layers:** data is stored with **English schemas only**; all
  Hebrew text reaches the UI through the `field_localization` metadata engine.
- **Native RTL** layouts via Tailwind (`dir="rtl"`), full **UTF-8 / Hebrew** support end to end.
- **No over-engineering** — MVP scope, lightweight FastAPI + SQLite backend, Next.js frontend.
- **Secure auth:** bcrypt password hashing, OAuth2 JWT bearer tokens, protected routes.
- Status color palette: Magenta, Bright Green, Yellow, Dark Red, Orange (high-contrast row shading).
- **Roles:** each user has a `role` (`admin` | `staff`). Picklist option lists may only be
  edited by **admins**; staff have read-only access to picklists. The role travels in the JWT.
- **Admin-managed picklists:** the allowed options for constrained fields (`pipeline_status`,
  `interaction.category`, `color_tag`, and similar) live in the `picklist_values` table — not
  hardcoded — so admins can add/rename/reorder/recolor/disable options at runtime via the backend.

---

## Phase 0 — Repository scaffolding & tooling  ✅ DONE

Goal: a runnable skeleton with `docker-compose up --build` bringing up both services.

- [x] Create root layout: `backend/`, `frontend/`, `docker-compose.yml`, root `.env`.
- [x] `backend/`: `Pipfile` (fastapi, uvicorn, sqlalchemy, passlib[bcrypt], python-jose,
      python-multipart, pydantic-settings, pytest, httpx), `app/` package, `data/` dir for SQLite.
- [x] `backend/.env` with `DATABASE_URL`, `SECRET_KEY`, `ALGORITHM=HS256`,
      `ACCESS_TOKEN_EXPIRE_MINUTES=480` (per CLAUDE.md).
- [x] `frontend/`: Next.js (App Router) + Tailwind CSS configured for RTL.
- [x] `docker-compose.yml`: `backend` (host port 8001→8000) and `frontend` (host port 3001→3000)
      services. Host ports remapped to 8001/3001 to avoid colliding with an unrelated `pm-mvp`
      container holding 8000/3000.
- [x] Smoke check: backend `http://localhost:8001/api/health` → `{"status":"ok"}` and
      `http://localhost:8001/docs` → 200; frontend `http://localhost:3001/` renders `dir="rtl"` + Hebrew.

---

## Phase 1 — Backend foundation (DB + config)  ✅ DONE

Goal: database models and app boot wiring matching `DATABASE.md` exactly.

- [x] `app/config.py` — load settings from env via `pydantic-settings`.
- [x] `app/database.py` — SQLAlchemy engine (SQLite), `SessionLocal`, `Base`, `get_db` dependency.
- [x] `app/models.py` — port all 7 models from `DATABASE.md`:
      `User` (with `role`), `Region`, `Contact`, `CommunityChecklist`, `Interaction`,
      `FieldLocalization`, `PicklistValue`.
- [x] `app/main.py` — FastAPI app, CORS for `localhost:3001`, create tables on startup (lifespan).
      Added temporary `GET /api/_diagnostics/tables` to visually confirm the schema.
- [x] Verify tables are created in `data/crm.sqlite3` — all 7 present; `pytest` green (3 passed).

---

## Phase 2 — Authentication  ✅ DONE

Goal: registration + login returning a JWT (carrying the user's role), plus reusable
auth + role dependencies.

- [x] `app/core/security.py` — bcrypt hashing (passlib; `bcrypt` pinned to `4.0.1` for passlib
      compatibility), JWT encode/decode (python-jose); `role` included in the token claims.
- [x] `app/schemas.py` — Pydantic models: `UserCreate` (with `role`, default `staff`),
      `UserOut` (exposes `role`), `Token`, `TokenData` (carries `username` + `role`).
- [x] `app/routers/auth.py`:
  - `POST /api/auth/register` — create user with hashed password and role.
  - `POST /api/auth/token` — OAuth2 password flow, returns bearer token.
  - `GET  /api/auth/me` — current user profile incl. role (frontend uses it to show/hide admin UI).
- [x] `app/deps.py` — `get_current_user` (validates JWT) and `require_admin`
      (raises 403 unless `current_user.role == "admin"`).
- [x] Seed a first **admin** user (`admin` / `admin123`) on startup so picklists are editable
      out of the box (`app/seed.py`, configurable via `ADMIN_*` env vars).
- [x] Tests: register, login, reject bad credentials, reject missing/invalid token,
      `require_admin` allows admin / blocks staff (403). **10 passed.**

---

## Phase 3 — Core CRUD routers (protected)  ✅ DONE

Goal: full CRUD for the CRM entities, all behind `get_current_user`.

- [x] Pydantic schemas for each entity (create/update/out), Hebrew strings as plain UTF-8.
- [x] `app/routers/regions.py` — `GET/POST/PUT/DELETE /api/regions/*` (unique-name guard;
      detaches contacts on delete).
- [x] `app/routers/contacts.py` — `GET/POST/PUT/DELETE /api/contacts/*`;
      list filters by `region_id`, `pipeline_status`, `assigned_user_id`; FK validation;
      nested `checklist` on detail responses (auto-created with each contact).
- [x] `app/routers/interactions.py` — `GET/POST/DELETE /api/interactions/*`,
      scoped to a contact (`?contact_id=`), newest-first, `created_by` stamped from the JWT user.
- [x] `community_checklists` — sub-resource of a contact
      (`GET/PUT /api/contacts/{id}/checklist`), one row per contact.
- [x] Tests for each router: auth required (401), CRUD, FK integrity (400 on bad FK),
      list filters, cascade deletes. **22 passed total.** Live Hebrew round-trip verified.

---

## Phase 4 — Localization metadata engine  ✅ DONE

Goal: the dynamic English→Hebrew translation layer that the frontend boots from.

- [x] `app/routers/metadata.py` — `GET /api/metadata/localization` (public, no auth) returns the
      full `field_localization` table grouped by `entity_type` (`table`, `column`,
      `interaction_category`). Shape: `{ entity_type: { technical_name: hebrew_label } }`.
- [x] `app/seed.py` — idempotent `seed_all` populating:
  - `field_localization` rows — 28 labels (5 tables + 20 table-qualified columns + 3 categories).
  - A default admin `User`, a `regions` entry, and 2 sample contacts with checklists + 1 interaction
    (only when no contacts exist).
- [x] Tests: localization endpoint shape + no-auth; seed runs clean and is idempotent.
      **25 passed.** Live endpoint verified (Hebrew labels intact, correctly grouped).

---

## Phase 4b — Picklist (lookup option) management  ✅ DONE

Goal: a backend system to read and update the dropdown/lookup option values of SQL-table
fields, so option lists are data-driven rather than hardcoded.

- [x] `PicklistValue` model present in `app/models.py`
      (`field_key`, `value`, `hebrew_label`, `color_hint`, `sort_order`, `is_active`, `is_default`;
      unique on `(field_key, value)`).
- [x] `app/schemas.py` — `PicklistValueCreate`, `PicklistValueUpdate`, `PicklistValueOut`, `PicklistReorder`.
- [x] `app/routers/picklists.py` — reads use `get_current_user` (any staff); **all mutations
      depend on `require_admin`** (admin role only, else 403):
  - `GET  /api/picklists` — list distinct `field_key`s. *(staff+)*
  - `GET  /api/picklists/{field_key}` — ordered options (`?include_inactive=true` for editor). *(staff+)*
  - `POST /api/picklists/{field_key}` — add an option. *(admin)*
  - `PUT  /api/picklists/{id}` — edit label/color/order/default/active. *(admin)*
  - `DELETE /api/picklists/{id}` — soft-delete via `is_active=false`; `?hard=true` removes the row
    only when unused (else 409). *(admin)*
  - `PUT  /api/picklists/{field_key}/reorder` — bulk update `sort_order`. *(admin)*
- [x] Reference-integrity helper (`app/picklist_utils.py`): validates writes to constrained columns
      (`contact.pipeline_status`, `contact.color_tag`, `interaction.category`) against the active
      picklist; free-form until a picklist is configured. Wired into contacts + interactions routers.
- [x] Seed (`app/seed.py` → `seed_picklists`): pipeline statuses, the 5 status colors with
      `color_hint`, and the 3 interaction categories with Hebrew labels. Sample contacts aligned
      to seeded values.
- [x] Tests: CRUD, uniqueness per `field_key`, ordering, soft-delete + include_inactive, hard-delete
      usage guard, admin-only enforcement (staff → 403), out-of-picklist rejection. **32 passed.**
      Live verified.

---

## Phase 5 — Frontend foundation  ✅ DONE

Goal: RTL Next.js shell, auth flow, and the localization fetch at boot.

- [x] Global `dir="rtl"` + `lang="he"` (root layout), Tailwind status palette, Hebrew system font stack.
- [x] `lib/api.ts` — API client: token storage (localStorage), `Authorization` injection,
      401 handling (clears token + redirects to login), `login()` for the OAuth2 form flow.
- [x] `lib/auth.tsx` — `AuthProvider`/`useAuth` (restores session via `/api/auth/me`, `isAdmin`,
      `signIn`/`signOut`). `lib/localization.tsx` — `LocalizationProvider` fetches
      `/api/metadata/localization` at boot, exposes `t(technical_name, fallback?)` and `label()`.
- [x] Login page (`/`) → token → redirect to `/dashboard`; `components/RequireAuth.tsx` guards the
      dashboard. Dashboard shell (`app/dashboard/`) with header/nav (admin-only picklists link) and a
      panel demonstrating the localization engine.
- [x] Verified: both routes compile cleanly; login page renders RTL Hebrew; CORS preflight for the
      `Authorization` `/me` call from `http://localhost:3001` returns 200.

---

## Phase 6 — Frontend CRM views  ✅ DONE

Goal: the working CRM UI matching the spreadsheet markers.

- [x] **Contacts dashboard** (`app/dashboard/contacts/page.tsx`): RTL table with high-contrast
      **row shading from `color_tag`** (tint + inline-start border via `lib/colors.ts`) + color dot,
      columns labeled via `t()`, filters by region / pipeline status.
- [x] **Contact detail/edit** (`contacts/[id]`, `contacts/new`): shared `ContactForm` with region &
      assignee selectors (assignees from new `GET /api/users`), pipeline status, priority score,
      color tag picker; save (PUT/POST) + delete.
- [x] **Community checklist** (`ChecklistEditor`): 6 mitzvot toggle buttons with Hebrew labels from
      metadata, optimistic `PUT /api/contacts/{id}/checklist`.
- [x] **Interactions timeline** (`InteractionsTimeline`): newest-first log, add-note form with
      picklist category selector, per-item delete.
- [x] Regions management (`dashboard/regions`) — list + add + delete.
- [x] **Picklist-driven dropdowns** (`PicklistSelect` + `usePicklist`): pipeline status, color tag,
      and interaction category fetch options from `GET /api/picklists/{field_key}`.
- [x] **Admin picklist editor** (`dashboard/picklists`): add/rename/recolor/reorder (↑/↓)/activate/
      hard-delete per `field_key`; gated on `isAdmin`; nav link admin-only. Staff get read-only dropdowns.
- [x] **Backend addition:** `GET /api/users` (auth) for the assignee selector (+ test). All routes
      compile cleanly (200), **34 backend tests pass**, users/contacts data verified live.

---

# SaaS conversion (multi-tenant)

Phases 7–10 convert the single-tenant CRM into a multi-tenant SaaS: each customer is an
**organization** (tenant) with fully isolated data. Public signup creates an organization and a
**pending admin** that is activated only after **email verification**. The organization name
becomes the app title.

> Schema impact: this adds `organization_id` to most tables and new columns to `users`. SQLite +
> `create_all` does **not** ALTER existing tables, so applying this needs either (a) **Alembic
> migrations**, or (b) a **dev database reset** (drop the `backend_data` volume / delete the
> sqlite file). See open questions — pick one before starting Phase 7.

## Phase 7 — Multi-tenancy foundation (orgs + data scoping)  ✅ DONE

Goal: introduce organizations and isolate every tenant's data.

- [x] New `organizations` table (`id`, `name`, `created_at`).
- [x] Added `organization_id` FK to `users`, `regions`, `contacts`, `interactions`,
      `picklist_values` (checklists scoped via contact). `field_localization` stays **global**.
- [x] Extended `users`: `email` (global-unique, nullable for now), `first_name`, `last_name`,
      `phone`, `is_active`, `email_verified`. JWT subject switched to user **id** (usernames are no
      longer globally unique).
- [x] Tenant scoping: every CRUD router injects `current_user` and filters/stamps by
      `organization_id`; cross-tenant access returns 404. Picklist validation + usage counts are
      org-scoped (`picklist_utils`).
- [x] Scoped uniqueness: `username` unique **per org** (`uq_user_org_username`), `email`
      **global-unique**; `regions.name` unique per org; picklist unique on
      `(organization_id, field_key, value)`.
- [x] `provision_org(db, org_id)` seeds a single org's picklists (used by the demo org now; wired to
      verification in Phase 8).
- [x] Migration: **dev DB reset** (`docker compose down -v`). `seed.py` rewritten — global labels +
      a **demo organization** (`ארגון הדגמה`) with `admin/admin123`, picklists, and sample data.
- [x] Tests: cross-org isolation (contacts/regions/users/picklists), per-org username reuse, global
      email uniqueness. **38 passed.** Live: `/me` returns `organization`; a second org sees 0
      contacts/picklists (fully isolated).

## Phase 8 — Signup, email verification & admin activation (backend)  ✅ DONE

Goal: public signup → verification email → activated org admin.

- [x] `POST /api/auth/signup` — body: `organization_name`, `first_name`, `last_name`, `email`,
      `phone`, `username`, `password`. Creates the `Organization` + a `User` (role `admin`,
      `is_active=false`, `email_verified=false`). Returns `{status: pending_verification}`.
- [x] Verification token — stateless signed JWT (`type=email_verify`, `sub=user_id`, 24h expiry)
      (`create_email_token` / `decode_email_token`).
- [x] Email service (`app/core/email.py`): SMTP via env; **dev fallback logs the verification link
      to the console** (chosen). No MailHog.
- [x] `GET /api/auth/verify-email?token=…` — validates the token, sets `email_verified=true` +
      `is_active=true`, and **provisions the org's picklists** (`provision_org`). Idempotent.
- [x] `POST /api/auth/resend-verification` (by email) — re-issues the link; always 200 (no enumeration).
- [x] Login (`/token`) rejects unverified/inactive users with **403**. Legacy `register` now creates
      immediately-active users (so it/test fixtures still work).
- [x] Config additions: `FRONTEND_URL`, `EMAIL_FROM`, `SMTP_*`, `verification_token_expire_hours`.
- [x] Tests: signup→pending+login-blocked; verify activates/provisions/enables login; invalid token
      → 400; duplicate email → 400; resend; idempotent verify. **44 passed.** Live flow verified.

## Phase 9 — SaaS frontend: signup, verification UX & org-as-title  ✅ DONE

Goal: the signup experience and tenant-aware UI.

- [x] New `/signup` page with fields: **organization name, first name, last name, email, phone,
      username, password, verify password** — client validation (passwords match, email format,
      required) before `POST /api/auth/signup`.
- [x] "Check your email" confirmation screen after signup (with a resend action).
- [x] `/verify` page (Suspense-wrapped `useSearchParams`) reading `?token=…` → calls verify endpoint
      → success (auto-redirect to login after 3s) or failure (error + email-resend field).
- [x] **Organization as title:** `GET /api/auth/me` returns `organization {id, name}`; the dashboard
      header and `document.title` show the org name (replaces the hardcoded title).
- [x] Login page: detects **403** → shows "verify your email" with an inline resend field.
- [x] Old `/register` now redirects to `/signup`; login links to "פתיחת חשבון ארגון".
- [x] Verified: all routes compile (200), login links to signup, signup/verify UIs render. Backend
      signup→verify→login flow verified live in Phase 8 (same endpoints the UI calls).

## Phase 10 — Staff invitations within an org *(optional / later)*

Goal: let an org admin add staff users (instead of public staff self-registration).

- [ ] Admin invites a staff member by email → invite token → invitee sets their password and joins
      the org as `staff`. Admin-only "user management" screen. Scoped to the admin's organization.

---

## Phase 12 — Contact field expansion, editing everywhere & full picklist management  ✅ DONE

Goal: add the fields from `docs/fixes.md`, make every entity editable, surface **all** picklists
to admins, and make the UI mobile-friendly. Requires a **dev DB reset** (schema changes).

**Status:** Done. Region dropped → `contact.area` picklist; Contact gained area/first_visit/
potential_next_step/rebbe_connection/recommendations/background; checklist gained charity_note/
letter_torah_notes/torah_thought (picklist, replacing dvar_torah). `GET /api/picklists` returns the
full registry so admins manage all 6 picklists. Interaction edit (`PUT`) added; contact form +
checklist editor expanded; mobile-responsive header/table/forms. Docs updated (DATABASE.md, CLAUDE.md).
**44 backend tests pass**; all frontend routes compile; live verified. (Detailed checklist below.)

### Decisions (confirmed)
- **Area replaces Region:** drop the `regions` table/router/page; `אזור` becomes the admin-managed
  picklist `contact.area`.
- **Reuse & extend the checklist:** existing booleans relabeled; `dvar_torah` boolean → `torah_thought`
  picklist; new note/text fields added. No duplicate columns.
- **Split storage:** core fields on `contacts`; religious fields on the 1:1 `community_checklists`.

### Schema
- **Drop** `regions` (model, router, FK `contacts.region_id`, frontend page + nav, related localization).
- **Contact** gains: `area` (picklist `contact.area`), `first_visit` (datetime),
  `potential_next_step` (picklist `contact.potential_next_step`), `rebbe_connection` (text),
  `recommendations` (text), `background` (text). Keeps name, assigned_user, address,
  pipeline_status, priority_score, color_tag.
- **CommunityChecklist** gains: `charity_note` (text), `letter_torah_notes` (text),
  `torah_thought` (picklist `checklist.torah_thought`, replaces `dvar_torah`). Booleans kept:
  tefillin, tzedakah, shabbat_candles, torah_pamphlet, torah_letter (relabeled).
- **Localization** (global) updated: remove region keys + `dvar_torah`; add `contacts.area`,
  `contacts.first_visit`, `contacts.potential_next_step`, `contacts.rebbe_connection`,
  `contacts.recommendations`, `contacts.background`, `community_checklists.charity_note`,
  `community_checklists.letter_torah_notes`, `community_checklists.torah_thought`; relabel
  candles→`נרות`, pamphlet→`עלון`, letter→`אות בספר`.

### Picklists (admin manages ALL)
- Field-key registry in `picklist_utils` with Hebrew display labels:
  `contact.area`, `contact.pipeline_status`, `contact.color_tag`, `contact.potential_next_step`,
  `checklist.torah_thought`, `interaction.category`.
- `GET /api/picklists` returns the **full registry** (each `{field_key, label}`) so admins can edit
  every picklist even when it has no options yet — not just ones already populated.
- `count_usage` handles checklist-scoped fields (no `organization_id`) by joining through Contact.
- Seed default options per org for `contact.area`, `contact.potential_next_step`,
  `checklist.torah_thought` (alongside existing).

### Editing everywhere (CRUD)
- **Contacts:** expand `ContactForm` + `ChecklistEditor` to edit every new field (PUT already exists).
- **Interactions:** add `PUT /api/interactions/{id}` (edit category/note) + inline edit UI.
- **Picklists:** admin editor lists all registry field_keys (Hebrew labels) and edits options.
- Regions editing removed (entity dropped).

### Mobile-responsive
- Responsive header/nav (wraps), contacts table scrolls/stacks on small screens, forms single-column
  on mobile (already `grid-cols-1 sm:grid-cols-2`), comfortable tap targets.

### Tests
- Contact create/update round-trips all new fields; checklist notes + `torah_thought` picklist
  validation; `contact.area`/`potential_next_step` picklist enforcement; interaction edit; registry
  endpoint lists all field_keys; per-org isolation still holds. Update region tests (removed).

### Docs
- Update `DATABASE.md` (new Contact/checklist columns, drop regions) and `CLAUDE.md` architecture.

---

## Phase 13 — Checklist notes, new-contact checklist & custom fields  ✅ DONE

Goal: per-boolean notes, the checklist available when creating a contact, and admin-defined
custom checklist fields. (Also covered earlier in this phase block: GUIDs on every table, contact
phone as required+unique key, lat/lng display, org `map_in_english` + editable org settings.)

- [x] **Checklist notes:** added `tefillin_notes`, `shabbat_candles_notes`, `torah_pamphlet_notes`
      (now every mitzvah boolean has a matching note) + localization labels. CRUD in views.
- [x] **Bug fix:** the מצוות קהילה section now appears on the **new** contact form (controlled
      `ChecklistFields`), saved together with the contact via the form's single submit. Same unified
      save (contact + checklist + custom fields) in edit mode; contact detail opens **read-only** with
      an **עריכה** toggle.
- [x] **Custom fields (per-org, boolean + note + Hebrew label):** new tables
      `custom_field_definitions` + `custom_field_values`. Admin CRUD at `/api/custom-fields`
      (`require_admin` for writes); contact values at `GET/PUT /api/contacts/{id}/custom-fields`.
      Admin config page **`/dashboard/custom-fields`** (nav: שדות מותאמים) to add/rename/reorder/
      activate/delete; each field shows on the contact view + edit with full CRUD.
- [x] Seeded an example custom field for the demo org (`hanuka_party` → מסיבת חנוכה).
- [x] Docs updated (`DATABASE.md`, this plan). Tests: custom-field CRUD + admin-only, contact value
      get/set, checklist-notes round-trip, per-org isolation. **59 backend tests pass.** Live verified.

---

## Phase 11 — Hardening & polish

- [ ] Consistent error handling + toasts; loading/empty states.
- [ ] Backend input validation, 404/403 correctness, CORS lockdown.
- [ ] Verify UTF-8/Hebrew round-trips through DB → API → UI with no mojibake.
- [ ] README run instructions; confirm `docker-compose up --build` + both smoke checks pass.
- [ ] Backend `pytest` green; basic frontend component smoke tests.

---

## Deliverables checklist

| Area | Artifact |
|------|----------|
| Backend | `app/{config,database,models,schemas,deps,main}.py`, `app/core/{security,email}.py`, `app/routers/{auth,regions,contacts,interactions,metadata,picklists,users,organizations}.py`, `app/seed.py`, Alembic migrations (if chosen), tests |
| Frontend | Next.js App Router pages (incl. `/signup`, `/verify`), API client, localization provider, contacts/detail/checklist/interactions views, org-titled shell |
| Infra | `docker-compose.yml` (+ optional MailHog), `backend/.env` (incl. SMTP), root `.env`, `Pipfile` |
| Docs | This plan, updated README |

## Suggested build order

Phases 0 → 6 (single-tenant CRM) — **done**.
SaaS conversion: Phase 7 (tenancy) → 8 (signup + verification backend) → 9 (signup frontend) →
10 (invitations, optional) → 11 (hardening). Do 7 before 8: scoping must exist before signup
creates tenants.

## Decisions for the SaaS conversion (confirmed)

- **Migration strategy:** **reset the dev DB** (drop the `backend_data` volume / sqlite file and
  recreate from the new models). No Alembic for now.
- **Uniqueness:** `email` is **global-unique**; `username` is **unique per organization**.
- **Verification token:** stateless signed JWT (`type=email_verify`, ~24h expiry).
- **Email delivery (dev):** **log the verification link to the console**; wire real SMTP via env
  later. No MailHog for now.
- **Org provisioning timing:** seed the org's picklists/defaults **on email verification**.
- **Demo org:** keep the current `admin/admin123` + sample contacts, moved under a **"demo"
  organization** for local dev.

## Open questions still resolved during build (Phases 0–6):
- Roles: admin + staff; picklists admin-only. Hebrew labels seeded into `field_localization`.
- 5 status colors mapped via the `contact.color_tag` picklist. Contact deletion is hard-delete
  (cascades interactions + checklist).
