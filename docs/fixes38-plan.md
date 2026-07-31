# fixes38 plan

## §1.1 / §2.1 — Contacts + Apartments: nav, drag-and-drop, filter toggle

### Root cause

**Manage Areas location.** `frontend/app/dashboard/layout.tsx` builds nav groups as
plain arrays. `admin-areas` currently sits in `placeItems` ("מקומות"/Places,
lines 46-55) alongside areas/buildings/apartments. Spec wants it under the
Contacts nav group instead ("אנשים"/People, `peopleItems`, lines 35-45).

**Drag-and-drop.** Two distinct, concrete bugs, not a vague "flakiness":

1. **Apartments** (`frontend/app/dashboard/apartments/page.tsx`) has a real
   native-HTML5-DnD implementation (`moveField`, lines 413-427), but its
   splice math is direction-dependent:
   ```ts
   const next = [...known];
   next.splice(fromIdx, 1);
   next.splice(toIdx, 0, from);
   ```
   Dragging a chip *rightward* (`fromIdx < toIdx`) lands it **after** the drop
   target (because removal shifts every later index left by one before the
   insert); dragging *leftward* lands it **before** the target. Same gesture,
   opposite outcome depending on direction — this inconsistency is what reads
   as "the reordering doesn't work right."
2. **Contacts** (`frontend/app/dashboard/contacts/page.tsx`) has **no
   drag-and-drop at all** in its columns panel (lines 974-992: plain
   toggle-only buttons, no `draggable`/`onDragStart`/`onDrop`) — reordering is
   simply absent, not merely buggy. Worse, even the *data model* doesn't
   support order: `activeColumns` (line 477) is
   `COLUMN_KEYS.filter((k) => availability[k] && columns.includes(k))` — it
   iterates the **fixed** `COLUMN_KEYS` array, not the `columns` preference
   array, so the persisted order in `columns` is never consulted for
   rendering. Apartments' equivalent, `activeFields = fields.filter(...)`
   (line 545), correctly iterates `fields` and so does respect order.

**Filter toggle nesting.** Both pages wrap the *entire* second filter row
**and** the columns/fields panel inside `{filtersOpen && (<>...</>)}`
(contacts: `page.tsx:694`...`1048`; apartments: `page.tsx:706`...`~982`).
Collapsing the filter section hides the "Visible columns"/"התאמת שדות"
button along with it, which is exactly what §1.1/§2.1 asks to stop.

### Fix

1. `layout.tsx`: move the `admin-areas` entry (lines 49-51) from `placeItems`
   into `peopleItems`, keeping the existing `isShliach` guard.
2. `apartments/page.tsx` `moveField`: fix the insert index so the dragged
   chip always lands in the target's original slot regardless of direction:
   ```ts
   const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
   next.splice(insertIdx, 0, from);
   ```
3. `contacts/page.tsx`:
   - Change `activeColumns` to iterate `columns` (the preference array, which
     carries order) instead of `COLUMN_KEYS`:
     ```ts
     const activeColumns = columns.filter((k) => availability[k] && COLUMN_KEYS.includes(k));
     ```
   - Add the same native-HTML5 drag state/handlers used on Apartments
     (`draggedColumn`, `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd`, the
     corrected `moveColumn` from step 2) to the columns panel (lines
     974-992), rendering active chips first (mirroring Apartments' render
     order fix) so a reorder is immediately visible.
4. Both pages: pull the columns/fields button + its panel **out** of the
   `{filtersOpen && (...)}` fragment into their own always-rendered block
   (state `columnsOpen`/`fieldsOpen` already exists and is independent of
   `filtersOpen`, so this is a JSX restructuring, not a new state variable).

### Verification

- `tsc --noEmit`.
- Headless-drive (per project rule — a "verified" DnD claim must simulate an
  actual `dragTo`, not a mouse-move): on both Contacts and Apartments, open
  the columns panel, drag a column both leftward and rightward, confirm the
  table header order updates to match in both directions; collapse the
  filter section and confirm the columns button/panel stay visible and
  functional.

---

## §1.2 / §1.3 — "Summary of Visits" report + per-contact "Visit Summary"

### Design

No existing count/breakdown widget or date-ranged visits endpoint exists
(`backend/app/routers/visits.py` only has `list_visits(contact_id)` — one
contact, any user — and admin-only `list_all_visits`, neither date-filtered).
This is a net-new feature built on the existing `VisitHistory` model
(`backend/app/models.py:562-599`): `contact_id`, `visit_date`, and the 5
Mivtzoim boolean flags (`tefillin`, `tzedakah`, `shabbat_candles`,
`torah_pamphlet`, `letter_in_torah` — already toggleable via
`field_registry.py`'s `visits.tefillin` etc. keys).

### Backend

1. `backend/app/schemas.py` — add:
   ```python
   class VisitSummaryItem(BaseModel):
       visit_id: int
       visit_date: datetime.datetime
       contact_id: int
       contact_name: str

   class VisitSummaryCategory(BaseModel):
       key: str          # "tefillin" | "tzedakah" | "shabbat_candles" | "torah_pamphlet" | "letter_in_torah"
       count: int
       items: list[VisitSummaryItem]

   class VisitSummaryOut(BaseModel):
       total: int
       categories: list[VisitSummaryCategory]
   ```
2. `backend/app/routers/visits.py` — new `@all_router.get("/summary", ...)`
   (no route conflict: existing `/{visit_id}` routes are PUT/PATCH/DELETE
   only). Open to any authenticated org member (`get_current_user`, not
   `require_admin`) — permission scoping is data-level, not endpoint-level:
   ```python
   @all_router.get("/summary", response_model=VisitSummaryOut)
   def visits_summary(
       date_from: datetime.date,
       date_to: datetime.date,
       contact_id: Optional[int] = None,
       scope_all: bool = False,
       db: Session = Depends(get_db),
       current_user: models.User = Depends(get_current_user),
   ):
       org_id = current_user.organization_id
       q = db.query(models.VisitHistory).filter(
           models.VisitHistory.organization_id == org_id,
           models.VisitHistory.visit_date >= datetime.datetime.combine(date_from, datetime.time.min),
           models.VisitHistory.visit_date <= datetime.datetime.combine(date_to, datetime.time.max),
       )
       if contact_id is not None:
           q = q.filter(models.VisitHistory.contact_id == contact_id)
       elif not (current_user.role == "admin" and scope_all):
           # Standard user (or admin without the "all" toggle): only visits
           # for contacts assigned to them. Inner join drops unlinked visits.
           q = q.join(models.Contact, models.VisitHistory.contact_id == models.Contact.id).filter(
               models.Contact.assigned_user_id == current_user.id
           )
       rows = q.order_by(models.VisitHistory.visit_date.desc()).all()
       categories = []
       for key in _MIVTZOIM_FLAGS:  # reuse the existing tuple in this module
           matching = [v for v in rows if getattr(v, key) and v.contact_id]
           categories.append(VisitSummaryCategory(
               key=key,
               count=len(matching),
               items=[
                   VisitSummaryItem(
                       visit_id=v.id,
                       visit_date=v.visit_date,
                       contact_id=v.contact_id,
                       contact_name=f"{v.contact.name} {v.contact.last_name or ''}".strip(),
                   )
                   for v in matching
               ],
           ))
       return VisitSummaryOut(total=len(rows), categories=categories)
   ```
   `contact_id` scoping (the per-contact §1.3 case) trusts the caller already
   has access to that contact page — same trust boundary the existing
   per-contact `list_visits` endpoint uses.

### Frontend

3. New shared component `frontend/components/VisitSummary.tsx`, props
   `{ contactId?: number }`:
   - Date range via two `DatePicker`s (existing component,
     `YYYY-MM-DD` strings), defaulting to the **current week**: Sunday-start
     when `lang === "he"`, Monday-start when `lang === "en"` (computed from
     `new Date()` and the locale's week-start day).
   - When `contactId` is undefined (full-report mode): admin-only checkbox
     "show all visits" driving `scope_all`.
   - Fetches `/api/visits/summary` with the above params.
   - Renders total count, then one block per category **filtered through
     `useFieldSettings().isFieldVisible("visits.<key>")`** (respects the
     existing Manage Fields hide toggle — satisfies §1.2.3's "respect hidden
     columns"): item count + list of visits, each a `<Link
     href="/dashboard/contacts/{contact_id}">` per §1.2.2's "clickable links"
     requirement.
4. New page `frontend/app/dashboard/contacts/visit-summary/page.tsx` renders
   `<VisitSummary />` (report mode). Add a nav entry to `peopleItems` in
   `layout.tsx`: `{ href: "/dashboard/contacts/visit-summary", label:
   t("nav.visit_summary", "סיכום ביקורים") }`.
5. `frontend/app/dashboard/contacts/[id]/page.tsx`: add `"visitSummary"` to
   `SEGMENT_KEYS`, a `segmentLabels` entry, and a `renderSegment` case
   rendering `<VisitSummary contactId={contact!.id} />` inside the standard
   `<section>` wrapper — gated the same way the `visits` segment already is
   (`contact_type === "mekurav"`), which folds it into the existing
   configurable Display Order settings for free (§1.3's second requirement).
6. `backend/app/seed.py` — new `LOCALIZATION` rows: `nav.visit_summary`
   ("סיכום ביקורים"/"Summary of Visits"), plus labels for the summary UI
   (total count label, "show all" toggle, category names — the 5 Mivtzoim
   flags already have seeded labels via `visits.tefillin` etc., reused as-is).

### Verification

- `pytest` — new `tests/test_visit_summary.py`: date-range filtering,
  standard-user scoping (only assigned contacts), admin `scope_all=True`
  returns org-wide, per-contact scoping ignores assignment, category counts
  match fixture data, a hidden `visits.*` field is still counted server-side
  (hiding is a frontend rendering concern only, per existing convention).
- `tsc --noEmit`.
- Headless-drive: as a standard (non-admin) user, confirm only assigned
  contacts' visits appear; as admin, toggle "show all" and confirm the count
  changes; click a visit item and confirm it lands on that contact's page;
  hide `visits.tefillin` in Manage Fields and confirm its category
  disappears from the report; open a mekurav contact's page, confirm the
  Visit Summary section appears and its position follows the Display Order
  drag controls.

---

## §3.1 — Manage Fields: action-icon + system-field visibility

### Root cause

The Manage Fields page (`frontend/app/dashboard/fields/page.tsx`) is entirely
data-driven off `backend/app/field_registry.py`'s `TOGGLEABLE_FIELDS` — no
frontend change is needed to make a new toggle *appear*, only to make the
underlying UI element *respect* it. Two concrete gaps:

- The phone/email/WhatsApp quick-action icons (`contacts/page.tsx:1200-1231`
  list view, `contacts/[id]/page.tsx:276-304` detail view) are gated only on
  `c.phone`/`c.email` truthiness — no visibility check at all.
- `created_at` is hardcoded with key `null` (= "always shown, never
  hideable") in `ContactView.tsx` at line 307 (`shliachFields`) and line 399
  (`fields`) — unlike `contact_mekurav.first_visit` (line 41 of the
  registry), which is already toggleable.

### Fix

1. `backend/app/field_registry.py` — add to `TOGGLEABLE_FIELDS`:
   ```python
   ("contacts.action_call", "contacts.action_call", "contact"),
   ("contacts.action_whatsapp", "contacts.action_whatsapp", "contact"),
   ("contacts.action_email", "contacts.action_email", "contact"),
   ("contacts.created_at", "contacts.created_at", "contact"),
   ```
2. `backend/app/seed.py` — matching `LOCALIZATION` rows (entity `"action"`
   or `"column"` per existing convention), e.g. `contacts.action_call` →
   "חיוג טלפוני" / "Phone call", `contacts.action_whatsapp` → "וואטסאפ" /
   "WhatsApp", `contacts.action_email` → "שליחת מייל" / "Email".
3. `frontend/app/dashboard/contacts/page.tsx` (list, ~1200-1231): wrap each
   of the three action `<a>` blocks with `vis("contacts.action_call")` /
   `vis("contacts.action_whatsapp")` / `vis("contacts.action_email")`
   (`vis` is already destructured from `useFieldSettings()` at line 87).
4. `frontend/app/dashboard/contacts/[id]/page.tsx` (detail, ~276-304): import
   `useFieldSettings`, destructure `vis`, apply the same three guards.
5. `frontend/components/ContactView.tsx` lines 307 and 399: change the key
   from `null` to `"contacts.created_at"` in both `shliachFields` and
   `fields` arrays (the existing `.filter(([key]) => key === null ||
   vis(key))` then hides it automatically when toggled off — no other
   change needed).

### Verification

- `pytest` — extend `tests/test_field_settings.py` (or equivalent): the 4
  new keys appear in `GET /api/field-settings` under entity `"contact"`,
  default visible.
- `tsc --noEmit`.
- Headless-drive: in Manage Fields, hide "Phone call" → confirm the 📞 icon
  disappears from both the contacts list and a contact's detail page but ✉/💬
  remain; hide "Created at" → confirm the row disappears from the contact
  detail card; re-show both, confirm they return.

---

## §4 — Reports module

### Root cause / design

The entire "Reports" module is one client-side page,
`frontend/app/dashboard/reports/create/page.tsx` — a PDF generated on demand
via jsPDF/autotable, RTL-shaped by `lib/pdfRtl.ts`. **There is no persisted
`Report` entity anywhere** (`backend/app/models.py` has only the unrelated
`ReportNumber` picklist-style tag) — so "the individual Report page" *is*
`create/page.tsx` (the only report page that exists), and "per report"
persistence in practice means "per user for this page," which the existing
`useDbPreference`/`UserPreference` mechanism (already used identically for
Contacts/Apartments column selections) covers exactly — **no new backend
model or router is needed for §4.2-§4.4**.

The existing `report_notes` field (§4.1) already round-trips to the DB via
`Organization.report_notes` / `PUT /api/organizations/me` — it just lives on
the wrong page (`app/dashboard/settings/page.tsx:141-155`) today.

The report currently renders exactly 6 hardcoded logical columns (`floor,
apartment_name, jewish_status, mezuzah_status, language, apartment_notes`)
with hardcoded pixel widths (`COLUMN_WIDTHS = [50, 70, 85, 75, 70, 160]`,
line 33) — no column-selection, subheading, or width-percent state exists
anywhere in the reports directory today (net-new, not a fix).

### Fix

**§4.1 — move Report Description:**
1. `frontend/app/dashboard/settings/page.tsx` — remove the `reportNotes`
   state, its load/save wiring, and the textarea (lines 25, 43, 63, 141-155).
2. `frontend/app/dashboard/reports/create/page.tsx` — add (admin-only,
   `isAdmin` from `useAuth()`) a `reportNotes` state loaded from
   `user?.organization?.report_notes`, a textarea using the same
   `settings.report_notes`/`settings.report_notes_hint` localization keys,
   and a small inline "Save" that calls `PUT /api/organizations/me` (same
   endpoint Settings used) then `refresh()` the auth context so
   `user.organization.report_notes` (already consumed at line 201 of this
   file for the PDF body) stays in sync without a page reload.

**§4.2/§4.3/§4.4 — column toolbar, validation, persistence:**
3. New preference key via `useDbPreference`, no backend change:
   ```ts
   type ReportColumnKey = "floor" | "apartment_name" | "jewish_status" | "mezuzah_status" | "language" | "apartment_notes";
   interface ReportColumnConfig {
     columns: ReportColumnKey[];       // which of the 6 are included (fixed logical order preserved — spec asks only for inclusion, not reordering)
     subheadings: Partial<Record<ReportColumnKey, string>>;
     widths: Partial<Record<ReportColumnKey, number>>;  // percent, defaults sum to 100
   }
   const DEFAULT_REPORT_COLUMNS: ReportColumnConfig = {
     columns: ["floor", "apartment_name", "jewish_status", "mezuzah_status", "language", "apartment_notes"],
     subheadings: {},
     widths: { floor: 10, apartment_name: 14, jewish_status: 17, mezuzah_status: 15, language: 14, apartment_notes: 30 },
   };
   const [reportColumns, setReportColumns] = useDbPreference<ReportColumnConfig>(
     "reports.apartmentColumns", DEFAULT_REPORT_COLUMNS,
   );
   ```
4. New toolbar section at the top of `create/page.tsx` (above the mode
   picker): one row per logical column — checkbox (include/exclude), text
   input (subheading), number input (width %). Live-computed
   `totalWidth = reportColumns.columns.reduce((s,k) => s + (reportColumns.widths[k] ?? 0), 0)`.
5. **§4.3 validation:** if `totalWidth > 100`, show
   `t("validation.report_width_over_100", "סך הרוחב של העמודות אינו יכול להיות יותר ממאה אחוז")`
   inline (English via the existing bilingual `t()` mechanism — English value
   "The total width should not be over 100%") and disable the "Generate PDF"
   button until corrected. New `backend/app/seed.py` `LOCALIZATION` row:
   `("action", "validation.report_width_over_100", "סך הרוחב של העמודות אינו יכול להיות יותר ממאה אחוז", "The total width should not be over 100%")`.
6. `generatePdf()`: replace the hardcoded `logicalHeads`/`COLUMN_WIDTHS`
   arrays with ones derived from `reportColumns` — filter to
   `reportColumns.columns` (preserving the fixed logical order), header text
   = `t("reports.<key>", ...)` plus, when a subheading is set, a second line
   via `"\n"` (jspdf-autotable renders `\n` in head/body strings as wrapped
   lines within the cell — no extra library needed), and `cellWidth` per
   column computed as `(pageW - MARGIN * 2) * (widths[key] / 100)` instead of
   the fixed point values. **§4.4 persistence** is already covered by step 3
   — the same `useDbPreference` call loads the saved config as the default
   on next visit, with no separate save step required (it's the existing
   400ms-debounced write-through every other `useDbPreference` consumer in
   this codebase relies on).

### Verification

- `tsc --noEmit`.
- Headless-drive: as admin, edit the report description on the Reports page
  and confirm Settings no longer shows it and the value still lands in the
  generated PDF; uncheck a column and confirm it's absent from the PDF;
  set a subheading and confirm it renders under the header; push widths over
  100% and confirm the Hebrew error message appears and Generate is disabled;
  reload the page and confirm the column/subheading/width selections
  persisted.

---

## Cross-cutting

- Every new Hebrew UI string gets a `LOCALIZATION` row in `backend/app/seed.py`
  per the project's standing rule — `t()` fallback text alone is not enough.
- No commit/push without an explicit in-session ask (standing rule).
- Per the project's build-verification rule, `tsc --noEmit` must be run
  inside the frontend container before considering any of this done — dev
  mode does not catch the same errors Vercel's build does.
