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

Last updated: 2026-08-31 (through fixes54; verified against fixes1-20 archive).

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
building/area map markers), SMTP via Gmail (transactional email — welcome
mail, verification, backup notices), Anthropic's API (the natural-language
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
  can change) — see §7 for why that trips people up.
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
- **ShliachReportCompletion / ShliachSystemComment / ShliachAnnouncement** —
  the activist self-service loop: activists submit the first two, admins
  author the third (see §6).
- **EmailTemplate** — admin-editable (WYSIWYG) HTML templates for
  transactional mail (activist/user welcome, tenant verification, etc.),
  sent with the org's name/reply-to so mail reads as coming from the org.
- **OrgBackup** — org-scoped DB snapshots (admin-triggered, 10 kept/org).

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
  admin-only.
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
  §8, see OrganizationPreference in §4).

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
