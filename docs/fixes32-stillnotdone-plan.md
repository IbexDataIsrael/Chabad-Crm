# fixes32-stillnotdone — Implementation Plan

Spec: `docs/fixes32-stillnotdone.md`. Two real gaps found by testing the
previous round.

## §1 Column Reordering — root cause found, not a fundamental bug

Verified with a real HTML5 drag-event simulation (Playwright's `dragTo()`,
which dispatches actual `dragstart`/`dragover`/`drop` — a raw mouse
down/move/up sequence does *not* trigger HTML5 DnD at all, browser-side, so
that alone doesn't reproduce what a real drag does): the underlying reorder
mechanism (`moveField` → `setFields`) **does work** — dragging a header's
backing chip changes the actual table column order correctly.

The bug: the "התאמת שדות" config panel renders its chips by iterating the
*fixed* `FIELD_KEYS` constant, always in the same canonical order — never
`activeFields` (the real, reordered, persisted order). So after a successful
drag, the panel itself shows no visual change at all (only the table headers
below it move) — indistinguishable from "nothing happened." That's what
"not done" is actually reporting.

Fix: render active (draggable) chips first, in `activeFields`'s own current
order, followed by inactive chips (fixed order, not draggable — order is
irrelevant while off). Dragging a chip now visibly moves it within the panel
itself, matching the table header change 1:1. Also add
`e.dataTransfer.setData(...)` in `onDragStart` — Chromium didn't need it, but
some browsers (Firefox in particular) require *some* data set on the drag
event before they'll fire `drop` at all; costs nothing to add defensively.

## §2 Apartment Picklist "Dynamic Integration" — real gap: CRUD forms

The apartments *list* page already does this fully (filter + inline-editable
grid column, verified in the previous round). Never touched:
`components/ApartmentEditor.tsx` — the shared form behind both
`/dashboard/apartments/add` and `/dashboard/apartments/edit/[id]`. It hardcodes
the 4 fixed apartment picklists (Jewish_status/campaign_status/mezuzah_status/
language) as explicit fields and has no concept of a dynamic one — so a new
custom apartment picklist ("diet" style) is invisible on create/edit, only
reachable via the grid's inline edit. The spec's "should be displayed on
apartment CRUD" is asking for exactly this.

Fix: `ApartmentEditor` fetches `GET /api/picklists`, filters to
`apartment.*` minus the 4 fixed ones (same filter apartments/page.tsx already
uses), and renders one `PicklistSelect` per definition, prefilled from
`apt?.picklist_values?.[field_key]` on edit. On save, these go into the
existing `picklist_values` dict alongside the 4 fixed fields (the backend
`ApartmentUpdate`/`ApartmentCreate` schema already accepts this — no backend
change needed, this is frontend-only).

## Verification
- Re-run the same Playwright `dragTo()`-based check that found the root
  cause, confirming the panel now visually reorders too.
- Headless-Chrome drive of `/dashboard/apartments/add`: create an apartment,
  set a value on the custom picklist field, confirm it round-trips through
  `/dashboard/apartments/edit/[id]`.
- Full backend pytest (should be unaffected — no backend changes), `tsc
  --noEmit` + `next build`.
- No commit/push — the user commits themselves (standing rule).
