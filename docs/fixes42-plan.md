# fixes42 — implementation plan

Written before any code changes, per the spec's "make plan file first" instruction.
Source spec: `docs/fixes42.md`.

## §1. `dashboard/contacts/visit-summary` — Contact Owner filter

**Status check:** `components/VisitSummary.tsx` already has an owner filter
(fixes40 §3) — a `SearchableSelect` bound to `assignedFilter`, shown to
admin/staff (`showOwnerFilter = contactId == null && !isShliach`), whose
`emptyLabel` ("כל המשתמשים") clears the filter when picked from the open
dropdown list.

**Gap vs. this spec:** there is no *visible, standing* "Show All Records"
control — clearing the filter today requires opening the combobox and
picking the empty row, which is a hidden affordance, not a call-to-action a
user notices when they want to jump back to the full list. It also isn't a
free action once `scope_all` (admin-only "show org-wide") is layered in —
priorities are implicit.

**Plan:** add an explicit "הצג את כל הרשומות" (Show All Records) button next
to the owner `SearchableSelect`, visible only when a specific owner is
selected, that clears `assignedFilter` in one click (mirrors the existing
"✕ נקה את כל הסינונים" pattern already used on the Contacts page). No
backend change — `assignedFilter=""` already means "no owner filter" server-side.

## §2. `dashboard/reports/create` — Row 2 grey background

**Reading "Row 2":** the page has no literal repeating table where row 2 is
identifiable; it renders as three stacked cards: (1) report notes textarea
[admin-only], (2) the "עמודות הדוח" column-config card (chip picker +
subheading/width table + hint/validation text), (3) source-mode picker +
Generate PDF. Card 2 is the one that is mostly *explanatory/helper text*
(the reorder hint, the total-width caption, the over-100% validation
message) wrapped around the actual controls — matching the spec's own
description of "Row 2" ("contains explanatory/helper text"). Treating the
page's cards as "rows," **Row 2 = the column-config card**.

**Plan:** change that card's wrapper from `bg-white` to `bg-gray-100`
(`frontend/app/dashboard/reports/create/page.tsx`, the div at the "עמודות
הדוח" heading). Everything inside (chips, table, buttons) keeps its own
`bg-white`/transparent styling so contrast is preserved on inputs.

## §3. `dashboard/settings` — font selector fix

**Root cause:** `components/LabelStyleInjector.tsx` only ever emits a rule
for `label > span:first-child, dt` — i.e. only field *labels* pick up
`label_font_family`. `globals.css` defines `body { font-family:
var(--font-sans); }`, and nothing else in the app overrides `--font-sans` or
sets its own `font-family` (confirmed: no `font-sans`/inline font-family
usage anywhere else in `app/`/`components/`). So the org's chosen font never
reaches ordinary body text — exactly the bug report ("fails to update system
fonts").

**Plan:** when `label_font_family` is set, emit a `:root { --font-sans: "<font>",
system-ui, "Segoe UI", "Arial Hebrew", "David", sans-serif; }` rule (keeping
the app's existing Hebrew-safe fallback stack) instead of/in addition to the
label-scoped one. Since `body` already reads `var(--font-sans)`, this alone
makes the choice apply system-wide with no other file needing to change.
`label_font_size`/`label_color` stay scoped to `label > span:first-child, dt`
(unchanged; the spec only calls out the font *selector* as broken).

## §4. `dashboard/users` — merge with Shluchim

Two different persistence models back these pages today: **Users**
(`/api/users`, `models.User` rows — every org login, `role` ∈
admin/staff/shliach) and **Shluchim** (`/api/contacts/list?contact_type=shliach`,
`models.Contact` rows). `GET /api/users` already returns *every* role
including shliach (it's only gated by `require_staff_or_admin`, not filtered
by role), so a shliach's login already appears in today's Users table — just
without the geo filters, "recreate login" recovery action, or an add-shliach
shortcut that the dedicated Shluchim page has. The reverse gap matters too:
a shliach *contact* whose login was deleted outright (`login_status ===
"missing"`) has no `User` row at all, so it's invisible unless we also pull
from `/api/contacts/list`.

**Design — unified virtual row set, built client-side, no backend schema
change:**
- Fetch `/api/users` (admin/staff/shliach login rows) as the base set.
- Fetch `/api/contacts/list?contact_type=shliach` (+ existing `area_ids`/
  `building_ids` params) to (a) resolve which shliach rows pass the geo
  filter, (b) get each shliach contact's `login_status`, and (c) surface any
  `login_status === "missing"` contact as an extra synthetic row (no backing
  `User` row) — preserving the recovery flow the old Shluchim page offered.
- Match user ↔ contact by lowercased email (the established sync key,
  fixes14).
- Geo filters (area/building) only constrain shliach-kind rows;
  admin/staff rows are unaffected by them (they have no geography).
- Role filter: multi-select over admin/staff/shliach, default = all (no
  regression from today's "everyone" view).
- Inactive toggle: default **hides** `is_active === false` (and synthetic
  "missing"-login rows, which are inherently inactive); a toggle reveals
  them — new capability, Users page had no such filter before.
- Columns: keep Name/Role/Actions always on; make Email, Phone, Created At,
  Area/Building, Login status optional via a column-picker + SortableJS
  reorder panel, copied from the Contacts/Reports pages' existing chip
  pattern (`useSortableList`, `useDbPreference("users.columns", …)`).
- Inline role change: a `<select>` directly in the row for admin/staff rows
  (`PUT /api/users/{id}` with `{role}`), disabled for the caller's own row
  and for shliach rows (role is contact-linked, unchanged rule from
  `UserForm`'s existing `isShliachAccount` guard).
- Keep the existing "+ משתמש חדש" (UserForm modal) and add back "+ הוסף
  פעיל" (link to `/dashboard/contacts/new-shliach`) on the merged page.
- Nav: drop the separate "פעילים" (Shluchim) entry; `/dashboard/shluchim`
  becomes a redirect to `/dashboard/users` so old links/bookmarks survive.
- No backend endpoint changes needed — both source endpoints already exist
  and already carry every field this needs.

**Explicitly out of scope (not asked for, avoiding over-engineering):** no
new backend "unified users" endpoint/model; no free-text search box (neither
source page had one and the spec doesn't ask for it); pagination stays
client-side like today's Users page (org directories are small — same
justification the current code already documents).

## Cross-cutting

- Every new Hebrew UI string gets a `LOCALIZATION` row in `backend/app/seed.py`
  (idempotent seeding — no manual reseed step needed, confirmed `seed_all`
  runs on every backend startup).
- `tsc --noEmit` + `pytest` + a live headless-Chrome drive before calling
  this done (project rules: verify prod frontend build, SQLite tests miss FK
  bugs — though nothing here touches FK/cascade behavior).
- `docs/fixes42.md` gets closed out per-checkbox with evidence once verified.
