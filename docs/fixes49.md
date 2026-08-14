# CRM Technical Specification: Grid System & Apartments Module Updates

## 1. Global Data Grid Standards (`contacts`, `apartments`, `users`)

Applies universally across all table/grid views to fix visual formatting and text wrapping issues (especially in RTL/Hebrew layouts):

* **Column Sizing & Horizontal Scroll:**
  * Define explicit `min-width` rules per column (e.g., minimum `120px` to `150px` depending on data type) to prevent column squeezing in the Hebrew (RTL) interface.
  * Enable horizontal scrolling on desktop viewports whenever total column widths exceed the container width (`overflow-x: auto`).
* **Text Truncation & Line Breaking:**
  * Prevent awkward word wrapping: Do not break mid-word for strings up to **12 characters** (use `white-space: nowrap` or `word-break: keep-all`).
  * Truncate long text: For cell content exceeding **20 characters**, truncate at character 20 and append an ellipsis (`...`).
  * *Implementation note:* Combine Tailwind utility classes or custom CSS styling (`truncate`, `max-w-[...px]`) with optional full-text tooltips on hover for truncated content.

---

## Status — DONE 2026-08-14 (uncommitted)

- [x] Column min-width per data type (120px narrow / 150px free-text-ish
  columns — name, address, owner, building, notes, areas, report_numbers,
  text-type custom fields) on every `<th>` across contacts, apartments, and
  users grids. `overflow-x-auto` on the outer container was already in place
  on all three pages.
- [x] Character-based truncation: new `frontend/lib/textFormat.ts`
  (`truncateText`, 20-char default) + `frontend/components/ui/TruncatedText.tsx`
  (nowrap span, ellipsis, full text in a `title` tooltip). Wired into every
  free-text grid cell across all three pages (names, addresses, notes, owner/
  building/area names, picklist labels, text-type custom fields).
- [x] Fixed a real latent bug found while implementing this: the Apartments
  grid's custom-picklist/custom-field cells used `truncate`
  (`overflow:hidden`), which silently clipped the `PicklistSelect`/
  `CustomFieldValueInput` (date picker) floating dropdown when editing —
  the exact same class of bug fixes47 already fixed on Contacts/Users.
  Switched to `break-words` there to match the established pattern.

**Evidence:** `npx tsc --noEmit` clean in the frontend container. Live
Playwright drive against a throwaway QA org/contact (`fixes49qa` — deleted
after the check) confirmed in a real browser: header `min-width` applied
correctly (name 176px content-driven / phone 120px / owner 150px / created
120px), and a 69-char address rendered as `1234 Very Long Stree…` with the
full string in the hover tooltip. Not independently re-driven on Apartments/
Users — same shared `TruncatedText` component and `gridColumnMinWidth`
pattern, reused verbatim.

