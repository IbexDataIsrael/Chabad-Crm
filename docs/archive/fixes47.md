# Fixes47: area/report-number saves were silently no-ops + a real per-user page

Follow-up to fixes46 (chat-originated, no pre-written spec). Two live bug
reports after fixes46 shipped:

1. "after editing (adding area, adding report number) the data is not
   saving. make sure its saved and show a toast saying so."
2. "there is no way to go to single user's data... it should be on single
   user page - example dashboard/users/111" — the audit history fixes46
   added lived inside the list page's inline edit popup, not an addressable
   URL.

Also: "in users page make sure buttons appear neat like in contacts. use the
same flex css you used in contacts" (the button row was missing `flex-wrap`,
present on Contacts since fixes44 §2).

## Root cause of the save bug

Reproduced live (Playwright, isolated Chromium — not the user's real Chrome,
see below) with the browser's own devtools instrumentation, not guesswork:

`InlineEdit`'s default "commit on blur" never actually committed for the
`AreaMultiSelect`/`ReportNumberMultiSelect` editors. The picker
(`MultiSelectSearchFilter`) closes its own dropdown via a raw
`document.addEventListener("mousedown", ...)` outside-click handler. When a
user clicked away to finish editing, that *same* click both (a) blurred
whatever was focused inside the picker and (b) triggered the picker's own
close-and-re-render. Confirmed via a document-level capture-phase listener
that the native DOM blur/focusout genuinely fired — but React's own
delegated `onBlur` on the `InlineEdit` wrapper never received it, because
the re-render from (b) detaches the focused node before React's synthetic
event dispatch completes. The edit itself was never lost; the save
(`onSave`/`apiFetch`) was simply never attempted — zero network requests,
confirmed by patching `window.fetch`.

## The fix

New `components/ui/MultiSelectEditor.tsx` wraps the picker with an explicit
apply button instead of depending on blur:
- `commitOnBlur={false}` on the `InlineEdit`.
- The button commits on `onMouseDown` (not `onClick`) with
  `preventDefault()` — React's delegated listener (on the app root) fires
  before the picker's `document`-level listener (further up the tree), so
  acting on mousedown runs before the picker's own re-render can detach the
  button. An `onClick` handler was tried first and silently never fired for
  the same underlying reason as the original bug.
- `relative z-40` / `z-50` on the wrapper/button — table cells collapse to
  content width (`w-px whitespace-nowrap`), so this editor overflows its own
  `<td>` and, without its own stacking context, painted *underneath* the
  next (later-in-DOM) cell's static content — a second, independent bug
  that surfaced once the button was reachable at all.
- `flex flex-col` instead of `space-y-*` — the picker's own root is
  `inline-block`, so margin-based stacking left the button sitting inline
  next to the trigger instead of below it.

Applied to both call sites that had this pattern: the Users page's
area/report-number columns (new this round) *and* `ContactView.tsx`'s
(pre-existing since fixes43 — same bug, never previously caught). A success
toast now confirms the save on both.

## dashboard/users/{id}

New page, mirroring `dashboard/contacts/{id}`'s role for Contacts:
- `GET /api/users/{id}` (new endpoint, enriched with the linked
  `ContactShliach` exactly like the list endpoint).
- Per-field autosave (name/email/phone/role/password), plus
  notes/areas/report_numbers when linked to a shliach contact, plus the
  audit/history panel — all in one addressable page.
- The Users list page's "open/edit" action now navigates here instead of
  opening an inline popup. `UserForm` (the popup) is create-only now; its
  edit path, contactId prop, and inline history block were removed —
  editing an existing user only happens on the detail page.

## Verification

- `pytest` (Docker backend, real Postgres): 436 passed, 0 failed (no new
  backend tests needed — no versioning/business-logic changes, just a new
  read endpoint already covered by the existing `_shliach_out`/list-users
  logic).
- `tsc --noEmit`: clean.
- **Live browser verification this round** (Playwright driving an isolated,
  bundled Chromium — not the user's real Chrome, so the ~34-open-windows
  concern from fixes46 didn't apply): reproduced the original bug with
  network/DOM instrumentation, confirmed the fix end-to-end — toast appears,
  `PUT /api/users/{id}` fires with the correct payload, value survives a
  full page reload — for both the list page's columns and the new detail
  page. Also confirmed: navigating from the list to `/dashboard/users/{id}`,
  the history section rendering, and no new console errors.

Not deployed — local/uncommitted, matching the project's "no commit/push
unasked" rule.
