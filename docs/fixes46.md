# Fixes46: Users page — real ContactShliach link, all its columns, and history

Follow-up to `docs/fixes44_45_not_working.md` — a user report that fixes44/45
weren't actually finished. This round root-causes and closes every item in
that report.

## What was actually broken

- **Root cause of the "not working" report:** the Users page never used the
  real `ContactShliach.user_id` link. It matched a shliach login to a contact
  by comparing emails against a separately-fetched, geo-filtered contact
  list — the exact heuristic `core/shliach.py::resolve_shliach` and
  `routers/users.py` already avoided on the backend. When it missed, a
  linked shliach's phone showed as unlinked ("—", disabled) and the "view
  contact" link/history had no way to resolve at all.
- **Dynamic Column Support** was incomplete: only `email`/`phone`/`created`
  were toggleable; `notes`/`areas`/`report_numbers` (the rest of
  `ContactShliach`'s real columns) and any admin-added `contact_shliach`
  custom field/picklist had no column at all, on or off.
- **User History & Audit Log** didn't exist on the Users page. fixes45 built
  full ContactShliach versioning but only surfaced it on the *contact's own*
  page (`ContactView.tsx`) — clicking "open/edit" on a Users row opened a
  plain form with no history section.

## What changed

### Backend
- `core/shliach.py` gained `validate_area`/`set_shliach_areas`/
  `validate_report_number`/`set_shliach_report_numbers` (moved out of
  `routers/contacts.py`, which now imports them) so `routers/users.py` can
  reuse the exact same coverage-link logic instead of a second
  implementation.
- `UserOut.shliach: ShliachOut | None` — resolved via the real
  `ContactShliach.user_id` FK (`is_display=True`), not email matching.
  `null` for admin/staff or a not-yet-linked shliach login.
- `OrgUserUpdate.shliach: ShliachData | None` — `PUT /api/users/{id}` now
  accepts `notes`/`area_ids`/`report_number_ids` alongside the existing
  `full_name`/`email`/`phone`. Both a plain identity edit and a
  notes/area/report edit — together or separately — still collapse into
  **at most one** new `ContactShliach` version per request (same "one edit,
  one version" contract fixes45 established), so nothing needed to change on
  the `shliach-history` read side.

### Frontend (`dashboard/users`)
- `contactId`/`phone`/coverage now come straight from `OrgUser.shliach`
  (the backend's real link) instead of the old `contactsByEmail` matching
  against a geo-filtered contact list. The area/building filter's shliach
  membership check was rewritten the same way (mirrors the backend's own
  `contact_type=shliach` area/building resolution in
  `routers/contacts.py::_contacts_query`).
- `notes`/`areas`/`report_numbers` joined `email`/`phone`/`created` as
  optional, reorderable columns (Customize Columns panel) — inline-editable
  via the same `AreaMultiSelect`/`ReportNumberMultiSelect`/`InlineEdit`
  components `ContactView.tsx` already uses, disabled + "—" for a row with
  no linked contact.
- Any admin-added `contact_shliach` custom picklist or non-select custom
  field now gets its own toggleable column too (same treatment the Contacts
  page gives `contact_mekurav`'s), editable via `PATCH /api/contacts/{id}`
  since those values live on the Contact record, not the User.
- The "open/edit" form now renders an **Audit / Edit History** panel for any
  shliach row with a linked contact — the same full-row-snapshot version
  list `ContactView.tsx` shows (editor, timestamp, name/email/phone,
  areas, report numbers, notes per version), fetched from the existing
  `GET /api/contacts/{id}/shliach-history`. Admin/staff rows have no
  versioned data to show (fixes45's deliberate choice not to version `User`
  directly — it's the JWT auth identity) — no history section, that is
  itself the documented behavior, not a gap.

## Files touched
- `backend/app/core/shliach.py`
- `backend/app/routers/contacts.py` (import the moved helpers)
- `backend/app/routers/users.py`
- `backend/app/schemas.py`
- `frontend/app/dashboard/users/page.tsx`
- `backend/tests/test_fixes46.py` (new)

## Verification
- `pytest` (Docker backend container, real Postgres schema at the current
  migration head): 436 passed (430 pre-existing + 6 new), 0 failed.
- `tsc --noEmit` (frontend container): clean.
- Live end-to-end smoke test against the running Docker stack's actual
  Postgres DB (not SQLite) via direct HTTP calls, in a fresh org: created a
  shliach contact, confirmed `GET /api/users` resolved `shliach.contact_id`
  via the real FK; `PUT /api/users/{id}` with `{shliach: {notes, area_ids}}`
  created exactly one new version and returned it; `GET
  /api/contacts/{id}/shliach-history` returned the retired pre-edit version
  with the correct editor name.
- `GET /dashboard/users` served 200 with no compile/runtime error markers.
- **Not done this round:** an interactive in-browser click-through (the
  usual CDP headless-Chrome drive). The host had ~34 real Chrome windows
  open, and the drive's standard cleanup (`taskkill //IM chrome.exe //F`)
  kills every Chrome process system-wide (see
  `fixes44-progress` memory) — running it risked closing the user's actual
  work. Backend behavior is verified end-to-end above; the new UI code
  reuses `InlineEdit`/`AreaMultiSelect`/`ReportNumberMultiSelect`/
  `PicklistSelect`/`CustomFieldValueInput` verbatim from the already
  live-verified Contacts/ContactView pages rather than new components.
