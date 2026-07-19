# Development Sprint: Feature Additions and Optimizations
make fixes30-plan.md before starting

---

## STATUS: DONE — code complete and verified, UNCOMMITTED (the user commits/pushes themselves)

Plan: `docs/fixes30-plan.md` (written first, per the instruction above).
Evidence: **327 backend tests** (7 new in `tests/test_fixes30.py`),
`tsc --noEmit` clean in the frontend container, **20/20 headless-Chrome
drive checks** (2026-07-19) covering every section below.

---

## 1. Apartments Module

### Building Aggregation & Customization
* [x] **Building Aggregation:** toggle **קיבוץ לפי בניין** on the apartments
  page groups the rows under per-building header rows (building, area, and the
  building's *filter-scoped* apartment count from the new
  `GET /api/apartments/building-aggregates`). Sorting locks to building while
  grouping so groups stay contiguous across pages. Drive: 2 header rows,
  correct counts (3/1), sort select disabled.
* [x] **Field Customization:** the "התאמת שדות" panel now carries an
  **איש קשר** chip that shows/hides the contact column (DB preference
  `apartments.showContact`, default on — kept separate from the stored
  fields array so existing saved selections keep the column). Drive: hidden
  and restored.

### Fast Inline Editing
* [x] **Jewish status**, **Campaign status**, **Mezuzah** edit in place from
  the list rows (InlineEdit + picklist select, commit-on-select). Each save is
  a fixes19 versioned edit — the row swaps to the new active id in place.
  Drive: edit saved, value persisted, id changed (95→99).

---

## 2. Contacts (`Contact_Mekurav`)

### List Display Dashboard (`dashboard/contacts`)
* [x] **Quick Visit Action:** a 📅 button in each row's quick-actions cell
  opens a modal with the shared visit form pinned to that contact
  (`POST /api/contacts/{id}/visits` — open to any org member). Drive: visit
  created from the list, verified via the API.

### Contact Card Detail Page (`dashboard/contacts/[id]`)
* [x] **Dynamic Segment Ordering:** a **⚙ סדר תצוגה** button opens a panel
  with ↑/↓ reordering for the four segments; the order is a DB preference
  (`contact.segmentOrder`) that follows the account. Segments keep their
  existing visibility rules (visits/dates: mekurav; donations: admin).
  Drive: main moved below visits, order survives reload.
* Segments covered: main contact info (`תצוגה עיקרית של איש קשר`), visit
  history, significant dates, donation history.

---

## 3. Reports Module

* [x] **Flexible Report Creation:** `dashboard/reports/create` gained a mode
  switch — **לפי מספרי דוח** (unchanged) / **לפי בחירת דירות**: pick any n
  apartments in a searchable multi-select ("apartment — building" labels) and
  generate the same PDF grouped by building only; apartments without a report
  number are included. Backend: new repeated `apartment_ids` filter on
  `GET /api/apartments/list`. Drive: PDF generated from a hand-picked pair
  (one with no report number), no errors.

---

## 4. Shluchim Role Display

* [x] **Location Navigation:** in shliach sessions every rendered building
  address is a Google Maps link (`mapsHref` in `lib/contactActions.ts`,
  `maps/search/?api=1&query=…`, opens in a new tab): the apartments-list
  building column, the apartment card's "כתובת בניין" row, and the area
  page's building addresses. Other roles keep the current plain text /
  internal links. Drive (shliach login): both links verified, scoping intact.
