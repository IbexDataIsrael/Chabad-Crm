# fixes27 Implementation Plan — Mivtzoim Filters, Visit Card Layout, Shliach Row Notices, Visit-Field Visibility

Source spec: `docs/fixes27.md`.

## Interpretation decisions (spec ambiguities, resolved)

1. **Already delivered by fixes26 — verified, no new work**: inline editing of
   a visit with autosave (`VisitDetails` + `InlineEdit`, PATCH on blur/Enter),
   the `email` field across contact Create/Read/Update (backend + forms), and
   `POST /api/users/recreate`. fixes27 only *extends* these (§3 puts the
   recreate flow on the shluchim list rows).
2. **Filter semantics** (mirroring the existing mitzvot filter, fixes17 §2.2):
   - `torah_thought`: multi-select over the `checklist.torah_thought` picklist;
     a contact matches when **any** of its visits carries one of the selected
     values (OR within the list).
   - `connection_to_rebbe`: free-text *contains* match (ilike) against any of
     the contact's visits — it's a free-text visit column.
   - `custom_fields`: list of `field_key`s; **each** selected key must be
     checked on at least one visit (AND across keys, like `mitzvot`). Unknown
     keys → 422. In the UI the custom fields join the same "מבצעים"
     multi-select as the built-in flags (prefixed ids, split into the two
     query params when requesting).
3. **§4 visibility rides the existing field-settings engine** (field_registry +
   `/api/field-settings` + `useFieldSettings.vis`) — no new storage. The seven
   built-in visit fields (5 Mivtzoim flags, `torah_thought`,
   `connection_to_rebbe`) register as toggleable keys `visits.<col>` under a
   new `visit` entity (default-visible). They surface as toggles on the
   custom-fields dashboard (spec's placement) *and* automatically on the
   existing ניהול שדות page. Custom definitions already have show/hide via
   `is_active` — that stays their mechanism. Visibility is presentation-level
   (forms, cards, filter options), same as every other field toggle.
4. **§3 login status on the list**: `ContactOut.login_status` is populated by
   `/api/contacts/list` for shliach rows via one batched user lookup (resolved
   like `core/shliach.py`: user_id link, else same-org email). The shluchim
   page shows the red notice + recreate button on the affected row.

## §1 Filters

Backend (`routers/contacts.py`):
- `_contacts_query` gains `torah_thought: list[str]`, `connection_to_rebbe:
  str`, `custom_fields: list[str]` (validated against the org's
  `custom_field_definitions`); `/list` and `/emails` pass them through.

Frontend (`app/dashboard/contacts/page.tsx`):
- The "מבצעים" multi-select gains the org's active custom fields as extra
  options (`cf:<field_key>` ids, split into `mitzvot` / `custom_fields`
  params); flags it offers honor `vis("visits.<flag>")`.
- New inputs beside it: a torah-thought multi-select (picklist values,
  `vis`-gated) and a debounced connection-to-rebbe text input (`vis`-gated).

## §2 Visit card layout

- `VisitForm` + `VisitDetails`: the custom-field editors/values render inside
  the "מבצעים" section; the separate "שדות נוספים" heading/section is removed.

## §3 Shluchim list notices

- Backend: `ContactOut.login_status` + batched enrichment in `/list`.
- `shluchim/page.tsx`: rows with `login_status !== "active"` show
  `הכניסה למערכת הושעתה` + a `צור משתמש מחדש` button (admin, needs the row's
  email) → `POST /api/users/recreate` → reload + toast.

## §4 Visit-field visibility

- `field_registry.py`: register `visits.tefillin/tzedakah/shabbat_candles/
  torah_pamphlet/letter_in_torah/torah_thought/connection_to_rebbe`
  (entity `visit`, labels reuse the seeded `visits.*` rows).
- Custom-fields page: new "שדות ביקור מובנים" card listing the `visit` entity
  from `/api/field-settings` with show/hide toggles (admin PUT).
- Fields page: add the `visit` entity group heading.
- `VisitForm` + `VisitDetails`: hidden flags leave the Mivtzoim button row;
  hidden torah_thought / connection_to_rebbe rows disappear; the whole section
  collapses when nothing in it is visible.
- Contacts page: hidden fields drop out of the filter inputs (flags, torah
  thought, rebbe).

## Localization (seed.py)

`filter.all_torah_thoughts`, `filter.rebbe_ph`, `cf.visit_fields` (+ intro),
`table.visit` entity heading. Row-notice strings reuse fixes26's `users.*`.

## Tests (`backend/tests/test_fixes27.py`)

torah_thought / connection_to_rebbe / custom_fields filters (incl. 422 on an
unknown key and AND semantics); `/list` login_status enrichment for shliach
rows (active / disabled / missing / absent for mekurav); visit fields present
in `/api/field-settings` and togglable.
