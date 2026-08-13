# Fixes45: Shliach edit history — versioned like Apartments

Originated in chat (not a written spec beforehand) — captured here per the
"specs in MD" convention so it survives across sessions.

## Request

Follow-up to fixes44's Users-page inline editing: the user asked whether
inline-editing a "user" (shliach role) tracks history the way Apartments
does. It didn't — `PUT /api/users/{id}` was a plain overwrite, and the only
existing shliach audit trail (`contact_shliach_edit_history`, fixes43 §3.1)
was a field-level diff log scoped to coverage data (notes/areas/report
numbers) only, not the login identity fields.

The user's decision, after discussing the safety tradeoffs (see below):
"when user is editing 'user' he is actually editing 'shliach' — add a bool
field `is_display` and have edit history like apartments. drop the table
contact_shliach_edit_history."

## Why not version `User` directly

Auth resolves the session by the raw `User.id` in the JWT `sub` claim
(`deps.get_current_user`). Apartment-style versioning retires the current row
and inserts a new one with a new id on every edit — applied to `User`, any
edit to a shliach's name/email/phone would invalidate their live session
(and every FK pointing at `users.id`, plus the `username`/`email` unique
constraints, would need juggling between the old and new row). None of that
applies to `ContactShliach` — nothing outside two owned child tables
(`ContactShliachArea`, `ReportNumberContactShliach`, both already
`ON DELETE CASCADE`) references its id, and it isn't the auth identity.

## What changed

- `ContactShliach` is now versioned exactly like `Apartment`: `is_display` /
  `last_edit` / `editor_id` / `root_id`, plus a `full_name`/`email`/`phone`
  snapshot mirroring whichever surface made the edit. `contact_id` is no
  longer unique (it identifies a lineage now) and its FK is
  `ON DELETE CASCADE` (every version goes when the contact does, not just
  the one the ORM relationship can see).
- Coverage links (`ContactShliachArea`, `ReportNumberContactShliach`) are
  **copied** forward onto each new version — same "frozen snapshot" trick
  Apartments uses for `picklist_links`. A retired version's own links are
  left untouched, so no separate diff log is needed to answer "what report
  numbers did this shliach have as of version N."
- Both edit surfaces feed the same versioned table: `PUT /api/users/{id}`
  (Users page — full_name/email/phone) and `PATCH /api/contacts/{id}`
  (contact's shliach form — notes/areas/report-numbers, plus the same
  identity fields when edited from that side). Each produces at most one new
  version per request, not one per changed field.
- `contact_shliach_edit_history` is dropped; `GET
  /api/contacts/{id}/shliach-history` now returns full version snapshots
  (`ShliachVersionOut`) instead of field diffs.
- Audited every other query against `ContactShliach` and scoped the ones
  resolving "current state" to `is_display=True`: `core/shliach.py`'s
  `resolve_shliach`, the contacts-list shliach-ownership outer join (was
  about to fan out into duplicate rows per historical version), the
  area/report-number "who currently covers this" lookups (`areas.py`,
  `report_numbers.py`), the reminder-email scheduler's area-coverage lookup,
  `search.py`'s shliach-owns-contact scoping, and the various
  linked-elsewhere/dup-login checks in `contacts.py`/`users.py`. Left the two
  pre-delete bulk-null cleanups (`admin.py`, `users.py`) deliberately
  unfiltered — they must touch every historical version or the delete's FK
  cleanup is incomplete.
- Frontend: the contact page's shliach history panel now renders version
  snapshots (name/email/phone/notes/areas/report-numbers per version) instead
  of old/new field-diff lines.

## Files touched

- `backend/app/models.py` — `ContactShliach` versioning columns, `Contact.shliach` primaryjoin, `ContactShliachEditHistory` removed
- `backend/app/core/shliach.py` — `apply_shliach_versioned_update`, `copy_shliach_children`, `resolve_shliach` is_display filter
- `backend/app/routers/contacts.py` — create/update/history/clear-areas rewritten; every raw `ContactShliach` query audited
- `backend/app/routers/users.py` — `update_user` + `recreate_user` version on identity edits
- `backend/app/routers/admin.py`, `auth.py`, `areas.py`, `report_numbers.py`, `search.py`, `app/scheduler.py` — is_display scoping fixes
- `backend/app/schemas.py` — `ShliachOut` gains full_name/email/phone; `ContactShliachHistoryOut` → `ShliachVersionOut`
- `backend/alembic/versions/3c4d5e6f7a8b_fixes45_shliach_versioning.py`
- `frontend/lib/types.ts`, `frontend/components/ContactView.tsx`

## Verification

- `pytest` (Docker backend container): 430 passed, 0 failed (rewrote the 2
  `test_fixes43.py` history tests that asserted on the old diff-log shape —
  including the no-op-skip case, since apartment-style versioning
  intentionally doesn't skip no-op resubmits either).
- Live smoke test against the local dev stack: edited a shliach's phone via
  `PUT /api/users/{id}`, confirmed a new `contact_shliach` version was
  created with `area_ids` correctly copied forward, confirmed
  `GET /shliach-history` returned the retired version with the right editor
  and timestamp, then reverted the phone value. Migration applied cleanly to
  local Postgres (unique constraint dropped, `ON DELETE CASCADE` in place,
  all 21 existing rows backfilled, `contact_shliach_edit_history` gone).
- `tsc --noEmit` (frontend): clean.

Not deployed — this is local/uncommitted, matching the project's "no
commit/push unasked" rule.
