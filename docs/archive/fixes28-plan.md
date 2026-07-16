# fixes28 — Implementation Plan

Source spec: `docs/fixes28.md`. Baseline: fixes27 (`899e052`), local Docker stack
(frontend :3001, backend :8001, local Postgres :5432).

## Findings from code/live investigation

- **§1 email**: the backend already fully supports `contacts.email`
  (model column, Pydantic create/update validation, live-tested POST/PATCH
  round-trip). The only way the field goes missing in the UI is the
  `contacts.email` visibility toggle (`field_settings`) — the form, view and
  list gate on `vis("contacts.email")`. Fix = promote email to a **core,
  always-visible identity field** like name/phone.
- **§2**: `POST /api/users` (restricted user) does *not* create a
  `ContactShliach` today — live-verified. The association leaks in through two
  side doors: (a) `_provision_shliach_user()`'s reuse path links an existing
  **staff** ("משתמש מוגבל") account to a new/edited shliach contact by email;
  (b) `POST /api/users/recreate` reactivates+links *any* same-org account with
  the contact's email, staff included. Also, the shluchim page's data endpoint
  (`/api/contacts/list?contact_type=shliach`) never checks the linked login's
  role, so a shliach-contact row backed by a staff login still renders.
- **§3**: fixes27 already filters the מבצעים dropdown *options* by
  `vis("visits.*")`, but the **persisted selection** (`crm.contacts.mitzvotFields`
  in localStorage) is not pruned: a hidden flag that was checked earlier keeps
  being sent as a `mitzvot=` query param (silently filtering results) and keeps
  counting in the "N נבחרו" chip. Server-side, `custom_fields=` accepts keys of
  **deactivated** custom-field definitions (the `org_keys` guard ignores
  `is_active`), and `mitzvot=` accepts org-hidden flags.

## 1. Contact_mekurav and visits

### 1a. Visit card UI refactor — `frontend/components/VisitHistoryEditor.tsx`
- Remove the "הצג" and "ערוך" links; keep only "מחק".
- The collapsed visit row (its title/summary line) becomes clickable and
  expands the visit in place; expansion always renders `VisitDetails` with
  inline per-field autosave enabled (`readOnly=false`).
- `VisitDetails` keeps its `readOnly` prop (still used by
  `/dashboard/visits`); no change there.

### 1b. Layout reorder — `frontend/app/dashboard/contacts/[id]/page.tsx`
- Order becomes: contact info section → **visit history** → significant dates
  → donations.

### 1c. Visit date-range filter clear — `frontend/app/dashboard/contacts/page.tsx`
- Add a one-click "נקה" (clear) button beside the two range `DatePicker`s,
  shown whenever either bound is set; resets `visitFrom`/`visitTo` to null and
  goes back to page 1. (Reuses existing `action.clear` localization key.)

### 1d. Contact email = core CRUD field
- `frontend/components/ContactForm.tsx`: drop the `vis("contacts.email")` gate —
  email always renders (still required for a shliach).
- `frontend/components/ContactView.tsx`: email row moves to `null` fieldKey
  (always shown) in the mekurav field list (shliach list already does this).
- `backend/app/field_registry.py`: remove `contacts.email` from
  `TOGGLEABLE_FIELDS` (it joins name/phone as a non-hideable identity field).
  Stale `field_settings` rows become inert: GET only returns registry fields,
  PUT rejects unknown keys.
- `frontend/app/dashboard/contacts/page.tsx`: email column availability becomes
  unconditional (vis of a non-registry key is true — no code change needed
  beyond the registry removal; simplify the expression to `true`).
- Backend schemas/routes: already complete — add/keep regression tests for
  create/read/update round-trip of email on a mekurav contact.

## 2. Users ↔ Contact_shliach (restricted users)

### 2a. Backend — never associate a restricted user with a ContactShliach
- `_provision_shliach_user()` (contacts.py): the email-reuse path only links
  accounts whose `role == "shliach"`. A same-org staff/admin account with that
  email → 400 with a clear Hebrew message (creating the shliach contact would
  otherwise silently turn a restricted user into an activist login).
- `POST /api/users/recreate` (users.py): same guard — only a `role == "shliach"`
  account may be reactivated/linked; otherwise 400.
- Regression test: `POST /api/users` with `role=staff` creates no ContactShliach
  row and doesn't grow the shluchim listing.

### 2b. Backend — shluchim listing excludes restricted-user rows
- `_contacts_query()` `contact_type == "shliach"` branch: exclude rows whose
  login resolution (mirroring `_login_status_map`: `ContactShliach.user_id`
  link first, else same-org email match) lands on a `role == "staff"` user.
  Admin-role matches are *not* excluded (spec names restricted users only).

### 2c. Frontend — Contact_shliach page
- `/dashboard/shluchim` consumes `/api/contacts/list` — the backend filter
  (2b) covers it; no separate frontend filtering needed.

## 3. Mivtzoim filter obeys custom-fields hidden state

### 3a. Frontend — `frontend/app/dashboard/contacts/page.tsx`
- Compute `effectiveMitzvot` = persisted selection ∩ currently visible options
  (builtin flags with `vis("visits.<flag>")` true; `cf:` keys present in the
  fetched **active** definitions). Use it for the MultiSelectFilter `value`,
  for `listParams()`, and in the fetch-effect deps — a hidden field can no
  longer render in the chip count nor silently filter results.
- Same principle for the torah-thought filter: when `visits.torah_thought` is
  hidden, its persisted selection stops being sent; when
  `visits.connection_to_rebbe` is hidden, the rebbe query param stops being sent.

### 3b. Backend — `/api/contacts/list` + `/emails`
- `mitzvot=` names whose `visits.<flag>` field-setting is hidden for the org are
  ignored (dropped), not applied.
- `custom_fields=` keys are validated against **active** definitions; keys of
  deactivated definitions are ignored; only entirely unknown keys still 422.

## Tests & verification
- Backend: new tests in `backend/tests/test_fixes28.py` (staff user creates no
  shliach row; provisioning/recreate role guards; shluchim list exclusion;
  hidden-mitzvah + inactive-custom-field filter ignoring; email CRUD
  round-trip). Full `pytest` suite in the backend container.
- Frontend: `tsc --noEmit`, then a headless-Chrome CDP drive of: contact page
  visit card (expand-by-title, inline edit, delete-only), section order, email
  field on create/edit, מבצעים filter after hiding a flag, date-range clear.
