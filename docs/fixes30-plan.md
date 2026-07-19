# fixes30 (round 2) — Implementation Plan

Spec: `docs/fixes30.md` (the previous fixes30 spec was archived to
`docs/archive/`; this file replaces the archived plan for the new round).

## §1 Apartments module

### 1a. Building aggregation (`/dashboard/apartments`)
- New persisted toggle **קיבוץ לפי בניין** (`usePersistentState`,
  `crm.apartments.groupByBuilding`).
- While grouping is on the page forces `sort=building` (the sort select is
  disabled with a hint) so apartments of the same building are contiguous, and
  the table renders a **group header row** whenever the building changes:
  building display name + area + aggregate apartment count.
- Aggregate counts are **filter-scoped, not page-scoped**: new backend endpoint
  `GET /api/apartments/building-aggregates` taking the same filter params as
  `/list` (shliach-scoped, active versions only) returning
  `[{building_id, count}]`.

### 1b. Contacts column toggle in "התאמת שדות"
- The linked-contact column is currently hard-coded. It becomes toggleable via
  a **separate** DB preference `apartments.showContact` (default **true**) —
  deliberately not a new entry in the stored `apartments.fields` array, so
  every existing user's saved column selection keeps showing the column.
- The chip reuses the existing `apartments.contact` label.

### 1c. Inline editing from the list view
- The three picklist columns — **jewish_status**, **campaign_status**,
  **mezuzah_status** — render through `InlineEdit` + `PicklistSelect`
  (commit-on-select, click-away cancels), the exact apartment-detail pattern.
- Save = `PUT /api/apartments/{id}` single-field partial → a fixes19 **versioned
  edit returning a NEW id**; the row is patched in place (`id` + field swapped)
  so pagination/scroll don't reset. Shliach edits outside their assignment get
  the backend 403 → toast (unchanged behavior).

## §2 Contacts

### 2a. Quick visit from the list (`/dashboard/contacts`)
- New per-row quick action (📅, title reuses `visit.add` "הוסף ביקור") beside
  the call/WhatsApp/mail icons; `stopPropagation` so the row click doesn't
  navigate.
- Opens a modal (BatchModal overlay pattern) hosting the shared `VisitForm`
  with `lockedContactId`, saving via `POST /api/contacts/{id}/visits` — that
  endpoint is open to any org member, so no backend change.

### 2b. Contact card segment ordering (`/dashboard/contacts/[id]`)
- DB preference `contact.segmentOrder`, default
  `["main", "visits", "dates", "donations"]`; stored value sanitized like the
  column-keys pattern (unknown keys dropped, missing keys appended).
- A small **⚙ סדר תצוגה** button in the page header opens a config panel
  listing the four segments with ↑/↓ reorder buttons.
- The four sections render by mapping the order array → JSX; each keeps its
  existing visibility condition (visits/dates: mekurav only; donations:
  admin + mekurav).
- Segment names: main = new key `contact.segment_main`
  ("תצוגה עיקרית של איש קשר", per the spec); the rest reuse `visit.history`,
  `significant_dates`, `donation.history`.

## §3 Reports — arbitrary apartment selection
- Backend: `GET /api/apartments/list` (and the shared filter helper) accepts a
  new repeated `apartment_ids` param — the report page fetches exactly the
  chosen apartments, enriched, in canonical floor order.
- `/dashboard/reports/create` gets a mode switch:
  - **לפי מספרי דוח** — existing flow, unchanged.
  - **לפי בחירת דירות** — a `MultiSelectSearchFilter` over all apartments
    (label "מספר דירה — בניין", options loaded from the paged `/list` like the
    existing fetch-all helper). Any n apartments.
- PDF in apartment mode: same table/columns, grouped by building only (no
  report-number level, and rows without a report number are included).

## §4 Shluchim display — Google Maps address links
- New helper `mapsHref(address)` in `lib/contactActions.ts` →
  `https://www.google.com/maps/search/?api=1&query=<encoded>`.
- In **shliach sessions** (the spec scopes this to the shluchim role display)
  every rendered building address becomes an external Maps link
  (`target="_blank"`):
  - apartments list — building column (links the building's full address);
  - apartment detail — the "כתובת בניין" row;
  - area detail — the per-building address lines.
- Other roles keep the current plain text / internal links.

## Cross-cutting
- Every new Hebrew string gets a `LOCALIZATION` seed row (project rule);
  planned keys: `apt.group_by_building`, `apt.group_count`,
  `apt.grouping_sort_hint`, `contact.segment_main`, `contact.display_order`,
  `contact.display_order_hint`, `action.move_up`, `action.move_down`,
  `reports.mode_by_report`, `reports.mode_by_apartments`,
  `reports.select_apartments_placeholder`, `filter.search_apartments`.
- Backend tests for the two API additions (`apartment_ids` filter,
  `building-aggregates`: org scoping, filters, shliach scoping).
- Verification: full backend pytest in Docker, `tsc --noEmit` in the frontend
  container (Vercel-build rule), headless-Chrome drive of each flow.
- No commit/push — the user commits themselves.
