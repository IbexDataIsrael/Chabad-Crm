# fixes84 — clone gets its own page; clone "does nothing"

Requested 2026-10-01.

## 1. Clone modal taller than the screen, no scroll

- [x] Clone moved from a modal to its own page, `/dashboard/admin/clone/<org id>`
      ("שכפל" on an org row links there). Labeled fields (the modal had
      placeholders only), normal page scroll, mobile too. `CloneOrgModal` removed.
      Live-verified at 1280×700 and 390×700: the submit button is reachable.

## 2. "The modal closes and nothing happens, the clone isn't created"

**Finding (prod, read-only):** the clone *was* created. Org **#10 "ארגון הדגמה"**
(2026-09-30 22:18 UTC, 160 contacts, 11 apartments, admin noam@chabad.org.il)
is a copy of org 1. No clone error was logged after the fixes83 fix. The old
modal closed the instant you pressed the button, showed nothing while the
clone ran (which can take a minute), and the new org is appended at the
**bottom** of a long org list, so the success looked like nothing.

- [x] Clone page shows an in-progress line ("משכפל… אין לסגור את הדף") and
      disables its buttons; an error is shown inline on the page.
- [x] On success it returns to the org list with `?cloned=<id>`, which scrolls
      to the new org, highlights it, and toasts "הארגון שוכפל: "<name>" (#id)".
- [x] Bug found while testing: the page's load effect could re-run and reset
      the typed org name to the default "<org> - Sample". It now only fills an
      empty field. Live-verified: the typed name survives.

`tsc --noEmit` clean. Local test clones (#131, #132) deleted after the drive.
Not committed or pushed.
