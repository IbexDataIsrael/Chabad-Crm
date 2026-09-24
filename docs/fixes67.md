# fixes67 — single task page with inline editing

Source: Zvi, 2026-09-25 (chat): "in the task page (/dashboard/tasks) add option
to view single task (/dashboard/tasks/{id}), add inline editing! its basic!"

## Scope

- New page `/dashboard/tasks/{id}` (admin / campaign manager, same gate as
  the list), laid out like the other single-record pages (users/{id}):
  back link, title, action buttons, a details card.
- Inline editing (InlineEdit, per-field autosave via the existing
  `PUT /api/tasks/{id}` — no backend change needed, it already accepts every
  field):
  - activist (assign / reassign; "return to pool" = the existing unassign
    endpoint, with its confirm)
  - campaign
  - report numbers (multi-select with explicit Apply — fixes47 pattern)
  - custom date
  - status
  - activist report summary (free text)
- Read-only facts: apartment count, latest report status + notes, how/when
  it was claimed (QR / paper), created / updated.
- Actions on the page: print sheet, paper entry, return to pool, delete
  (-> back to the list).
- List page: every row opens its task (open button + the campaign name is a
  link). Existing inline edits in the grid stay.
- The print code is shared by both pages (lib/taskPrint.ts), not duplicated.
- Localization rows in seed.py for every new string.

## Added mid-round (same chat)

- Every PDF: "לעילוי נשמת הרה"ג ר' אברהם יצחק שלוסברג זצ"ל" centered at the
  top of every page and "Built by zvi.naiman@gmail.com" at the bottom of
  every page. Done once in lib/pdfRtl.ts `drawPdfHeaders` (both generators —
  task sheet + apartments report — call it per page), so any future PDF
  built on it gets them too. Fixed text, not localized.
- Website footer (components/Footer.tsx, root layout = every page including
  the public /org and QR claim pages): the same dedication line above
  "Built by".

## Checklist

Verified 2026-09-25 by live headless drives (Playwright Chromium) against the
local Docker stack; drive data (tasks 37-39, temp admin) deleted afterwards.

- [x] page + route `/dashboard/tasks/{id}` (admin / campaign manager gate).
      The "not found" state for a bad id exists in code but was not driven.
- [x] inline edits for all 6 fields — drive edited status -> PAUSED,
      campaign, activist, report numbers (added one, Apply), summary
      (textarea, click-away saves); `GET /api/tasks/{id}` afterwards returned
      every value, apartment_count followed the report numbers (1 -> 2), and
      the page after reload showed them.
- [x] activist -> "ללא פעיל" = return to pool (existing confirm) -> is_orphan.
- [x] actions: print / paper entry / return to pool / delete (delete ->
      back to the list). Paper-entry back link now returns to the task page.
- [x] list -> open: eye button + campaign-name link, both land on the page.
- [x] print logic shared (lib/taskPrint.ts) by list + task page.
- [x] localization rows (13 new keys) in seed.py, confirmed inserted at boot.
- [x] PDF credits: text extracted from the real downloaded task sheet and
      report PDFs contains both lines on every page; rendered crops show
      correct RTL order.
- [x] website footer shows the dedication (screenshot).
- [x] `tsc --noEmit` clean; test_fixes65/58/4/17 (51) pass.
