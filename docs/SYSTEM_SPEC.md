# System Spec — Sheepsidebay CRM

A living, high-level map of what this system *is*, as of the last update
below. Unlike `docs/fixesN.md` (a chronological changelog of each round of
requests), this file describes **current state** — no history, no "we used
to do X." When it drifts from the code, the code wins; fix this file, not
the other way around.

**Upkeep rule:** update the relevant section here at the end of every
`fixesN.md` round that changes the data model, adds/removes a feature area,
or changes a cross-cutting rule. Small in-page tweaks (a new button, a
reworded label) don't need an entry.

Last updated: 2026-09-23 (through fixes54; campaigns/tasks + fixes65 public
registration/orphan tasks added; verified against fixes1-20 archive).

---

## 1. What this is

A bilingual (Hebrew/English), RTL-native Mini CRM for a Chabad-style
outreach organization: it tracks people (**contacts**), the **apartments**
and **buildings** they live in grouped by **area**, the **visits** made to
them, and the **activists** ("shluchim") who cover that outreach — including
a self-service portal for those activists. Built for one organization's own
use (multi-tenant in the schema, but not operated as a multi-customer SaaS
product today).

## 2. Tech stack & topology

| Layer | Tech | Where it runs |
|---|---|---|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS | Vercel |
| Backend | FastAPI, SQLAlchemy, Alembic migrations | Render |
| Database | PostgreSQL | Neon (prod); local Docker Postgres (dev) |
| Local dev | Docker Compose (frontend :3001→3000, backend :8001→8000) | — |

Git push to `main` triggers both Vercel (frontend) and Render (backend)
deploys automatically — **there is no separate "deploy" step**, which is
why pushing is treated as a production action requiring explicit go-ahead.
Alembic migrations run against Neon on backend boot.

**Third-party integrations:** Cloudinary (signed upload for the org logo),
Google Maps JS + Geocoding APIs (address autocomplete, area-polygon drawing,
building/area map markers), transactional email (welcome mail, verification,
backup notices) through the shared email-service microservice
(`core/email_service.py`, `POST {EMAIL_SERVICE_URL}/send`, fixes103) with
Gmail SMTP as the fallback when the service fails, Anthropic's API (the natural-language
CRM query assistant, §5). All configured via env vars per host — see
`docs/archive/deployment.md` for the exact var names (may lag newer
integrations; the source of truth is `backend/app/config.py`).

## 3. Multi-tenancy & auth

Every business record hangs off an `organization_id`. A JWT (issued at
`/api/auth/token`) carries the user's `role`: `admin` | `staff` | `shliach`,
plus a platform-level `superadmin` role that sits outside all tenant data
(manages orgs from `/dashboard/admin`). The same email/username can be
registered in **more than one organization** (e.g. one person is staff at
org A and an activist at org B) — login matches credentials first, and if
they resolve to several orgs the response asks the client to pick one
(`requires_org_selection`) before issuing a token; a single match logs in
directly as today. Roles gate almost everything:
- **admin** — full access, all settings/admin pages.
- **staff** — like admin minus user/org management.
- **shliach** (activist) — scoped to their own coverage (see §6); lands on
  their own dedicated home page, not the general dashboard.
- **campaign_manager** — Apartments/Tasks/Campaigns/Users management, no
  Contacts/Visits/global settings.

**Public activist self-registration (fixes65).** Besides admin-provisioned
accounts, an org can publish a branded public page at `/org/<slug>`
(`Organization.slug`/`public_subtitle`/`public_gallery`, edited in
Settings) with inline sign-in and — when `self_registration_enabled` is on —
activist registration (`/api/public/*`, no auth, instant access, no email
verification). A registration creates the same Contact + ContactShliach +
`role=shliach` User trio an admin would, marks `User.registration_source`
(`public`|`qr`), and emails the org's admins from a background task. A
valid QR claim token (below) also authorizes registration, regardless of
the switch.

## 4. Core data model

The full table list lives in `backend/app/models.py` (33 tables). The
entities that matter for orienting yourself:

- **Organization** — the tenant. Carries branding, map defaults, and a
  free-form `shliach_view_config` JSON blob (the Shliach Role Config Panel's
  settings).
- **User** — a login. `role` drives permissions; for a `shliach` role it's
  linked to a `ContactShliach` (see below) — resolve that link via
  `core/shliach.py::resolve_shliach`, which falls back to email matching
  when the direct FK is missing (a recurring gotcha, see §7).
- **Contact** — the shared "person" table. `contact_type` splits it into two
  very different sub-records:
  - **ContactMekurav** — the actual outreach target (donor/family). Carries
    pipeline status, color tag, priority, tzedaka potential, etc.
  - **ContactShliach** — an activist. **Versioned**: an edit retires the
    current row (`is_display=False`) and inserts a new one; `root_id` chains
    a lineage. Covers **Areas** and **ReportNumbers** via M2M link tables.
- **Area → Building → Floor → Apartment** — the geography. Apartment is
  **also versioned** (same pattern as ContactShliach — editing retires and
  replaces). A Building's `area_id` places it on the map; a Floor gives an
  apartment its natural sort position (with `"L"` sorting before `1`).
  **BuildingType** (fixes63, global like `Role`) is `building` |
  `town_house` | `divided_town_house`, backing `Building.building_type_id`.
  A town house (`is_town_house=True`) gets no floors — one auto apartment
  instead — and starts as `town_house`; adding a second unit later flips it
  to `divided_town_house`. `Building.is_townhouse` (derived property,
  `building_type_id == "town_house"`) drives the small-house vs. standard
  building icon.
- **ReportNumber** — an organizational grouping independent of geography;
  both apartments and activists attach to one, and it drives the mandatory
  grid sort order (Report Number → Building → Floor).
- **AdminArea** — a separate, flat administrative grouping for mekurav
  contacts (name + comments), unrelated to the geographic `Area`/polygon
  system — don't conflate the two "area" concepts.
- **VisitHistory** — a logged visit to a mekurav contact; custom fields and
  the "Mivtzoim" checklist live here (not on the contact itself).
- **SignificantDate** (+ per-date reminders) and **Donation** — mekurav-only
  history. A background scheduler (`app/scheduler.py`, APScheduler) scans
  due reminders and emails the covering activist/assigned user; a no-op if
  APScheduler isn't installed.
- **PicklistDefinition / PicklistValue / PicklistLink** — the generic
  dropdown-field engine. Every constrained field (status, color tag, Jewish
  status, campaign status...) is a row here, not a hardcoded enum, so an
  admin can rename/reorder/add options. A definition's `is_system=True`
  means it ships with the app and **cannot be deleted** (only its options
  can change) — see §7 for why that trips people up. An individual
  *option* can't be deleted (deactivated or hard-deleted) while live
  records use it (fixes72): `GET /api/picklists/{id}/usage` returns a
  per-entity breakdown with sample records, and `DELETE ?hard=true` 409s
  while in use. Only active apartment versions count; links held by
  retired versions are purged with the value.
- **CustomFieldDefinition / CustomFieldValue** — the generic *free-typed*
  field engine (text/number/boolean/date), parallel to the picklist engine,
  usable on any entity type.
- **FieldLocalization** — every Hebrew UI label the app shows, keyed by a
  technical name; **every new Hebrew string needs a row here** (see §7).
- **FieldSetting** — "Manage Fields": org-wide show/hide for a given field,
  independent of any one user's column preferences.
- **UserPreference** — per-account UI state (column choices/order, filters,
  locale) that follows the account across devices.
- **OrganizationPreference** (`organization_prefs`, fixes54 §8) — superadmin-
  managed per-org feature toggles, same key-value-JSON shape as
  UserPreference. Area→Building→Apartment→Activist display cascades (an
  ancestor off forces every descendant's *effective* value off regardless of
  its own stored value — see `app/core/org_prefs.py`); `ai_query_enabled` is
  a standalone switch. Effective flags ride along on `/api/auth/me` as
  `organization.feature_flags`, gating the sidebar nav and each module's own
  page (`isFeatureEnabled` helper in `lib/auth.tsx`).
- **Campaign → Task → TaskReportNumber** (fixes58) — a Task gives one
  activist (`volunteer_user_id`, a real `users.id`) apartment access to its
  report numbers while ACTIVE under an active Campaign
  (`routers/apartments.py::_shliach_apartment_ids`). fixes65: the volunteer
  is nullable — an **orphan** task sits in an unassigned pool until someone
  claims it by scanning the QR on its printed sheet (`/tasks/claim/<token>`,
  token = task guid + HMAC, nothing stored; dead once the task is COMPLETED
  or deleted), or the office enters the paper results (`claimed_via='paper'`
  locks it). `claimed_at`/`claimed_via` audit the claim; unassign returns it
  to the pool and old printouts keep working. **TaskPaperEntry** logs each
  office data-entry session with who performed the work (registered user /
  free-text name / unknown).
  fixes98: a **text task** (`tasks.task_text`) has free-text instructions
  instead of report numbers (no apartments). Assigning a task to an activist
  (create / bulk / reassign — not a self-claim) emails them in the
  background (`core/activist_emails.py`): the org's Hebrew + English text from
  shliach-config (`shliach_view_config.task_email_text_he/en`), each task's
  first address or text, and a link to `/org/<slug>`. Self-registration
  (org page or task QR) sends the standard welcome email with that link.
- **ShliachReportCompletion / ShliachSystemComment / ShliachAnnouncement** —
  the activist self-service loop: activists submit the first two, admins
  author the third (see §6).
- **EmailTemplate** — admin-editable (WYSIWYG) HTML templates for
  transactional mail (activist/user welcome, tenant verification, etc.),
  sent with the org's name/reply-to so mail reads as coming from the org.
  Each template = a Hebrew RTL + an English LTR full HTML document, built
  from `backend/HTML/email_layout_{he,en}.html` (defaults in
  `core/email_templates.py`); the sent mail stacks Hebrew above English.
  Header logo = the org's logo for activist mail (welcome, password reset),
  the platform logo otherwise; footer = platform logo.
- **OrgBackup** — org-scoped DB snapshots (admin-triggered, 10 kept/org).
- **ActivistMessage / OrgActivistStats** (fixes98) — admin "messages for
  activists" (`language` he|en, shliach-config tab) shown in street2's
  every-5-apartments celebration, alternating with the Rebbe quotes (merged
  client-side, `lib/celebrationItems.ts`). Messages keep
  `{organization_name}` / `{number_of_apartments}` / `{number_of_jews}`; the
  device fills them from the org's one stats row, which is computed once on
  first use (and seeds the first he/en message), then admin-edited or
  recalculated in Settings → "Activist data" (`/api/activist-messages/*`).

## 5. Feature areas (by dashboard route)

- **Global search** (header bar, every dashboard page except superadmin) —
  `GET /api/search` matches contacts/areas/buildings/apartments by
  name/address/phone/email, org- and role-scoped, grouped results in a
  dropdown.
- **`/dashboard/ai/query`** — natural-language CRM query assistant. The LLM
  (Anthropic) never sees or returns raw SQL — it returns a constrained JSON
  `{table, filters}` intent that `app/crm_manifest.py` validates against an
  explicit allowlist before turning it into a scoped query. (Earlier
  incarnation was an open-ended "digital twin" chat via OpenRouter — fully
  replaced by this constrained design.) Admin/staff only — the Activist role
  has no access at all (nav, page, and the endpoint itself all block
  `shliach`); also gated org-wide by the superadmin `ai_query_enabled`
  toggle (fixes54 §7/§8).
- **`/dashboard/contacts`** — the mekurav CRM: filterable/sortable grid,
  customizable + reorderable columns, inline editing, bulk edit, visit
  logging, donations, significant dates, global search.
- **`/dashboard/apartments`** + **`/dashboard/buildings`** +
  **`/dashboard/areas`** — the geography CRM, with building-group
  aggregation, bulk edit, versioned edit history, coordinate/polygon maps.
- **`/dashboard/report-numbers`** — manage report numbers; calculated
  Jewish-status counts and covering-activist links per number.
- **`/dashboard/reports/create`** — RTL PDF report generation (jsPDF, with a
  logical-mode bidi patch — never hand-reverse Hebrew for it).
- **`/dashboard/users`** — unified directory of logins + activist contacts;
  admin-only. An email-less ("No email") activist still gets a `User` with
  `is_manual=True` (no login) so they can be assigned tasks.
- **`/dashboard/campaigns`**, **`/dashboard/tasks`** — campaigns and tasks;
  the Tasks grid filters the orphan pool, prints a task sheet PDF
  (`lib/taskPdf.ts`, QR only while unassigned, disabled for 0 apartments),
  unassigns/assigns, and links to `/dashboard/tasks/<id>/paper-entry`.
  fixes104: the grid has a contacts-style filter bar + column chooser
  (DB prefs `tasks.hiddenColumns`/`tasks.columnOrder`), "print all
  displayed tasks" (one PDF, one sheet per task, `generateTasksPdf`), and the
  org's own task fields — task picklists (Picklists page → Tasks tab, or a
  select custom field) + non-select `entity_type="task"` custom fields,
  stored as PicklistLink/CustomFieldValue under `entity_table="tasks"` — as
  columns, filters (`picklist=`/`custom_field_filter=` on
  `/api/tasks/list`), editable fields on the task page, and lines under the
  sheet title (chosen in the print-settings modal, `lib/taskCustomFields.tsx`).
- **`/org/<slug>`**, **`/tasks/claim/<token>`** — the two public (no-login)
  pages; see §3.
- **`/dashboard/activist`** — an activist's own dedicated landing page:
  links to their own profile edit + apartments, "Report completed"/
  "Comments about the system" actions, admin-announcement feed.
- **`/dashboard/shliach-config`** — admin panel controlling what activists
  can see/edit: default filters/columns, per-Apartment-field "Edit Lock"
  (fixes54 §6 — distinct from the self-edit locks below), a "Customize
  fields" kill switch, self-edit field locks for the activist's *own contact
  profile* (name/phone/notes — a separate thing from the Apartment edit
  locks, easy to conflate since both pages use "self-edit" wording), and the
  announcements feed they see.
- **`/dashboard/picklists`**, **`/dashboard/custom-fields`**,
  **`/dashboard/fields`**, **`/dashboard/localization`** — the admin
  meta-layer: manage dropdown options, custom fields, field visibility, and
  UI translations.
- **`/dashboard/settings`**, **`/dashboard/admin`** — org settings/branding;
  platform superadmin tenant management, including per-org feature toggles
  (Area/Building/Apartment/Activist display cascade + AI query — fixes54
  §8, see OrganizationPreference in §4). System settings
  (`/dashboard/admin/settings`) hold two notification recipient lists in
  `system_settings` (fixes100): new-organization signups
  (`pending_signup_notify_emails`) and server errors
  (`error_notify_emails`, every error in every org, on top of the org's own
  `errors_admin_emails`). While a list is empty, mail falls back to env
  `PLATFORM_ADMIN_EMAIL` / `SUPERADMIN_EMAIL`.
- **Error capture** (fixes75/101/102) — server 500s, errors caught and
  logged via `logger.exception` under `app.*` (`BackgroundErrorHandler`,
  org taken from the request's user via a contextvar), and browser crashes
  (`POST /api/logs/client-error`, React error boundaries) all land in
  `error_logs` and are emailed (org list + superadmin error list,
  throttled).
- **Activity log** (fixes102) — `activity_logs`: per org, off by default
  (`organization_prefs.activity_log_enabled`, superadmin toggle). Every
  successful mutating `/api/*` request is recorded by middleware, with the
  action derived from the route template; page views come from the
  dashboard layout. Superadmin-only tab on the Logs page; 90-day purge
  job in `scheduler.py`.
- **Instinct API** (`backend/app/routers/instinct/`, no UI route) — a
  shared-key (`X-Instinct-Key`) machine API for a WhatsApp/voice assistant,
  scoped to env `INSTINCT_ORG_ID`: contact search/create, visits with a
  lightweight follow-up (`visit_history.followup_task`/`followup_done`,
  `visit_history.apartment_id`), contact/visit custom-field writes, apartment
  search/create/versioned-edit, daily stats. Draft-first: contacts and
  apartments it creates carry `source='instinct'`, `status='draft'` and stay
  out of the regular lists until approved (contacts: the Pending approval
  section; apartments: API `status='active'` only so far). Unmappable input
  is parked in notes (`contacts.notes`, `visit_history.notes`,
  `apartments.apartment_notes`). Specs: `docs/system_api.md`,
  `docs/system_api_part2.md`.

## 6. The activist ("shliach") experience, end to end

An activist logs in → lands on `/dashboard/activist` (their own contact must
be linked; falls back to apartments/contacts if not) → sees their assigned
apartments (scoped server-side by their Area/ReportNumber coverage), an
announcement feed, and can submit "Report completed" / "Comments about the
system". Admins configure what they can see/edit from
`/dashboard/shliach-config` and review their submissions on
`/dashboard/messages-from-activists`.

## 7. Recurring gotchas (worth knowing before you touch related code)

- **Versioning, not mutation**: Apartment and ContactShliach edits create a
  *new row* and retire the old one. Queries must filter `is_display=True`;
  IDs change on every edit.
- **Shliach identity resolution**: always resolve via
  `core/shliach.py::resolve_shliach` (FK first, email fallback) — a raw
  `user_id` lookup silently breaks for imported/reprovisioned activists
  (this exact bug disabled self-edit entirely for affected accounts, fixed
  in fixes54).
- **`is_system` picklists can't be deleted** from the Picklists UI, even
  admin-added-*feeling* ones like `manager_jewish_status` — only hidden
  per-column/per-page. Confusing when a field nobody remembers requesting
  shows up with no delete button.
- **Every Hebrew UI string needs a `FieldLocalization` seed row**
  (`backend/app/seed.py`'s `LOCALIZATION` list) — a `t()` fallback string
  alone isn't enough for the localization system to be complete.
- **RTL + adjacent digits can visually overlap**: two sibling elements that
  each start/end with a digit, inside an RTL context, can get
  bidi-reordered on top of each other even when their CSS margins are
  correct — fix with `unicode-bidi: isolate`, not more margin.
- **`sticky top-0` needs a bounded, actually-scrolling ancestor** — an
  `overflow-x-auto`-only wrapper never scrolls vertically itself, so a
  sticky child just scrolls away with the page.
- **Only the active sort column shows an indicator by convention pre-fixes54
  patch** — every sortable header should show a dim neutral arrow when
  inactive, not just the active one, or the affordance is invisible.
- **Docker/Next dev can serve stale code** on Windows — if a new route
  404s, clear `.next` and restart the frontend container before assuming a
  code bug.
- **Never commit/push without an explicit ask** — a push is a production
  deploy here, not a save point.

## 8. Where to look for more

- **`CLAUDE.md`** — the always-loaded project instructions (short).
- **`docs/fixesN.md`** (+ `docs/archive/` for older ones) — the historical
  changelog, one file per round of requests, each with a plan doc
  (`fixesN-plan.md`) and a closing "Progress Log" with evidence.
- **This file** — current-state map; start here, then drill into code or
  the relevant `fixesN.md` for the "why."
