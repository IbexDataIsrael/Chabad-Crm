# fixes17 — Implementation Plan

Source spec: `docs/fixes17.md`. The backup-discoverability preamble is dropped
(user found the card — settings page, org-admin login).

## Investigated root causes

- **§4 "raw localization keys":** every `apm.*` / boundary key listed IS
  seeded (he+en) — but `AreaPolygonMap.tsx` never calls `t()`; all its labels
  are hardcoded Hebrew. Fix = wire the component to the existing keys (no new
  seeds needed).
- **§5 shliach can't see own contacts:** backend scoping is correct
  (ownership forced on create, query filters by it). The bug is the fixes15
  *persisted* owner filter: `crm.contacts.assigned` in localStorage survives
  across logins on a shared browser, so a shliach inherits an admin's guid
  filter → empty list. Fix: shliach never applies an owner filter; for
  admin/staff a persisted guid that no longer matches an org user resets to
  self. Backend regression test added anyway.
- **§2.3 dependent building filter:** already implemented in fixes15
  (contacts/shluchim/apartments restrict building options by selected areas)
  — verify only.

## 1. General (§1)

- **§1.1 DB-backed preferences:** new `user_preferences` table (user_id, key,
  value JSON text, unique per user+key) + migration `f2a3b4c5d6e7`;
  `GET/PUT /api/preferences` (any authenticated user, self-scoped). Frontend
  `useDbPreference(key, initial)` — localStorage as instant boot cache,
  server value wins on load, write-through both (debounced PUT). Migrated:
  contacts columns (`contacts.columns`), apartments fields
  (`apartments.fields`), and the UI language (`locale`, synced inside
  `LocalizationProvider`, which sits under `AuthProvider`). Login-page
  language toggle keeps working via localStorage when logged out.
- **§1.2 native dialogs:** new `ConfirmProvider` + `useConfirm()` (promise
  API over the existing `ConfirmModal`), registered in providers. Replace all
  15 `confirm()` sites + the 1 `alert()` (picklists → toast).
- **§1.3 org-branded email:** `send_email` gains `from_name` / `reply_to`;
  From becomes `"<org name>" <system address>` (Gmail SMTP can't spoof the
  address itself — the org's admin email goes in Reply-To). Applied to the
  shliach/user welcome + verification sends. Organizations have no email
  column — the acting admin's email is the reply-to.
- **§1.3 template seeding:** add `tenant_verification` to
  `DEFAULT_EMAIL_TEMPLATES`, seeded with the exact `hello_tenant.html`;
  `send_verification_email` now renders through the editable DB template
  (falls back to the same default).

## 2. Contacts (§2)

- **§2.1** Mail / Call / WhatsApp buttons on the single-contact view header;
  `telHref`/`waHref` move to shared `lib/contactActions.ts` (list reuses).
- **§2.2 backend:** `_contacts_query` gains `mitzvot` (repeated param,
  validated against the 5 checklist booleans, AND semantics) and
  `tzedaka_potential` (ilike on the mekurav column); exposed on `/list` +
  `/emails`. `has_mitzvot` kept for compat.
- **§2.2 frontend:** `MultiSelectFilter` genericized to string ids; a mitzvot
  multi-checkbox dropdown (labels = seeded `community_checklists.*`, bilingual
  by construction — fixes the "missing in English" complaint) + a debounced
  tzedaka-potential text filter. Both persisted + passed to bulk email.

## 3. Apartments (§3)

- **§3.1** `apartmentTitle` / backend `apartment_title`: `"A" + "3"` →
  `"A - 3"` (single parts unchanged); update the fixes7 title test. The list
  becomes a real `<table>` with labeled column headers (existing localization
  keys); field-config now toggles columns (`resident`, `building`, `area`,
  `notes`, `phone`, `email`, `language`, `jewish_status`, `campaign_status`,
  `mezuzah_status`; unknown stored keys ignored) and moves to DB prefs.
- **§3.2** label sort bug: `(length, value)` ordering breaks alphabetical
  names ("Bet" < "Aleph"). New dialect-aware key: pure-numeric labels sort
  naturally (by length then value), alphabetic labels sort alphabetically
  (regex `~ '^\d+$'` on Postgres, GLOB on SQLite). Numeric-only expectations
  in test_fixes8 unchanged. Add `sort=created` (backend Literal + UI option).

## 4. Areas (§4)

- Localize `AreaPolygonMap` with the already-seeded `apm.*` keys (buttons,
  status line, hints, fallback texts).

## 5. Shliach visibility (§5)

- Contacts page: `isShliach` → owner filter forced to "" (never persisted
  stale); admin/staff: persisted guid validated against the loaded user
  directory, resets to self when unknown. Regression test: shliach creates a
  contact → sees it in `/api/contacts/list`.

## Verification

- `backend/tests/test_fixes17.py` (preferences, mitzvot/tzedaka filters,
  sort fix + created sort, shliach visibility, tenant_verification template,
  org-branded From/Reply-To) + full pytest; frontend tsc; live smoke; commit.
