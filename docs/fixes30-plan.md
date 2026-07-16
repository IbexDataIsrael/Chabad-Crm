# fixes30 — Implementation Plan

Spec: `docs/fixes30.md` (shliach nav restriction + inline editing for the
Apartment and Building modules).

## Context

- `components/ui/InlineEdit.tsx` (fixes26 §2, fixes29 §2) already implements
  the exact interaction the spec describes: click-to-edit, Enter/blur saves,
  Escape reverts, hover highlight + ✎ affordance, live validation hints. The
  contact page (`ContactView`) is the established consumer pattern — text
  editors save trimmed-or-null partials; pickers commit on selection with
  `commitOnBlur={false}`.
- `PUT /api/apartments/{id}` and `PUT /api/buildings/{id}` both accept
  partial payloads (`exclude_unset`) — **no backend changes are needed**.
- Apartment updates are *versioned* (fixes19 §3): each PUT retires the row
  and returns a **new active id**. Inline saves must follow it
  (`setApt(saved)` + `router.replace('/dashboard/apartments/<newId>')`), or
  the next reload 404s for non-admins (historical ids are admin-only).
- Building updates are in-place (stable id) and **admin-only**
  (`require_admin`); the building page's inline editors are admin-gated,
  matching today's admin-only edit button.

## 1. Hide the Reports menu for shliach — `app/dashboard/layout.tsx`

`reportItems` currently keeps the non-admin "יצירת דוחות" entry, so shluchim
see the דוחות group. Change: `isShliach ? [] : adminOnly([...])` — `NavMenu`
renders nothing for an empty items array (verified, NavMenu.tsx:43). Nav-only
change, matching the precedent of the retired Visits entry (direct URL still
serves; this app treats nav visibility, not routing, as the shliach gate).

## 2. Apartment inline editing — `app/dashboard/apartments/[id]/page.tsx`

Convert the read-only `<dl>` to InlineEdit fields (ContactView pattern),
remove the "ערוך" button; the `/apartments/edit/[id]` route stays (still used
by the buildings pages' apartment rows with `?return=`; the add flow is
untouched).

- Text: `apartment_name`, `name`; `phone`/`email` with the shared
  `isValidPhone`/`isValidEmail` + `PHONE_HINT`/`EMAIL_HINT` hints (ltr);
  `apartment_notes` multiline.
- Commit-on-select (`commitOnBlur={false}`): `floor` (select over the
  building's floors — `GET /api/buildings/{building_id}/floors`, like
  ApartmentEditor), the four picklists (`PicklistSelect`),
  `report_number_id` + `building_id` (`SearchableSelect`; building change
  keeps the floor value — its select then offers the new building's floors).
- Save: `PUT /api/apartments/{apt.id}` with the one-field partial → returns
  the new active version → `setApt` + `router.replace` (the id-param effect
  refetches history/links). Field visibility gating (`vis`) unchanged.
- Permissions: editors render for everyone who can open the page; the server
  scopes shliach edits to assigned apartments (fixes22) — a 403 surfaces as
  the standard save-failed toast.

## 3. Building inline editing — `app/dashboard/buildings/[id]/page.tsx`

Admin-only inline editors (non-admins keep the read-only card):

- `building_name` (text; render the row for admins even when empty so a name
  can be set — today it's hidden when blank), `building_address` (text,
  validate non-empty — backend rejects an explicit empty address).
- `area_id`: select over `GET /api/areas` (fetched for admins).
- Save: `PUT /api/buildings/{id}` partial → `setBuilding(updated)`.
- Floors, coordinates/map and the apartments section keep living on
  `/buildings/edit/[id]` — the "עריכת בניין" link stays for those.

## Out of scope

- No backend changes, no new localization keys expected
  (`inline.click_to_edit` etc. already seeded).
- List-page grid cells stay links (rows already lead to the now-editable
  detail pages).

## Verification

- `tsc --noEmit` in the frontend container (Vercel-build rule); 320 backend
  tests must stay green (no backend diff).
- Headless drive: (a) shliach session — no דוחות menu; admin — menu present;
  (b) apartment detail: inline-edit resident name → URL follows the new
  version id, value persists after reload; Escape reverts; (c) building
  detail: inline-edit address → persists; non-admin sees plain text.
