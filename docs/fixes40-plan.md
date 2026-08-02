# fixes40 — Implementation Plan

Source spec: `docs/fixes40.md`. Five independent items.

## 1. `dashboard/custom-fields` — 3-tab layout matching `dashboard/picklists`

### Current state
`dashboard/picklists/page.tsx` groups its definitions into 3 tabs via a
`tabFor(entityType)` helper (`"contacts"` ⊇ contact_mekurav/contact_shliach/
significant_date, `"visit"`, `"apartment"`), a tab bar
(`usePersistentState` + icon + border-bottom-highlight styling), and one
`<section>` per tab with its own scoped "Add" form (fixed `entityType`/
`prefix`, no dropdown).

`dashboard/custom-fields/page.tsx` currently stacks up to 4 always-visible
sections (`contact_mekurav`, `contact_shliach`, `visit`, `apartment`) with
one shared `AddDef` form whose `entityType` is a free-choice dropdown across
all 4.

### Design
- Same `tabFor()` mapping, `usePersistentState("crm.customfields.tab", ...)`,
  identical tab-bar markup/classes (same icons: 👤/📋/🏠) — literal reuse of
  the pattern, not a lookalike.
- Each tab wraps its filtered defs, still grouped by entity_type header
  within the "contacts" tab (it spans 2 entity types) — reuses the existing
  `ENTITY_TYPES`-keyed grouping, just scoped per tab instead of unconditional.
- `AddDef` moves inside each tab section. "contacts" tab keeps its
  mekurav/shliach dropdown (custom-fields already supports both, unlike
  picklists' contacts tab which only offers mekurav — not regressing that).
  "visit"/"apartment" tabs fix `entityType` with no dropdown, matching
  picklists' `AddPicklist` exactly (one visible entity, no choice needed).

---

## 2. `dashboard/contacts` — owner filter permission + search

### Current state
`shliach_can_view_contacts` (`Organization` column, "Activists may view
contacts" toggle in Settings — פעילים רשאים לצפות באנשי קשר) already exists
(fixes18 §6), currently only gates whether a *shliach-role* user can see the
mekurav contact list at all. The "Filter by contact owner" control
(`assignedFilter`) is a plain `<select>` listing every org user
(`/api/users`, all roles), gated on `!isShliach` (admin/staff only see it).

### Design
- New shared helper `frontend/lib/ownerFilter.ts`:
  `visibleOwnerOptions(users, activistsMayView)` → `activistsMayView ? users
  : users.filter(u => u.role !== "shliach")`. Used by both `dashboard/
  contacts` and `dashboard/contacts/visit-summary` (item 3) so the rule
  lives in exactly one place.
- Swap the plain `<select>` for the existing `SearchableSelect` component
  (already used elsewhere in this codebase for single-select DB-backed
  lists) — `value={assignedFilter || null}`, `onChange={(id) =>
  setAssignedFilter(id ?? "")}`, `allowEmpty` with the existing "כל
  המשתמשים" label. No new component needed.
- "restricted user" in the spec = this app's `"staff"` role (existing code
  comments already use "restricted (staff)" interchangeably) — no new role
  value.

---

## 3. `dashboard/contacts/visit-summary` — same owner filter

### Current state
`VisitSummary` (shared by the standalone report and the per-contact
section) has an admin-only `scope_all` checkbox ("view org-wide") when
`contactId == null`; no way to scope to one *specific* other user's
contacts today.

### Design
- Add the identical `SearchableSelect` owner filter (same
  `visibleOwnerOptions` gating) next to the existing `scope_all` toggle,
  shown only when `contactId == null && !isShliach` (mirrors the contacts
  page's own gate — a shliach never sees this section's admin controls
  anyway per existing `scope_all` conditioning).
- Backend: `GET /api/visits/summary` gains `assigned_user_id: Optional[str]`.
  Priority order: `contact_id` > `assigned_user_id` (only honored for a
  non-shliach caller — a shliach account passing this directly would
  otherwise let it self-serve another user's data, since today the "else"
  branch already silently double-scopes shliach to themselves; explicit
  role check keeps that guarantee under the new param) > `scope_all` (admin
  org-wide) > default "mine". `assigned_user_id` open to both admin and
  staff, matching the contacts list's own `assigned_user_id` filter having
  no extra role gate beyond the existing shliach lockdown.

---

## 4. `dashboard/settings` — global label text styling

### Design
- Backend: 3 new nullable `Organization` columns — `label_font_size`
  (Integer, px), `label_color` (String(20), hex), `label_font_family`
  (String(100)) — `null` means "use the app's built-in styling", so no
  existing org needs a backfill. Exposed via the existing `GET/PUT
  /api/organizations/me` (same pattern as `shliach_can_view_contacts`).
- Frontend settings UI: a numeric `<select>` of common px sizes (10–24,
  curated like Word's own size list, not freeform), an `<input
  type="color">` (native HEX picker) with a "reset to default" clear
  button, and a `<select>` of common web-safe/app fonts (Arial, Inter,
  Roboto, Times New Roman, Segoe UI, plus "ברירת מחדל" default/unset).
- Applying it "across the system": this codebase has no single shared
  label component — every page hand-writes its own `<label>`/`<dt>` +
  inline Tailwind classes (`text-sm font-medium`, `text-xs text-gray-500`,
  …), so there is no one component to theme. Pragmatic system-wide
  approach: a small `<LabelStyleInjector>` client component (mounted once
  in `app/dashboard/layout.tsx`, reading `user.organization.label_*`)
  writes a scoped `<style>` tag targeting `label > span:first-child` and
  `dt` — the two consistent "this is a field label, not its value/input"
  markup patterns already used throughout the app — with `!important`
  (a directly-applied Tailwind utility class on the same element always
  wins over inherited CSS, so overriding requires beating it, not just
  cascading past it). Each of the 3 properties is only emitted when the
  org has actually set it, so an untouched org renders unchanged. The
  chosen font gets the existing `--font-sans` Hebrew-safe stack appended
  as a fallback, so a Latin-only pick (e.g. Roboto) doesn't break Hebrew
  glyph rendering.
- Scope note (documented, not hidden): this reaches the two dominant label
  patterns, not literally *every* string in the app (e.g. table `<th>`
  headers, standalone `<span>` labels outside a `<label>`/`<dt>` wouldn't
  match) — a full rewrite of every label across ~40 files is out of scope
  for one settings toggle; this is the same "best-effort system-wide,
  documented gap" tradeoff real theming retrofits make.

---

## 5. `dashboard/reports/create` — apartment column selection + reorder

### Current state (fixes38 §4.2/§4.3/§4.4)
A fixed 6-key `ReportColumnKey` union (`floor`, `apartment_name`,
`jewish_status`, `mezuzah_status`, `language`, `apartment_notes`), rendered
as a `<table>` of checkbox + subheading-text + width-% per row — inclusion
only, explicitly no reordering ("the spec asks only for inclusion, not
reordering" — no longer true as of this round).

### Design
- Expand `ReportColumnKey` to the apartments page's full `FIELD_KEYS` +
  its two always-on identity columns: `floor`, `apartment_name`, `resident`,
  `building`, `area`, `report_number`, `notes`, `phone`, `email`,
  `language`, `jewish_status`, `campaign_status`, `mezuzah_status` (13
  keys) — every value already rides on `ApartmentListItem` from the
  existing `/api/apartments/list` call (`name`, `phone`, `email`,
  `building_name`, `area_name`, `report_number_name`, `apartment_notes`,
  picklist fields), no extra fetch needed. Old saved preferences keyed
  `apartment_notes` (fixes38's name) are silently dropped by the new
  key-membership filter — same graceful-degradation the apartments page
  itself already relies on for renamed/removed keys.
- Also include the org's active `apartment`-scoped custom picklists
  (`GET /api/picklists?entity_type=apartment`, minus the 4 fixed ones) and
  non-select custom fields (`useCustomFieldDefs("apartment")`), `cf:`/`pl:`
  prefixed — full fidelity to "identical to … Customize Fields", which
  itself includes these dynamic columns. Values already ride
  `ApartmentListItem.picklist_values`/`custom_field_values`; labels resolve
  the same way the apartments page already does (`usePicklistsMap` /
  `d.hebrew_label`).
- **"Identical to Customize Fields" is read literally as UI/interaction,
  not just data**: replace the current checkbox-table with the exact
  SortableJS chip panel + ▲/▼ arrow fallback pattern apartments now uses
  (fixes39 §3 — reuses `useSortableList` as-is, zero new drag code). The
  chip panel owns selection + order; a second, small per-*active*-column
  table (in the chip panel's live order) keeps the existing subheading-text
  + width-% inputs, since those are report-specific concepts the apartments
  page has no equivalent of.
- PDF generation (`generatePdf`/`rowValueFor`) extended to resolve all 13
  fixed keys plus the dynamic `cf:`/`pl:` ones; RTL column order (reversed
  for autotable) and width-in-points math are unchanged, just driven by a
  bigger active-column list.

---

## Order of implementation
1. §1 custom-fields tabs (self-contained, frontend-only).
2. §4 settings label styling (backend column + migration, small frontend
   surface, independent of everything else).
3. §2/§3 owner filter (shared helper first, then both call sites; §3 needs
   one backend param addition).
4. §5 reports column expansion + chip-panel reorder (largest single item;
   depends on nothing above but touches the most surface area).
5. Backend: `pytest` full suite. Frontend: `tsc --noEmit`.
6. Live-drive verification (docker-compose) covering all 5 items.
7. Update `docs/fixes40.md` with a `## Status` closeout section per the
   project's spec-closeout rule.
