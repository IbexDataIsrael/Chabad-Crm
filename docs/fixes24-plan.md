# fixes24 Implementation Plan — Reports Page & Menu Restructuring

Source spec: `docs/fixes24.md`. (The repo's `docs/plan.md` is the original
master build plan and stays untouched; this is the fixes24-specific plan it
asks for.)

## Scope

1. **Localization** — new `reports.*` UI strings (Hebrew + English).
2. **Menu restructuring** — Donations under People; new Reports group holding
   Report Numbers (moved from Places) and the new Create Reports page.
3. **Create Reports page** — multi-select report numbers → RTL Hebrew PDF of
   the matching active apartments, grouped by report number then building.

## Phase 1 — Localization

This project does **not** use `locales/*.json`; UI strings live in the DB
(`field_localizations`), seeded idempotently from `backend/app/seed.py`
`LOCALIZATION` (new keys are inserted on boot for existing installs too).

Add a `--- fixes24: reports ---` block with the spec's strings, keyed
`reports.*` (entity_type `reports`):

| key | he | en |
|---|---|---|
| `reports.menu_title` | דוחות | Reports |
| `reports.create_reports` | יצירת דוחות | Create Reports |
| `reports.report_numbers` | מספרי דוחות | Report Numbers |
| `reports.select_reports_placeholder` | בחר מספר דוח אחד או יותר | Select one or more report numbers |
| `reports.generate_pdf` | הפק דוח PDF | Generate PDF Report |
| `reports.floor` | קומה | Floor |
| `reports.apartment_name` | מספר דירה | Apartment Number |
| `reports.jewish_status` | מצב יהדות | Jewish Status |
| `reports.mezuzah_status` | מזוזה | Mezuzah Status |
| `reports.language` | שפה | Language |
| `reports.apartment_notes` | הערות | Notes |
| `reports.no_data` | לא נמצאו נתונים עבור הדוחות שנבחרו | No data found for the selected reports |
| `reports.pdf_title` | דוח ריכוז דירות | Apartment Summary Report |

The existing Report Numbers page keeps its `nav.report_numbers` label.

## Phase 2 — Menu & navigation (`frontend/app/dashboard/layout.tsx`)

- Remove the standalone top-level Donations link; append
  `{ href: "/dashboard/donations", admin: true }` to `peopleItems` (it was
  admin-only before — stays admin-only).
- Remove the Report Numbers entry from `placeItems`.
- New `reportItems` group labelled `t("reports.menu_title", "דוחות")`,
  rendered between Places and More:
  - Create Reports → `/dashboard/reports/create` (all roles — the data the
    page reads is already permission-scoped per role; a shliach gets a PDF of
    only the apartments they cover).
  - Report Numbers → `/dashboard/report-numbers` (`admin: true`, unchanged).

## Phase 3 — Create Reports page (`frontend/app/dashboard/reports/create/page.tsx`)

### UI
- RTL comes from the global `<html dir>` (LocalizationProvider) — nothing extra.
- `MultiSelectSearchFilter` (fixes23 component) populated from
  `GET /api/report-numbers`; `allLabel` = `reports.select_reports_placeholder`.
- "Generate PDF" button, disabled while nothing is selected / while busy.
- `reports.no_data` message when the selection matches no apartments.

### Data
- Reuse `GET /api/apartments/list?report_number_ids=…&sort=floor&dir=asc`
  — it already restricts to `is_display=true`, applies shliach scoping, and
  floor-sorts with the canonical natural sort. Page through
  (`page_size=100`) until `total` rows are collected. No backend changes.
- Group rows by `report_number_id` (ordered by report-number name), then by
  building via the existing `buildingDisplayName()` (street part of the
  address — the "parsed/cleaned street name and number" the spec asks for).
- Picklist values (`jewish_status`, `mezuzah_status`, `language`) map to
  labels via `usePicklist(...).labelFor` — same as the apartments table.

### PDF (RTL, Hebrew)
- Libraries: `jspdf` + `jspdf-autotable` (dynamically imported so they stay
  out of the main bundle).
- Font: **Alef** (OFL) Regular + Bold TTFs committed under
  `frontend/public/fonts/`, fetched at generation time and registered via
  `addFileToVFS`/`addFont` (module-level cache).
- RTL correctness (`frontend/lib/pdfRtl.ts`):
  - jsPDF *does* ship a Unicode bidi engine, but its `postProcessText` hook
    runs it in visual-input mode by default, which garbles logical Hebrew
    and reverses embedded Latin/digit runs (verified empirically at the
    glyph level). `prepareHebrewPdf` patches the document's `text` method to
    inject logical-mode engine flags (`isInputVisual:false,
    isOutputVisual:true, isOutputRtl:false, isSymmetricSwapping:true`) into
    every call — including the optionless calls jspdf-autotable makes.
  - Everything is then passed as plain logical strings; the engine handles
    run ordering, digits/phones/times, bracket mirroring. autotable wraps
    cell text on the logical string, so multi-line Hebrew keeps its reading
    order.
  - Column arrays are reversed so the first logical column (קומה) renders
    rightmost; all cells `halign: "right"`.
- Layout per the spec: document title (`reports.pdf_title`), a heading per
  report number, a subheading per building, then a table with columns
  קומה / מספר דירה / מצב יהדות / מזוזה / שפה / הערות.
- Saved as `apartments-report-<yyyy-mm-dd>.pdf`.

## Verification

- `npx tsc --noEmit` (frontend), full backend `pytest` in Docker.
- Manual drive: docker up (frontend image rebuilt for the new npm deps),
  select report numbers, generate, inspect the PDF.
