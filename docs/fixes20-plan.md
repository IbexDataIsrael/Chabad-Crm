# fixes20 — Implementation Plan & Decisions

Spec: `docs/fixes20.md`. Investigation notes + the non-obvious decisions.

## 1. Settings — organization logo
Investigation: the settings PUT (`/api/organizations/me`), the signup path
(`/api/auth/signup` persists `organization_logo_url`), and `/api/auth/me`
(returns `organization.logo_url`) all round-trip the logo correctly — verified
against the running backend with the exact settings-page payload. The header
reads `user.organization.logo_url` and `settings.save()` calls `refresh()` to
refetch `/api/auth/me`, so the header updates after save. **No backend bug
found.** Action: verify the full flow live in the browser; harden only if the
live run reveals a real defect (e.g. a stale header render).

Note: `POST /api/auth/register` (the legacy direct-registration path, not used
by the signup UI) does not persist a logo, but the signup UI uses
`/api/auth/signup`, which does — so this is not the reported bug.

## 2. Contacts

### Mekurav — admin_area visible (bug)
Cause: fixes19 §5 gated the *entire* mekurav field block behind the
`contact_mekurav.section` toggle (default-hidden), which also hid `admin_area`.
Decision: **pull `admin_area` out of the section gate** so it renders on its own
`contact_mekurav.admin_area_id` toggle (default-visible), while the rest of the
mekurav dossier stays behind the section toggle. This satisfies fixes20 §2
(admin_area visible) without reverting fixes19 §5 (the section master toggle
still hides apartment/first_visit/tzedaka/rebbe/recommendations/background/
picklists by default). `admin_area` (אזור מנהל) is a top-level administrative
grouping, distinct from the detailed mekurav data — a defensible split.

### Shliach — default-hide Assigned to / Coordinates / Color + toggles
- `contacts.assigned_user_id` and `contacts.color_tag` are already in the
  toggleable registry → add both to `DEFAULT_HIDDEN`.
- `contacts.coordinates` is new: add to `TOGGLEABLE_FIELDS` (entity `contact`)
  and to `DEFAULT_HIDDEN`; gate the read-only coordinates readout in
  `ContactForm` behind `vis("contacts.coordinates")` (it currently rides on
  `vis("contacts.address")`).
- Field settings are org-wide, so these hide across all contact views/forms by
  default; admins unhide them from `/dashboard/fields` (toggles appear
  automatically from the registry).

## 3. Apartments

### report_number filter + column
- Backend `/api/apartments/list`: add a `report_number_ids` multi filter;
  enrich each row with `report_number_name` (the id is already on
  `ApartmentOut` from fixes19).
- Frontend apartments page: add `report_number` to the toggleable table columns
  and a searchable report-number dropdown filter.

### Name concatenation [Apartment Number] + [Floor]
Update the shared title helper to concatenate `apartment_name` + `floor`
(`"<number> - <floor>"` when both exist; otherwise whichever exists; then
resident name; then `#id`). Both twins updated: `core/display.py::apartment_title`
and `frontend/lib/types.ts::apartmentTitle`. All three named views
(apartments table, building details, apartment detail) call `apartmentTitle`,
so they update together.

## 4. Shliach role — apartment visibility (bug)
Cause: after fixes19 dropped the shliach↔apartment bridge, `_shliach_apartment_ids`
derived visibility from covered *areas* only, ignoring the report-number
association — so a shliach assigned a report number (but no area) saw nothing.
Fix (done): `_shliach_apartment_ids` now returns apartments whose
`report_number_id` is one the shliach is assigned **union** apartments in the
shliach's covered areas.

## Tests
`backend/tests/test_fixes20.py`: shliach sees apartments via an assigned report
number; `/api/apartments/list` report_number filter + `report_number_name`
enrichment; `apartment_title` concatenation; registry exposes
`contacts.coordinates` and the three fields default-hidden.
