# fixes40 (round 2) — Implementation Plan

Source spec: `docs/fixes40.md` (this file's content was replaced with a new,
unrelated spec after the round-1 work — old fixes36-39(-plan)/fixes40-plan
docs are now in `docs/archive/`, a routine housekeeping the user does
periodically; the round-1 fixes40 *code* — custom-fields tabs, owner
filter, label styling, reports column reorder — is untouched and still in
the working tree). Four items.

## 1. Superadmin auth/routing fix + env var rename

### Current state (verified by reading the code)
- `/dashboard` (`DashboardHome`) already redirects `isSuperadmin` to
  `/dashboard/admin` — the routing rule itself is correct.
- Superadmin is seeded by `seed_superadmin()` (backend/app/seed.py) from
  `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` env vars, with the `username`
  **hardcoded** to the literal string `"superadmin"` — unlike the demo
  admin, which has independently configurable `admin_username`/
  `admin_password`/`admin_email`.
- No superadmin exists in the local dev DB (no `SUPERADMIN_*` env vars set)
  — the actual routing bug needs to be reproduced live after seeding one.

### Design
- Add `superadmin_username: str = "superadmin"` to `Settings`
  (`SUPERADMIN_USERNAME` env var, defaulting to today's hardcoded value —
  no behavior change for orgs that don't set it), and use it instead of the
  literal in `seed_superadmin()`.
- Set `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` in the local `.env`,
  restart the backend, and log in live to actually observe the routing bug
  before guessing at a fix — likely candidates once reproduced: a stale
  `isSuperadmin` read before `user.role` populates, or the login page's own
  `useEffect`/`onSubmit` double-redirect racing the `/dashboard` redirect
  effect.

---

## 2. Multi-org login + deep-link redirect

### Current state
Both already appear fully implemented: `signIn`/`signInWithGoogle` return
`LoginOrgOption[]` when `requires_org_selection`, driving an org-picker
screen (fixes14); `RequireAuth` captures `pathname+search` into
`?redirect=` before bouncing to `/`, and the login page's `loginTarget()`
reads it back (fixes8 §3). Treat as **verify, not rebuild** — drive both
flows live and fix whatever actually breaks, rather than re-implementing
working code.

---

## 3. `dashboard/fields` — 3 tabs + per-field order number

### Current state
`dashboard/fields` stacks 6 fixed `ENTITY_GROUPS` sections (contact /
contact_mekurav / contact_shliach / building / apartment / visit) each
listing its `FieldSetting`-backed toggleable fields, plus a separate
bottom "שדות נוספים" (Additional fields) block re-listing every custom
field grouped by entity again (`CustomFieldsSection`) — i.e. a custom field
already appears in *two* places on this page today.

`GET /api/field-settings` already unifies 3 categories into one
`FieldSettingOut` list: built-in registry fields (`FieldSetting`, **no
sort_order today**), custom picklists (`PicklistDefinition.sort_order` —
exists, unexposed), custom fields (`CustomFieldDefinition.sort_order` —
exists, unexposed, already PATCHable via `PUT /api/custom-fields/{id}`).

### Design
- Backend: add nullable `FieldSetting.sort_order` (Integer) — migration,
  `down_revision` = current head. Extend `FieldSettingOut`/
  `FieldSettingUpdate` with `sort_order: Optional[int]`; `PUT
  /api/field-settings` writes it to whichever underlying row the key
  resolves to (`FieldSetting` / `PicklistDefinition` /
  `CustomFieldDefinition`) — one endpoint, one shape, for all 3 categories,
  reusing the ordering columns/queries that already exist for 2 of the 3.
  Expose `PicklistDefinition.sort_order` on `PicklistFieldOut`/frontend
  `PicklistField` too (currently missing) so custom picklists can also
  carry an order value into entity-page rendering (§4).
- Frontend: same 3-tab pattern as `dashboard/custom-fields`/
  `dashboard/picklists` (`tabFor()`, tab bar, per-tab section) —
  "building" folds into the "apartment" tab (matches those two pages,
  neither of which has a separate building entity_type). Each tab lists
  its built-in fields AND custom fields/picklists **together** (merged,
  not the current two-places split) — `CustomFieldsSection` is deleted
  entirely. Every row gets a numeric order `<input>` next to its existing
  show/hide toggle.
- Validation: client-side, scoped per tab (not globally) — on blur/save,
  reject a duplicate order number already used by another *visible* row in
  the same tab with an inline error, mirroring this app's existing
  client-side validation style (phone/email hints).

---

## 4. Apply the configured order to entity detail pages

Scope: fields/rows that are *already* independently manageable via
`dashboard/fields` (built-in toggleable + custom fields + custom
picklists) get sorted by their number; fields that are hardcoded/always-on
and never appear on `dashboard/fields` today (name, contact_type, a few
structural anchors) are out of scope for this round — they stay at their
current fixed position, same "not literally every string" boundary the
label-styling round drew.

- **Contact Details** (`ContactView.tsx`): already builds `[fieldKey,
  label, node]` tuple arrays before rendering (`fields`, `mekuravFields`,
  `shliachFields`, plus custom picklist/field entries already interleaved
  in there) — no structural rewrite needed, just sort the combined array
  by a fetched order-map before `.map()`-rendering. Unordered entries keep
  their current relative position (stable sort, order-less = "falls after
  every explicitly-ordered entry, original sequence preserved among
  themselves") so a section nobody has touched renders byte-for-byte as
  it does today.
- **Summary of Visits section**: already dynamic and already ordered by
  `CustomFieldDefinition.sort_order` server-side (fixes39 §2) — making
  that number editable via `dashboard/fields` (§3 above) is sufficient,
  zero extra rendering code.
- **Visit Details/records**: the custom-field/picklist portions are
  already fetched pre-ordered by `sort_order` (same fixes39/fixes35
  queries) — only the one remaining built-in visit field
  (`torah_thought`) has a hardcoded fixed position; interleave it via the
  same sort-the-tuple-array treatment as the contact page if time allows,
  otherwise document as a small, explicit gap.
- **Apartment Detail page** (`apartments/[id]/page.tsx`): unlike the
  contact page, fields render via inline `field(key, labelKey, fallback,
  node)` calls directly in JSX, not a pre-built array — this needs an
  actual (mechanical, not conceptual) refactor: collect the same calls'
  results into a `[key, node, span2]` array first, sort it the same way,
  then render. Custom picklists/fields already `.map()` from arrays, so
  those just need their sort applied at the same point.

---

## Order of implementation
1. §1 superadmin (bounded; live-reproduce the actual bug before fixing).
2. §2 verify multi-org + deep-link live; fix only what's actually broken.
3. §3 backend (FieldSetting.sort_order + unified PUT) then frontend
   (dashboard/fields rewrite) — this is what §4 depends on.
4. §4 apply ordering: Contact page (small diff) → Visit Summary/Details
   (mostly free) → Apartment page (the one real refactor).
5. Backend `pytest`, frontend `tsc --noEmit`.
6. Live-drive verification (docker-compose) covering all 4 items.
7. Update `docs/fixes40.md` with a `## Status` closeout section.
