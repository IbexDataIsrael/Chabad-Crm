# Task Execution Plan (`plan.md`)
make fixes54-plan.md prior to coding
## Objectives & Core Directives

Implement UI adjustments, grid sorting enhancements, bug fixes, activist dashboard re-architecture, and message configuration tools across the Dashboard routes (`/apartments`, `/report-numbers`, `/contacts`, `/messages-from-activists`, `/shliach-config`, and Activist views).

---

## Task Breakdown

### 1. Apartments View (`/dashboard/apartments`)

* **Sorting Arrows**
  * Add visual sorting indicators/arrows to all grid columns, mirroring the implementation on `/dashboard/report-numbers`.
* **Building Grouping Rules & Bug Fixes**
  * **Single Apartment Rule:** If a building contains only 1 apartment (e.g., townhouse), bypass grouping and display the apartment row directly without an expandable group row.
  * **[BUG FIX] Area Name Text Merging:** Resolve formatting issue where the area name merges directly into the string count describing the number of apartments.
* **[BUG FIX] Sticky Header Positioning**
  * Fix data grid header elements failing to remain fixed (`sticky top-0`) at the top of the viewport during vertical scrolling.

---

### 2. Report Numbers View (`/dashboard/report-numbers`)

* **Sorting Indicators**
  * Ensure sorting arrows are added across every grid column (matching the `Name` field column behavior).
* **Column Customization UI Sync**
  * Replace "Visible Columns" dropdown with the standard "Customize Columns" component used in `/contacts`:
    1. Toggle column visibility (hide / show).
    2. Reorder columns using drag-and-drop mechanics.

---

### 3. Contacts View (`/dashboard/contacts`)

* **Header Clean-up & Sorting**
  * Remove the standalone sorting selection box located in the top header buttons section.
  * Add column header sorting arrows to all data grid columns.
* **Contact Details UI Framing**
  * Apply an explicit border frame around **EVERY** distinct data section on the single contact page.
  * Alternate border frame colors sequentially across adjacent data sections.
* **[BUG FIX] Navigation Link Cleanup**
  * Remove the "back to activists" link on the contact details view.

---

### 4. Messages from Activists View (`/dashboard/messages-from-activists`)

* **Search & Pagination**
  * Implement a central search bar that queries across both active lists simultaneously.
  * Add server-side or client-side pagination controls to each list container.

---

### 5. Shliach Configuration View (`/dashboard/shliach-config`)

* **Database Schema Extension**
  * Create a new SQL table for activist announcement messages with the following fields:
    * `organization_id`
    * `message_title`
    * `message_content` (HTML text)
    * `is_visible` (Boolean toggle flag)
* **WYSIWYG Editor & Data Grid Management**
  * Integrate a rich-text WYSIWYG editor component for generating HTML messages for activists.
  * Display existing messages in an editable data grid interface supporting full CRUD operations.

---

### 6. Dedicated Activists View & Permissions

* **Independent Activist Landing Page**
  * Create a standalone main page interface for activists instead of reusing the generic `/contacts` page.
  * Include navigation links and actions:
    1. Link to edit personal contact data.
    2. Link to view assigned apartments.
    3. **"Report completed"** action button.
    4. **"Comments about the system"** feedback action button.
  * Render an announcement feed displaying all admin messages marked as `is_visible = true`.
  * **Conditional Visibility:** Render the "Report completed" button **only** if the activist's list contains 1 or more assigned apartments.
* **[BUG FIX] Field Editing Permissions**
  * Resolve issue where activist field editing remains blocked or inactive even when explicitly enabled inside `/shliach-config`.

---

## Verification & Testing Steps

1. Verify sorting arrows render on every column across Apartments, Report Numbers, and Contacts grids.
2. Confirm single-apartment buildings render flat without group headers on `/dashboard/apartments`.
3. Test sticky header scroll lock on `/dashboard/apartments` and confirm fix for text merging bug.
4. Drag, drop, hide, and reveal columns using "Customize Columns" on `/dashboard/report-numbers`.
5. Verify section border framing and color alternation on `/dashboard/contacts/[id]`.
6. Confirm removal of the "back to activists" link on `/dashboard/contacts`.
7. Test universal search box and pagination controls on `/dashboard/messages-from-activists`.
8. Create, edit, and publish HTML messages using the WYSIWYG editor on `/dashboard/shliach-config`.
9. Log in as an activist to verify landing page messaging feed, "Report completed" button display rules, and functional profile field editing when toggled on in config.

---

## Progress Log

See `docs/fixes54-plan.md` for the design/scoping notes written before coding.

- [x] **§1 Apartments — sorting arrows**: header `<th>`s for apartment name/
  label, resident, building, area, report number, notes, phone and email are
  now clickable (↑/↓ indicator, mirrors Report Numbers), backed by real
  backend sort keys (`apartments.py::_sort_keys` gained `area`/
  `report_number`/`notes`/`phone`/`email`, with `Area`/`ReportNumber`
  outer-joined only when actually sorting by them). **Scope decision**:
  picklist-backed columns (jewish/campaign/mezuzah status, language) and
  every dynamic custom field/custom picklist/linked-contact column have no
  click-to-sort — the dataset is 30k+ rows and server-paginated, so
  client-side sorting (Report Numbers' approach) would silently lie about
  rows off the current page, and SQL-level sorting on those needs a
  generic-table join per field; disproportionate for this round. The
  "hierarchy"/"floor" sort options (not rendered columns) keep the existing
  `<select>`.
- [x] **§1 Apartments — single-apartment buildings skip grouping**: the
  group header row (building/area/count badge) now only renders when
  `buildingCounts.get(building_id) > 1` — a townhouse's row renders flat,
  identical to ungrouped mode.
- [x] **§1 Apartments — BUG FIX area name / count merging**: root-caused
  live (not a missing-margin bug — the `ms-2` margins were already computing
  correctly). Without an isolated bidi context, two adjacent spans that each
  end/start with digits (a street address ending in a house number,
  immediately followed by the count badge's leading digit) get their boxes
  *visually repositioned by the Unicode Bidi Algorithm* and overlap —
  confirmed via `getBoundingClientRect()`: the badge rendered ~60px too far
  right, overlapping the area-name span, even though `getComputedStyle`
  showed the correct 8px margin on both. Fixed with
  `style={{ unicodeBidi: "isolate" }}` on the building/area/count-badge
  spans; re-measured live afterward — badge and area spans sit exactly 8px
  apart, matching the authored margin.
- [x] **§1 Apartments — BUG FIX sticky header**: the header classes
  (`sticky top-0`) were already present but inert — the wrapping
  `overflow-x-auto` div has no bounded height, so it never actually becomes
  a scrolling frame (per the CSS overflow spec, the implicit `overflow-y`
  computes to `auto` but the div still just grows to fit its content and
  never scrolls itself; the *page* scrolls instead, and a sticky child of a
  non-scrolling ancestor just scrolls away with it). Fixed by adding
  `max-h-[75vh] overflow-y-auto` so the wrapper genuinely scrolls; verified
  live via `getBoundingClientRect()` before/after scrolling the wrapper 400px
  — the header `<th>` didn't move.
- [x] **§2 Report Numbers — sorting indicators**: already fully implemented
  (every column already used a clickable `SortHeader`) — no change needed.
- [x] **§2 Report Numbers — Customize Columns**: replaced the toggle-only
  "Visible Columns" panel with a drag-to-reorder + click-to-toggle panel
  (reuses the shared `useSortableList` hook + ▲/▼ fallback buttons, same
  pattern Contacts already uses), backed by a new persisted `fieldOrder`.
- [x] **§3 Contacts — remove standalone sort box, add header arrows**:
  deleted the `sort.label` `<select>` + direction button; the "שם" header is
  now clickable (sort=name) and the "created" column header is clickable
  when that optional column is on (sort=created) — the only two keys the
  backend's paginated list actually supports.
- [x] **§3 Contacts — section border framing**: already fully implemented
  (fixes52 §1 — alternating magenta/black borders by render position across
  all 5 segments); verified live, unchanged.
- [x] **§3 Contacts — BUG FIX back-link removal**: the `contact_type ===
  "shliach"` branch (which linked to the admin-only `/dashboard/users`,
  labeled "back to activists" — a page that no longer represents a distinct
  "activists" list since fixes42 merged it into Users) is gone; a
  non-shliach contact still gets its "back to contacts" link.
- [x] **§4 Messages from Activists — search + pagination**: one search box
  filters both lists at once (activist name always; status label/comments
  for completions, comment text for comments); each list gets its own
  client-side prev/next pager (20/page) — both lists are small admin logs
  fetched in full already, so no backend/query-param changes were needed.
- [x] **§5 Shliach Configuration — activist announcements**: new
  `shliach_announcements` table (`organization_id`, `message_title`,
  `message_content` HTML, `is_visible`, timestamps) + full CRUD under
  `/api/shliach-messages/announcements` (reads open to any org member but
  non-admins only ever see `is_visible=True` rows, server-filtered; writes
  admin-only). New section on `/dashboard/shliach-config`: a data grid
  (title/visible badge/updated date/edit/delete) plus an add/edit form using
  the existing shared `RichTextEditor` (the same WYSIWYG component the
  superadmin email templates use) for the HTML body.
- [x] **§6 Dedicated Activists View**: new `/dashboard/activist` landing
  page — replaces landing directly on the generic contact-edit page as a
  shliach's default screen on entry (`/dashboard`'s redirect, and the
  `/dashboard/users` non-admin bounce, both point here now). Links to
  "עריכת הפרטים שלי" (the contact-edit page, unchanged) and "הדירות שלי"
  (Apartments, already self-scoped server-side); "Report completed"/
  "Comments about the system" buttons (now shared via a new
  `components/ShliachSelfServiceModals.tsx`, extracted out of the contact
  page so both surfaces use the same modals) — "Report completed" renders
  only when the activist's own apartments total ≥ 1; an announcement feed
  (visible `shliach_announcements`, newest first).
- [x] **§6 BUG FIX self-edit field editing**: root-caused as a *different*
  bug than "the config isn't read" — `GET /api/auth/me` resolved
  `UserOut.shliach` via a raw `ContactShliach.user_id == user_id` query with
  **no email fallback**, unlike `core/shliach.py::resolve_shliach` (written
  for exactly this in fixes21: an imported/reprovisioned shliach contact can
  have a NULL `user_id` link even though it clearly belongs to that login by
  email). For such an activist, `me.shliach` came back `null`, so
  `isOwnShliachProfile` (`isShliach && user?.shliach?.contact_id ===
  contact.id`) was **always false** — the "Edit your data" button never
  rendered at all, regardless of anything configured in `/shliach-config`.
  Fixed by making `users.py::_linked_shliach` delegate to
  `resolve_shliach`'s user_id-then-email fallback (4 call sites updated:
  `/api/auth/me`, the user↔contact sync PATCH path, and the per-field
  restore endpoint all get the fix for free).

**Evidence:**
- New backend tests: `backend/tests/test_fixes54.py`, 4 classes
  (`TestShliachAnnouncements`, `TestApartmentSortAdditions`,
  `TestLinkedShliachEmailFallback`) — including a test that explicitly nulls
  `ContactShliach.user_id` after creation and confirms `/api/auth/me` still
  resolves `shliach` via email. Full backend suite:
  **504 passed, 0 failed**. `npx tsc --noEmit` clean throughout.
- Live-drive (Playwright, headless Chromium, local Docker + Postgres, a
  freshly-registered throwaway admin + shliach + mekurav contact —
  21/21 automated checks green on the final run):
  - Apartments: scrolling the grid wrapper 400px left the header `<th>`'s
    `getBoundingClientRect().top` unchanged (sticky confirmed); a
    3-apartment building still shows its "3 דירות" group header while a
    1-apartment building in the same filtered area shows no header row at
    all and no stray "1 דירות" badge anywhere; clicking the "בניין" header
    shows a ↑ arrow; the area-name/count-badge overlap is gone (measured
    exactly 8px apart, screenshot confirms clean spacing).
  - Report Numbers: the Customize Columns panel's ▲/▼ buttons are present
    and reorder the active columns.
  - Contacts: the "מיון:" sort label/select is gone from the header; the
    "שם" header shows a ↑ arrow on click; a mekurav contact's 5 sections
    show `border-color` alternating between `rgba(214,0,110,0.3)` and
    `rgba(0,0,0,0.7)`, and it still shows "חזרה לאנשי קשר"; viewing a
    shliach-type contact as admin shows no "חזרה לפעילים" text anywhere on
    the page.
  - Messages from Activists: with 22 seeded system comments, the pager
    ("עמוד 1 מתוך 2") appears; searching the shared suffix narrows the list
    to matches; an unmatched query shows the empty-results state.
  - Shliach Configuration: the pre-seeded announcement appears in the grid;
    creating one through the UI (title input + RichTextEditor + save) adds
    it to the grid live.
  - Activist landing page + the permission bug fix, full round trip: logged
    in as a shliach with ≥1 assigned apartment (via a report-number
    assignment) → lands on `/dashboard/activist`; "Report completed" button
    is shown; the visible announcement appears in the feed; clicking
    "עריכת הפרטים שלי" opens the contact-edit page and "עריכת המידע שלך"
    (Edit your data) renders — confirming self-edit is reachable end to end.
- All of this session's temporary/throwaway test data lives only in the
  local dev Postgres container — nothing was touched in any deployed
  environment, and per house rule no commit/push happened without an
  explicit ask.