# fixes33 — Implementation Plan

Source spec: `docs/fixes33.md`. Local stack already running (Postgres +
backend + frontend via docker-compose). All work happens against the real
local Postgres dev DB (`crm_local_dev`), not just the SQLite pytest suite —
see the root-cause note in §2 below for why that distinction matters here.

## §2 Area module

### Root cause of "deletion is broken"
`DELETE /api/areas/{id}` does a bare `db.delete(area); db.commit()`.
- `buildings.area_id` and `contact_shliach_area.area_id` are **NOT NULL**
  FKs with no `ondelete` clause (baseline migration) → Postgres defaults to
  `RESTRICT`.
- `Area.buildings` has `cascade="all, delete-orphan"` so SQLAlchemy *does*
  cascade buildings→apartments at the ORM level. But `ContactShliachArea`
  has **no relationship declared from `Area`** at all (only a one-way
  `area = relationship("Area")` on `ContactShliachArea`), so the ORM has no
  idea those rows exist and never touches them — the DB-level FK RESTRICT
  fires and the DELETE raises `IntegrityError` → unhandled 500.
- The frontend's `remove()` in `areas/page.tsx` has no try/catch, so the
  500 is swallowed as an unhandled promise rejection — the row just sits
  there with zero feedback, reading as "does nothing."
- This is invisible in pytest: the SQLite test engine never gets
  `PRAGMA foreign_keys=ON`, so FK RESTRICT never fires there. Confirmed by
  grep — no PRAGMA anywhere in the codebase. Verification for this section
  must happen against the real Postgres dev DB, not just pytest green.

### Backend
1. `models.py`: delete `ContactShliachArea` rows for the area explicitly in
   the router (simplest fix — no relationship needed on `Area`, since the
   only place that ever reads them is `_shliach_area_ids`, keyed off
   `contact_shliach_id`, not off `Area`).
2. Migration: `buildings.area_id` → `nullable=True` (required for Option B).
3. `routers/areas.py` `delete_area`:
   - Accept `mode: Literal["cascade", "unassign"] | None = None`.
   - Count buildings for the area.
   - If buildings exist and `mode is None` → `409` with
     `{"has_buildings": true, "building_count": N}` (no mutation).
   - `mode == "cascade"` → delete `ContactShliachArea` rows for this area,
     then `db.delete(area)` (ORM cascade removes buildings + apartments;
     `ContactMekurav.apartment_id` auto-nulls via the existing
     `Apartment.mekuravim` relationship — already correct, not touched).
   - `mode == "unassign"` → delete `ContactShliachArea` rows for this area,
     `UPDATE buildings SET area_id = NULL WHERE area_id = :id`, then delete
     the (now childless) area.
   - No-buildings case: unchanged one-shot delete (still clears
     `ContactShliachArea` rows first — that was already silently broken
     any time an area had a direct shliach assignment with zero buildings).
4. `schemas.py`: no new response model needed for the 204 path; the 409
   body is a plain dict via `HTTPException(409, detail={...})`.

### Frontend
5. `areas/page.tsx` `remove()`: wrap in try/catch. On a 409 with
   `has_buildings`, open a dedicated 3-way modal (new small component, not
   the generic boolean `useConfirm` — this needs three outcomes, not two):
   - Title/message: exact spec text —
     `"לאזור זה יש בניינים האם למחוק את הבניינים?"`
   - Button 1 (destructive): "מחק בניינים ודירות" → re-call DELETE with
     `mode=cascade`.
   - Button 2 (neutral): "השאר בניינים" → re-call DELETE with
     `mode=unassign`.
   - Button 3 (abort): "ביטול" → close, no request, area untouched.
   - Keep the existing generic confirm for the plain (no-buildings) path.
6. New localization keys: `areas.delete_has_buildings_confirm`,
   `areas.delete_cascade_buildings`, `areas.delete_keep_buildings`.

### §2.3 Schema refactor (apartment.area_id)
Already done — grepped `models.py`/`schemas.py`: `Apartment` has no
`area_id` column; it only links via `building_id`. This item needs no code
change. Will note as "already satisfied" in the closeout, not skip silently.

## §3 Apartments module

### §3.1 Custom picklist columns in column selector
Partially done already (fixes32): `customDefs` (org's non-fixed
`apartment.*` picklists) already get an auto filter *and* an auto grid
column with inline edit. Gap vs. the spec wording ("select custom picklist
fields as visible columns"): those columns are currently **unconditional**
— not part of the "התאמת שדות" column-selector panel, so they can't be
hidden. Fix:
- New DB preference `apartments.customFields` (string[] of visible custom
  `field_key`s), default = all of `customDefs` (keeps current behavior for
  existing users).
- Add one toggle chip per `customDefs` entry into the existing `fieldsOpen`
  panel (same chip styling as the built-in `FIELD_KEYS` chips, dragging not
  required — spec only asks for visibility, not reordering these).
- Table header/body only render a custom-picklist column when its key is
  in the preference.

### §3.2 "Create Report from Filtered Results"
- Add a button next to the existing filter controls on
  `apartments/page.tsx`: "צור דוח מהתוצאות המסוננות".
- Clicking it navigates to `/dashboard/reports/create` with the current
  filter state serialized into the URL query string (area/building/
  report-number/jewish/mezuzah/language/custom-picklist filters + q).
- Extend `reports/create/page.tsx` with a third source mode,
  `"filters"` (label "לפי סינון נוכחי"), auto-selected and pre-populated
  when the page is opened with those query params; it calls the same
  `fetchAllPages` helper with the carried-over params instead of
  `report_number_ids`/`apartment_ids`.

## §4 Picklists management — 3-tab reorg

`/dashboard/picklists` currently renders two stacked sections (Contact vs.
Apartment). Field-key namespace (confirmed via `picklist_utils.py` /
`routers/visits.py`):
- `apartment.*` → Apartment tab (unchanged rule).
- `visit.*`, `checklist.*`, `interaction.*` → new Visit tab.
- everything else (`contact.*`, `significant_date.*`, bare `Jewish_status`/
  `affiliation`/`language`, and any custom addition with no recognized
  prefix) → Contacts tab.

Changes:
- Replace the two `<section>` blocks with a tab bar (3 tabs) + persisted
  active tab (`usePersistentState("crm.picklists.tab", "contacts")`) so a
  refresh/navigation keeps the chosen tab.
- Each tab keeps its own "Add picklist" form with the right prefix:
  Contacts → `""`, Visit → `"visit."`, Apartment → `"apartment."`
  (unchanged).
- Pure frontend reorg — no backend changes; the registry/API already
  returns every definition regardless of prefix.

## §5 Manage Fields

### §5.1 Dynamic picklist fields in the grid
`TOGGLEABLE_FIELDS` is a static Python list — an admin-added custom
picklist (any non-system `PicklistDefinition`) has no entry here today and
can't be hidden from `/dashboard/fields`.
- Backend `field_registry.py`: no change to the static list.
- `routers/field_settings.py` `list_field_settings`: after the static
  entries, append one entry per **non-system** `PicklistDefinition` for the
  org, with `field_key = system_name`, entity resolved by prefix
  (`apartment.` → `"apartment"`; `visit."/"checklist."/"interaction."` →
  `"visit"`; else → `"contact_mekurav"`), and carry the definition's own
  `hebrew_display_name`/`english_display_name` directly (no
  `field_localization` row needed — this is per-org user data, not app
  chrome, consistent with how the Picklists page already renders these).
- `FieldSettingOut` gains optional `label: str | None` /
  `english_label: str | None`, populated only for these dynamic rows.
- `set_field_setting`: validation currently rejects any `field_key` not in
  the static `TOGGLEABLE_KEYS`. Extend it to also accept a `field_key`
  matching one of the org's `PicklistDefinition.system_name` values.
- Frontend `FieldSetting` type + `FieldRow`: when `label` is present, use
  it directly (language-aware, mirroring the Picklists page's `defLabel`)
  instead of `t(label_key, field_key)`.

### §5.2 Hidden-field enforcement
Already correctly wired for Contacts (`contacts/page.tsx` already consults
`useFieldSettings` for CRUD/filters/columns) and for the Apartment
CRUD form + detail view (`ApartmentEditor.tsx`, `apartments/[id]/page.tsx`
already call `vis(...)`). The gap is the **Apartments list page**
(`apartments/page.tsx`) — it never imports `useFieldSettings` at all, so a
hidden apartment field still shows as a filter and a selectable/shown
column there. Fix, mirroring the exact pattern already used in
`contacts/page.tsx`:
- Map each built-in `FIELD_KEYS` entry to its `field_registry` key
  (`resident`→`apartments.name`, `report_number`→`apartments.
  report_number_id`, `notes`→`apartments.apartment_notes`, `phone`→
  `apartments.phone`, `email`→`apartments.email`, `language`→`apartment.
  language`, `jewish_status`→`apartment.Jewish_status`, `campaign_status`→
  `apartment.campaign_status`, `mezuzah_status`→`apartment.mezuzah_status`;
  `building`/`area` have no registry key — always available, structural).
- Filter the chips offered in the column-selector panel, the filter row
  controls, and the active-column list itself by `vis(key)`.
- `customDefs` (dynamic apartment picklists) get the same treatment for
  free once §5.1's dynamic field-settings rows exist — filter `customDefs`
  itself by `vis(d.field_key)` before it drives filters/columns.

## §6 Settings — report notes

- `models.py`: `Organization.report_notes: Column(Text, nullable=True)`.
- Migration: add the column.
- `schemas.py`: `OrganizationOut.report_notes: Optional[str]`,
  `OrganizationUpdate.report_notes: Optional[str]`.
- `routers/organizations.py` `update_my_org`: handle `report_notes` like
  the other optional text fields (present key → set, including clearing to
  `None`).
- `settings/page.tsx`: new textarea, label `t("settings.report_notes",
  "הערות לדוח")`, saved via the existing `/api/organizations/me` PUT.

## §7 Reports engine

Both changes live in `reports/create/page.tsx` (client-side PDF, no
backend involvement — matches how the whole report engine already works,
per `lib/pdfRtl.ts` / fixes24).

### §7.1 Report notes header
- Fetch `user.organization` (already available via `useAuth()`) — needs
  `report_notes` to actually be present on that object, i.e. depends on §6
  being wired into `/api/auth/me` (check `UserOut`/org nesting — if the org
  payload embedded in `/me` doesn't carry `report_notes`, fetch
  `/api/organizations/me` once at the top of `generatePdf()` instead, to
  avoid a second round-trip contingency).
- If non-empty, render it as a wrapped text block directly under the title,
  before the first report/building section, pushing `y` down accordingly
  (using jsPDF's `splitTextToSize` for wrapping, same font/bidi helper
  already used for every other string in this file).

### §7.2 Page break per report number
- In the `mode === "reports"` loop, currently a new page is only forced
  when content would overflow (`y + 48 > bottom`). Spec wants every
  distinct report-number section to start on its own page. Change: call
  `doc.addPage(); y = PDF_CONTENT_TOP;` unconditionally before each
  report-number section **except the first** (first section continues
  right after the title/notes block on page 1).
- `mode === "apartments"` (hand-picked, ungrouped by report number) is
  unaffected — the spec's §7.2 is scoped to "multiple report numbers."

## Testing plan

- Backend: new `backend/tests/test_fixes33.py` — area delete (no
  buildings / cascade / unassign / 409-without-mode /
  `contact_shliach_area` cleanup), field-settings dynamic picklist entries
  + visibility toggle, `report_notes` round-trip via `/api/organizations/
  me`. Run full suite after.
- Frontend: `tsc --noEmit` + `next build` (per the standing "verify prod
  frontend build" rule — dev mode hides real build errors).
- Live verification against the **real local Postgres dev DB** (not just
  SQLite pytest) for the area-delete flow specifically, since that's the
  one thing pytest structurally cannot catch here — headless-Chrome drive
  or direct API calls exercising: delete an area with 0 buildings, with
  buildings choosing cascade, with buildings choosing unassign, and a
  direct shliach-covers-area-with-no-buildings case.
- Headless-Chrome drive of: picklist 3-tab UI, apartments column
  selector with custom picklist toggle, "create report from filters"
  button, manage-fields dynamic picklist toggle + confirming it hides the
  field on the apartments page, settings report-notes save, and a
  generated PDF showing the notes header + page breaks between report
  sections.

## Closeout

Per project rule: update `docs/fixes33.md`'s checklist at the end — each
item `[x]` with evidence, or explicit "Not done" with why. Nothing gets
committed/pushed without an explicit ask.
