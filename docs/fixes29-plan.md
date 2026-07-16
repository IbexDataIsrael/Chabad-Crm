# fixes29 — Implementation Plan

> Spec: `docs/fixes29.md`. Note: the spec file is truncated mid-§3 — the Hebrew
> hint's code fence never closes and no English value is given. The English is
> derived as the direct translation ("Please enter a valid email address,
> e.g. name@example.com"); flag to the user at closeout.

## §1 Filter Section Toggle (contacts + visits views)

- **`frontend/app/dashboard/contacts/page.tsx`** — new
  `usePersistentState("crm.contacts.filtersOpen", true)` (matches the page's
  existing fixes15 persistence pattern; default `true` keeps today's UI).
  A toggle button joins the header row (next to bulk-email / new-contact);
  label `הסתר סינון` / `הצג סינון`. The two filter rows (geo multi-selects +
  search + mitzvot/torah/rebbe/tzedaka/date-range row, and the
  status/owner/sort/columns/page-size row) wrap in `{filtersOpen && …}`.
  The columns panel is additionally gated (`filtersOpen && columnsOpen`) since
  its ⚙ opener lives inside the hidden section. Hidden filters keep applying —
  only visibility changes, state is untouched.
- **`frontend/app/dashboard/visits/page.tsx`** — same pattern with
  `crm.visits.filtersOpen`; wraps the search + page-size row; button in the
  header row next to "הוסף ביקור".
- New localization keys `filter.show_filters` / `filter.hide_filters`
  seeded in `seed.py` (per the Hebrew-strings rule).

## §2 Edit-contact validation errors inline (like the add form)

- Root cause of the difference: the add form's `EmailInput`/`PhoneInput`
  render the hint in red directly under the input, but the edit path
  (`ContactView` → `ui/InlineEdit`) reports `validate` failures via a global
  **toast** (`InlineEdit.tsx` commit()).
- **`frontend/components/ui/InlineEdit.tsx`** — while editing, run `validate`
  on the live draft and render the message under the editor as
  `block text-xs text-status-darkred` (identical classes to the add-form
  hint). A failed commit no longer toasts — the inline message is already
  visible and the editor stays open. Server-side save errors keep the toast.
- On-type feedback matches the add form (which validates as you type).
  This applies to every InlineEdit consumer (contact name/phone/email, visit
  fields) — consistent by design.

## §3 Localization seeding — clearer email hint

- **`backend/app/seed.py`**: LOCALIZATION row `validation.email_hint` →
  he: `נא להזין כתובת אימייל תקינה, לדוגמה name@example.com`,
  en: `Please enter a valid email address, e.g. name@example.com`.
- Existing orgs: guarded `LOCALIZATION_RENAMES` entry (fixes13 mechanism) so
  rows still holding the old seeded text are updated, admin-customized text
  survives.
- **`frontend/lib/validation.ts`**: `EMAIL_HINT` fallback updated to the same
  Hebrew (fallback/seed parity).

## Verification

- `backend`: new `tests/test_fixes29.py` — rename-guard behavior (old seeded
  value updated; customized value preserved; fresh seed carries new text).
- `docker exec …-frontend-1 npx tsc --noEmit` (the Vercel build gate).
- Headless CDP drive: toggle hides/shows both filter sections and survives
  reload (localStorage); invalid email in contact inline edit shows the red
  hint under the input (no toast) and blocks the save.
- Closeout per rule: fixes29.md checkboxes + status block, commit.
