# Plan — fixes54

Written before coding, per the spec's own instruction (`docs/fixes54.md` line 2).

---

## 1. Apartments (`/dashboard/apartments`)

### 1.1 Sorting arrows

**Read:** Apartments picks its sort field from a `<select>` (`sort`/`onSortChange`/
`dir`/`onDirToggle`, backend `Literal["floor","label","resident","building",
"created","hierarchy"]`), unlike Report Numbers' clickable `<th>` headers with
`↑`/`↓` glyphs. The backend genuinely only knows how to order by those 6 keys
(`apartments.py::_sort_keys`) — `jewish_status`/`campaign_status`/
`mezuzah_status`/`language` live in the generic `PicklistLink` table and any
admin-added custom field/picklist lives in an even more generic table; sorting
SQL-side on those needs a join per field, not a column reference. Report
Numbers' "every column" is true only because it fetches its *entire*
(unpaginated, org-scoped, small) dataset and sorts client-side — Apartments is
30k+ rows, server-paginated, so client-side sorting the loaded page only would
silently lie about the rest of the dataset.

**Judgment call:** keep the sort **field selection** driven by the same
backend query, but replace the `<select>` + separate arrow-toggle-button with
real clickable `<th>` headers carrying `↑`/`↓` (mirrors Report Numbers'
`SortHeader`) for every column that already maps (or can cheaply map with one
extra join) to a backend column: apartment name/label, resident, building,
area (`Building.area_id → Area.area_name`, one outer join), report number
(`ReportNumber.name`, already conditionally joined for "hierarchy"), notes,
phone, email (plain `Apartment.*` columns, zero extra joins). Picklist-backed
columns (jewish/campaign/mezuzah status, language) and every dynamic custom
field/custom picklist/linked-contact column get **no** click-to-sort — adding
generic multi-table-join sorting for those is a disproportionate lift for a
"add arrows" ask and isn't attempted here. The existing sort `<select>` for
"hierarchy"/"created" (which aren't rendered grid columns) stays as a fallback
control alongside the headers, since those have no column to click.

**Steps (backend):** `apartments.py`: extend the `sort` `Literal` (both
`list_apartments_enriched` and anywhere else it's declared) and `_sort_keys`
with `"area"`, `"report_number"`, `"notes"`, `"phone"`, `"email"`; join `Area`
(outer, via `Building.area_id`) when `sort == "area"` and `ReportNumber`
(outer) when `sort in ("report_number", "hierarchy")`, matching the existing
conditional-join pattern.

**Steps (frontend):** `apartments/page.tsx`: turn the header `<th>`s for
apartment name / resident / building / area / report_number / notes / phone /
email into buttons calling `onSortChange(key)` (toggling `dir` when already
the active key, same as `onSortClick` on Report Numbers), rendering `↑`/`↓`
when active. Keep the existing `<select>` for "hierarchy" and "floor"
(floor isn't a rendered column) and the group-by-building control as-is.

### 1.2 Single-apartment buildings skip grouping

**Read:** `groupByBuilding` always renders a header `<tr>` (building name +
area + `{n} דירות` badge) before a building's row(s), regardless of count
(fixes53 §2 removed the old collapse toggle, not the header itself).

**Steps:** `apartments/page.tsx` — gate the existing header-row block on
`(buildingCounts.get(a.building_id) ?? 0) > 1` in addition to the existing
"first row of this building" check, so a building with exactly one apartment
(a townhouse) renders its single row directly, indistinguishable from
non-grouped mode.

### 1.3 Area-name / count text merging

**Read:** current code already renders building name, area name and the
count badge as three separate `<span>`s with `ms-2` margins between them —
no obvious static-code merge. Will verify live once the dev containers are
up; if reproduced, the fix is spacing/markup at that exact block, if not,
this item closes as "not reproduced, already spaced correctly."

### 1.4 Sticky header actually failing to stick

**Read:** the table sits in `<div className="bg-white rounded-xl shadow-sm
overflow-x-auto">` — no vertical bound. Per the CSS overflow spec, setting
`overflow-x` to a non-`visible` value forces the computed `overflow-y` to
`auto` too, but since this div's height is `auto` (grows to fit content) it
never actually overflows vertically itself, so it never becomes a real
scrolling frame — `position: sticky` computed against a scrolling ancestor
that itself never scrolls behaves like a plain non-sticky element as the page
scrolls past it. This matches the report exactly: the `sticky top-0` classes
are present (fixes52 §2.5) but don't visibly do anything.

**Steps:** give that wrapper a bounded height + its own vertical scrollbar
(`max-h-[75vh] overflow-y-auto`, alongside the existing `overflow-x-auto`) so
it becomes a genuine scrolling frame and `sticky top-0` has something to
stick within, instead of relying on page-level scroll.

---

## 2. Report Numbers (`/dashboard/report-numbers`)

**Read:** every column already renders via `SortHeader` with `↑`/`↓` (this
page's own dataset is small/unpaginated, entirely client-sorted) — sorting
arrows are already done, nothing to add. The column picker, however, is
toggle-only buttons (no reordering) — Contacts' "Customize Columns" panel
(drag via `useSortableList` + ▲/▼ fallback buttons, `columnOrder` persisted)
is the target shape.

**Steps:** add `fieldOrder: OptionalColumn[]` (persisted, `usePersistentState`)
alongside the existing `fields` visibility array; render the same
drag-container + ▲/▼ pattern Contacts uses (`useSortableList`,
`data-sort-key`, active chips first in their order, inactive chips after,
`data-sortable-disabled` on inactive ones) scoped to this page's 4 optional
columns; the table's `<thead>`/row-mapping iterates `fieldOrder` (filtered to
`fields`) instead of the fixed `OPTIONAL_COLUMNS` order. Not extracting a
shared `<CustomizeColumns>` component — the two pages' column shapes (fixed
enum vs. `GridColumn` union) differ enough that a shared abstraction would
need its own generic-typing layer for 4 checkboxes' worth of reuse.

---

## 3. Contacts (`/dashboard/contacts`)

### 3.1 Remove the standalone sort box; header sorting arrows

**Read:** backend `/api/contacts/list` only supports `sort: "created"|"name"`
— same paginated-large-dataset constraint as Apartments §1.1.

**Steps:** delete the `sort.label` `<select>` + direction-toggle `<button>`
block from the header row. Turn the "שם" (name) `<th>` into a clickable
sort-arrow header for `sort="name"` (mirrors Report Numbers), and add a
second clickable header for whichever active optional column is `"created"`
(if the `created` column is on) for `sort="created"` — clicking either toggles
`dir` the same way the removed button did. No backend change needed (both
keys already exist).

### 3.2 Section border framing

**Read:** already fully implemented (fixes52 §1) — every segment
(`main`/`visits`/`visitSummary`/`dates`/`donations`) alternates
`border-status-magenta/30` / `border-black/70` by render position. Nothing to
do; verified live in §"Verification" below.

### 3.3 Remove the "back to activists" link

**Read:** the top-of-page back link is `contact.contact_type === "shliach" ?
Link(/dashboard/users, "back to activists") : Link(/dashboard/contacts, "back
to contacts")`. "Activists" have no standalone list page any more (fixes42
§4A merged that nav entry into Users), so the label/destination is stale —
and for a shliach viewing their own profile it's actively broken (`/dashboard/
users` redirects any non-admin away, fixes52 §5). Literal removal per the
spec's wording, not a relabel to "back to Users".

**Steps:** `contacts/[id]/page.tsx` — drop the `contact_type === "shliach"`
branch entirely; render the "back to contacts" link only (still gated so it
never appears when it would just bounce a shliach who can't reach
`/dashboard/contacts`, e.g. `isOwnShliachProfile`).

---

## 4. Messages from Activists (`/dashboard/messages-from-activists`)

**Read:** both lists (`report-completions`, `system-comments`) fetch their
**entire** org history with no params — small/moderate volume (an admin log,
not a customer-facing list), so client-side search + pagination is
proportionate; no backend/query-param changes.

**Steps:** one shared `<input>` above both sections filtering each list's
rows by activist name (`contactFullName`) plus (for completions) the status
label and comments, (for comments) the comment text — case-insensitive
`includes`. Add the same prev/next pager pattern Contacts uses (`page`/
`pageSize=20` local state per list, `Array.slice`), independent state for
each of the two lists since they're unrelated datasets.

---

## 5. Shliach Configuration (`/dashboard/shliach-config`) — activist announcements

**Read:** no existing table/endpoint for admin-authored activist-facing
announcements. `RichTextEditor` (contentEditable + HTML-source toggle,
built for the email-template WYSIWYG) is reusable as-is for
`message_content`.

**Steps (backend):**
- New model `ShliachAnnouncement` (`shliach_announcements` table):
  `id`, `guid`, `organization_id` (FK), `message_title` (String), `
  message_content` (Text, HTML), `is_visible` (Boolean, default `True`),
  `created_at`, `updated_at`. Mirrors `ShliachReportCompletion`'s shape.
- Alembic migration, `down_revision = "6c7d8e9f0a1b"` (current head).
- `schemas.py`: `ShliachAnnouncementCreate`/`Update`/`Out`.
- `routers/shliach_messages.py`: `GET /api/shliach-messages/announcements`
  (any authenticated org member — read access parallels the picklist-registry
  read rule: everyone reads, only admins write; a shliach's landing page
  needs this) returning every row for an admin caller, but only
  `is_visible=True` rows for a non-admin caller (the endpoint itself filters,
  rather than trusting the frontend to hide invisible ones); `POST`/`PUT
  /{id}`/`DELETE /{id}` admin-only (`require_admin`), full CRUD.

**Steps (frontend):**
- `shliach-config/page.tsx`: new "הודעות לפעילים" section — a data grid
  (title, visible toggle, updated date, edit/delete) below the existing
  settings form, plus an add/edit form using `<RichTextEditor>` for the HTML
  body. Own local CRUD (create/list/patch/delete), independent of the
  settings form's single PUT-on-submit flow (different resource, own save
  cadence — editing one announcement shouldn't require re-saving every
  filter/lock setting on the page).

---

## 6. Dedicated Activist landing page + self-edit permission bug

### 6.1 New landing page

**Read:** a shliach today lands directly on `/dashboard/contacts/{contact_id}`
(`dashboard/page.tsx`'s redirect) — the generic contact-detail page, which
already carries the self-edit toggle + "Report completed"/"Comments about the
system" buttons (fixes53 §7) inside its `main` segment. The spec wants a
**separate** landing page instead, linking out to that same edit page (not
replacing it) plus the apartments grid, with its own copies of the two action
buttons and an announcement feed.

**Judgment call:** extract `ReportCompletionModal`/`SystemCommentModal` out
of `contacts/[id]/page.tsx` into a shared component
(`components/ShliachSelfServiceModals.tsx`) so both the contact page (keeps
its buttons — still useful mid-edit) and the new landing page use the same
modals instead of duplicating ~150 lines.

**Steps:**
- New `components/ShliachSelfServiceModals.tsx` exporting
  `ReportCompletionModal`/`SystemCommentModal` (moved verbatim); update
  `contacts/[id]/page.tsx` to import them.
- New `app/dashboard/activist/page.tsx`: gated to `isShliach` (else redirect
  to `/dashboard`); fetches the caller's own apartments total
  (`/api/apartments/list?page=1&page_size=20`, already self-scoped
  server-side for a shliach) and the visible announcements
  (`/api/shliach-messages/announcements`). Renders: welcome heading, a link
  card to `/dashboard/contacts/{user.shliach.contact_id}` ("edit your data"),
  a link card to `/dashboard/apartments` ("your apartments"), the "Report
  completed" button (rendered only when the apartments total ≥ 1) and
  "Comments about the system" button (both open the shared modals), then the
  announcement feed (`message_title` + `dangerouslySetInnerHTML` on
  `message_content`, newest first).
- `dashboard/page.tsx`: shliach-with-linked-contact redirect target changes
  from `/dashboard/contacts/{id}` to `/dashboard/activist`.

### 6.2 Bug: self-edit permissions "not taking effect"

**Read:** `GET /api/auth/me` populates `UserOut.shliach` via
`users.py::_linked_shliach(db, user.id)`, which queries
`ContactShliach.user_id == user_id` **only** — no email fallback. This is the
exact class of bug `core/shliach.py::resolve_shliach` was written to fix
(fixes21): an imported shliach contact, or one whose login was
(re)created separately, has `ContactShliach.user_id IS NULL` even though the
contact and the login clearly belong together by email. For such an
activist, `/me`'s `shliach` comes back `null`, so
`isOwnShliachProfile = isShliach && user?.shliach?.contact_id === contact.id`
is **always false** — the "Edit your data" button never renders, so no field
is ever editable regardless of what `/shliach-config` says. This matches the
report precisely: it isn't the config that's ignored, it's that the gate
which exposes self-editing at all never turns on for affected accounts. Every
other consumer of `_linked_shliach` (`/api/users/{id}`, the PATCH-sync path,
the field-restore endpoint) has the identical exposure.

**Steps:** `routers/users.py::_linked_shliach` — change its signature from
`(db, user_id: int)` to `(db, user: models.User)` and delegate to
`app.core.shliach.resolve_shliach(db, user)` instead of its own bare
`user_id`-only query. Update its 4 call sites (`auth.py::me`,
`users.py::_user_out`, the PATCH sync path, `restore_shliach_field`) to pass
the already-in-scope `User` object instead of `.id`.

---

## Sequencing

1. §6.2 (permission bug) — small, isolated, unblocks live-testing self-edit
   for §6.1.
2. §5 backend (announcements table/endpoints) before §5 frontend and before
   §6.1 (the landing page's feed depends on it).
3. §1.4 (sticky) / §1.2 (single-apartment) — small, independent CSS/JS.
4. §1.1 (apartment sort headers) — backend join additions, then frontend.
5. §2 (report-numbers customize columns), §3 (contacts sort/back-link) —
   independent of everything else.
6. §4 (messages search/pagination) — independent, small.
7. §6.1 (landing page + modal extraction) — last, depends on §5 and §6.2.

Backend test coverage: `backend/tests/test_fixes54.py` — announcements CRUD +
visibility filtering, apartment sort-key additions, `_linked_shliach` email
fallback. Live-drive verification (Playwright, local Docker + Postgres) for
every frontend-only piece afterward (sticky scroll, grouping, sort arrows,
column drag, borders already-done confirmation, back-link removal, messages
search/pagination, WYSIWYG CRUD, and logging in as an affected activist to
confirm self-edit now works and the landing page renders correctly).
