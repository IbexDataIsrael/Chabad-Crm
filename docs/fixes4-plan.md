# fixes4 — Implementation Plan

Plan for the changes in `docs/fixes4.md`. Structured like `fixes2-plan.md`:
locked decisions, open questions, target schema, work breakdown, phasing.

## Migrations: wipe & reseed (user-approved)

The user approved **dropping the old database** — no migrations needed. So all schema
changes below are applied by recreating the SQLite DB (`create_all`) and re-running the
seeders. No Alembic. Existing dev data is disposable.

## Decisions (locked via Q&A)

| Topic | Decision |
|---|---|
| **Bilingual scope** | **Full English UI + language toggle now.** Localization drives every label; a header toggle (`עברית | English`) switches language and flips `dir` (RTL↔LTR). Picklist options render the language's value. |
| **Special-date title** | **Free text.** `special_date_title` becomes a typed text input; removed from the picklist registry. |
| **Shliach role** | **Block shliach from creating contacts** (removes the buggy path). Shluchim instead get the **Apartment** workflow. Admin/staff still create contacts. |
| **Localization migration** | **Full sweep first.** Extract *every* hardcoded Hebrew UI string into the localization table (with English) before building new features. Front-loaded as Phase 1. |
| **DB migrations** | **Wipe & reseed** — user approved dropping the DB. No Alembic; `create_all` + seeders recreate everything. |
| **Dynamic picklists** | **All picklists are data-driven.** Definitions live in `picklists`; a contact's selected option is stored generically in `contact_picklist_values` (no hardcoded column). "System" picklists are just those seeded `is_system=true` out of the box. New picklists (incl. `Jewish_status`/`affiliation`/`language`) need **zero schema changes**. *Pre-existing* column-backed system picklists (area, status, color, contact_type, potential_next_step) stay as columns for now (filtering/sorting); converting them is a later P2 option. |

## Open questions to confirm

1. **Multi-area on `new-shliach`** — does a shliach now cover one-or-more **areas** (new `contact_shliach_area` M2M), in addition to the existing apartment coverage? Or does "area" here just mean the apartment-area they already pick? Proposed: add shliach↔area M2M.
2. **Visit History vs existing data** — there is already `contact_mekurav.first_visit` and an **Interactions** timeline. Confirm Visit History is a *separate* module (per spec), not a merge into Interactions.
3. **Email brand colors** — "official website color scheme": use the app's status palette (magenta `#d6249f`, green, etc.) from `tailwind.config.js`? Is there a website/brand guide to match?
4. **Donations placement** — a top-level **Donations page** (admin) listing all donations incl. contact-less ones, *plus* a per-contact donations section? Proposed: both.

---

## Target schema changes (additive)

### Changed: `organizations`
- Add `default_lat` (Float, nullable), `default_lng` (Float, nullable), `default_zoom` (Int, default 13) — map starting point, edited in config. Replaces the hardcoded Sheepshead Bay `DEFAULT_CENTER`.

### Changed: `field_localization` (becomes the full UI string table)
- Add `english_label` (String, nullable — blank allowed per fallback rule).
- Broaden usage: rows now cover **all** UI strings (nav, buttons, page titles, labels), categorised by `entity_type` (e.g. `nav`, `button`, `label`, `page`, `field`).

### New: `picklists` (per-org picklist **definitions** — promotes the hardcoded `PICKLIST_FIELDS`)
`id, guid, organization_id, system_name (e.g. "Jewish_status"), hebrew_display_name,
english_display_name, is_system (bool), sort_order`. Unique `(organization_id, system_name)`.

### Changed: `picklist_values`
- Add `english_value` (String, nullable — blank allowed).
- Keep `value` as the stored **technical/system token**; `hebrew_label` → treated as **hebrew_value**. (Add `english_value` alongside; optionally rename `hebrew_label`→`hebrew_value` in a later cleanup to match the spec's naming — cosmetic.)
- Keep the existing `field_key` string; `picklists.system_name` == `field_key`.

### New: `contact_picklist_values` (generic per-contact picklist storage)
`id, guid, organization_id, contact_id (FK), picklist_id (FK → picklists), value`.
Unique `(contact_id, picklist_id)`. Stores a contact's selected option for **dynamic**
picklists (`Jewish_status`, `affiliation`, `language`, and any admin-created picklist) so
no schema column is needed. Pre-existing column-backed system picklists are unaffected.

### Changed: `significant_dates`
- `special_date_title`: now free text (no picklist validation). Remove `significant_date.title` from the registry.

### New: `visit_history` (per-contact, N rows)
`id, guid, organization_id, contact_id (FK), visit_date (DateTime), notes (Text)`.

### New: `donations` (admin-only, N per contact, contact optional)
`id, guid, organization_id, contact_id (FK, **nullable**), donation_date (DateTime),
amount (Numeric/Float — "סכום"), is_ongoing (Bool — הוראת קבע),
number_of_payments (Int), notes (Text)`.

### New (Open Q3): `contact_shliach_area` (M2M shliach ↔ area)
`id, guid, organization_id, contact_shliach_id (FK), area_id (FK)`.

### New system picklists to seed (per-org, English blank per fallback rule)
- `Jewish_status` (יהדות): `/`, יהודי, יהודי מעוניין ביהדות, יהודי וגוי, יהודי מעוניין וגוי, יהודי שתומצ
- `affiliation` (השתייכות דתית): `/`, חבד, חרדי, דתי לאומי, רפורמי, קונסרבטיבי
- `language` (שפה): `/`, עברית, אנגלית, רוסית, יידיש

---

## Backend work

1. **Schema + seed (wipe & reseed)**: add the new columns/tables to `models.py`; recreate the DB and extend `seed.py` to seed the new picklists/columns/sample data. No migration tooling.
2. **Localization model + API**: `english_label` column; `GET /api/metadata/localization` returns `{ key: { he, en } }`; admin CRUD `POST/PUT /api/localization` for editing entries.
3. **Picklist definitions**: new `picklists` table + router; migrate the hardcoded `PICKLIST_FIELDS`/`FIELD_KEY_TO_COLUMN` registry into DB rows (keep the column-mapping in code for the legacy column-backed ones). Values gain `english_value`. Validation reads the DB registry. Dynamic picklists store contact selections in `contact_picklist_values`.
4. **Bug — shliach contacts**: gate `POST /api/contacts` (and shliach provisioning) so **only admin/staff** create contacts (`require_admin_or_staff`); shliach gets 403. (Investigate the original 500 for the record, but the path is being removed.)
5. **Bug — special-date title**: drop picklist validation for the title; accept free text.
6. **Visit History router**: full CRUD under `/api/contacts/{id}/visits` (org-scoped).
7. **Donations router**: `/api/donations` CRUD, **admin-only**; supports contact-less rows; filter by contact.
8. **Apartments for shliach**: allow shliach role to create/list apartments they cover; optional `contact_id` association on create (sets the mekurav's `apartment_id`); shliach read-scoping already exists — extend to apartments.
9. **Org map center**: columns + `organizations/me` PUT accepts them.
10. **Email**: HTML-capable `send_email` (text + HTML alternative); template loader for `/HTML/*.html`; trigger on admin creating a shliach contact (Template 1); switch tenant verification email to Template 2.

## Frontend work

1. **Localization engine (Phase 1, full sweep)**: a `LanguageProvider` (current lang + setter, persisted), header toggle, `dir`/`lang` on `<html>` flipping RTL↔LTR; `t(key)` resolves from the loaded `{he,en}` map. **Extract every hardcoded Hebrew string** in `app/` + `components/` into localization keys (seed he + en).
2. **Localization config page**: admin editor to edit every localization entry (he + en) — under settings/config.
3. **Picklist config page** (`עריכת תיבת בחירה`): edit all picklists incl. system ones; manage definitions (he/en display names) + values (he/en). Replaces/extends current `dashboard/picklists`.
4. **Inputs**: reusable `PhoneInput` component; instant (on-type) validation for **email and phone**; geographic phone validation (US/Canada or Israel). Reuse `lib/validation.ts` (extend US→US/Canada).
5. **Bug — mekurav special dates**: ensure the significant-dates editor is available for every mekurav (incl. immediately after creation); allow adding dates in the create flow. Title field → free-text input.
6. **Contacts page**: filter to **mekurav only** (`?contact_type=mekurav`).
7. **Shluchim page** (`/dashboard/shluchim`, **admin only**, labelled **פעילים**): lists shliach contacts; nav item "פעילים".
8. **new-shliach**: **multi-area** selector (Open Q3); area multi-select component.
9. **Apartments**: list page + nav (**shliach + admin**, "דירות"); shliach apartment-create flow with optional "associate existing contact". Shliach nav shows דירות/אזורים, **no** add-contact.
10. **Visit History UI**: per-contact editor on the contact detail page (like `SignificantDatesEditor`).
11. **Donations UI**: top-level admin **Donations** page (all donations, contact as clickable link `איש קשר`) + per-contact section. Nav item (admin).
12. **Maps & coords**: relabel `שלוחים`→`פעילים` (now a localization key) on `/dashboard/areas`; map center from org config (fallback to a constant); lat/lng shown **read-only**, minimal `x,y` format, manual editing disabled.

## Email templates (`/HTML` root dir)

- Responsive HTML, app color scheme (Open Q5), logo `https://cdn-icons-png.flaticon.com/128/1767/1767033.png`.
- **`hello_shliach.html`** — new-shliach access link. Vars: `first_name`, `last_name`, `url_to_system`, `shliach_email`. Sent when admin creates a shliach contact.
- **`hello_tenant.html`** — *(spec mislabels this as a 2nd `hello_shliach.html` — treated as a typo)*. New-tenant registration; embeds the signup form data + the email **approval/verification** link. Replaces the current plain-text verification email.

---

## Progress

- **P0 — DONE.** Schema + seed foundations landed and verified on a fresh (wiped) DB:
  - `organizations.default_lat/lng/zoom` (demo seeded to Sheepshead Bay 40.5862,-73.9442,13).
  - `field_localization.english_label`; `picklist_values.english_value` (both nullable/blank).
  - New `picklists` definition table (11 system defs seeded, `is_system=true`; English display
    set for the 3 new ones, blank elsewhere).
  - New generic `contact_picklist_values` table (per user's dynamic-picklist direction —
    **no** hardcoded `contact_mekurav` columns added).
  - Seeded the 3 new picklists' values (Jewish_status 6, affiliation 6, language 5; "/" = none).
  - `significant_date.title` removed from the registry (now free text; P4 wires the UI).
  - Backend boots clean; `GET /api/picklists` returns all 11. `count_usage` handles dynamic lists.

- **P1 — DONE.** Full bilingual UI + language toggle + complete string sweep.
  - Engine, toggle (RTL↔LTR), admin translations editor `/dashboard/localization`, and
    backend `/api/localization` CRUD — all shipped. **257 localization keys seeded he+en,
    0 missing English.** Every page/component routes its strings through `t()`.
  - Swept: login, signup, verify, register, dashboard chrome/nav/home, contacts
    (list/detail/new/new-shliach), ContactForm/View, ChecklistFields, CustomFieldsEditor,
    SignificantDatesEditor (incl. reminder presets), Apartment picker/multiselect,
    InteractionsTimeline, DatePicker (he/en month+day names), AddressAutocomplete, ContactMap,
    AreaPolygonMap, areas (list/add/edit), buildings, picklists, custom-fields, settings,
    RequireAuth, GoogleSignInButton. `tsc` clean; all 14 routes 200.
  - **Deferred (intentional):** picklist *option-value* bilingual rendering (still shows
    `hebrew_label`) → belongs to **P2** picklist overhaul (needs `english_value` surfaced in
    the API + lang-aware `usePicklist`). `lib/validation.ts` Hebrew hint *constants* remain as
    `t()` fallbacks only → **P3**. Root `app/layout.tsx` `<metadata>` title stays static
    (overridden at runtime by org name). Localization-editor column headers "עברית"/"English"
    are deliberate language labels.

- **P2 — DONE.** Picklist overhaul: DB-driven definitions + bilingual values + config editor.
  - **Backend:** `GET /api/picklists` now reads definitions from the `picklists` table
    (per-org: `field_key`/he `label`/`english_label`/`is_system`). New admin routes
    `POST /api/picklists/definition`, `PUT/DELETE /api/picklists/definition/{id}` (declared
    before the `{field_key}`/`{picklist_id}` value routes to avoid collision; system lists
    can't be deleted). Value schemas (`PicklistValueOut/Create/Update`) carry `english_value`.
  - **Frontend:** `usePicklist` is language-aware — new `display(option)` + lang-aware
    `labelFor` (English value falls back to Hebrew). `PicklistSelect` and the contacts-page
    filters render via `display()`, so **option values now follow the language toggle**
    (closes the P1 deferral). Picklists config page reworked into the **עריכת תיבת בחירה**
    editor: lang-aware tabs, per-option he/en/color editing, a `DefinitionEditor` (edit a
    list's he/en display names; delete custom lists), and an `AddPicklist` form (create a
    new custom list). Verified end-to-end (create/update/delete defs, english_value persist,
    system-list delete → 400).
  - **Deferred to P5:** wiring the 3 dynamic picklists (Jewish_status/affiliation/language)
    onto the mekurav form + `contact_picklist_values` read/write (form work).

- **P3 — DONE.** Inputs & validation.
  - `lib/validation.ts`: `isValidPhone` now accepts **Israeli or NANP (USA/Canada)** numbers
    (area/exchange start 2-9); added `isValidEmail` + `EMAIL_HINT`.
  - New reusable components `PhoneInput` and `EmailInput` — controlled, **instant on-type**
    validation (red border + localized hint once non-empty-but-invalid), `dir="ltr"`,
    optional `onValidityChange`. Hints come from the localization table.
  - Wired into **signup** (email + phone) and **ContactForm** (email + phone, so new/edit
    contact and new-shliach all get instant validation). Typecheck clean; routes 200.

- **P4 — DONE.** The three bug fixes.
  - **Shliach contact-create (the reported error):** new `require_staff_or_admin` dep gates
    `POST /api/contacts` — admin/staff allowed, **shliach → 403** (unit-verified). Shliach
    will use the apartment workflow (P5) instead.
  - **Special-date title → free text:** backend already accepted free text (the title picklist
    was a no-op); removed its validation in add/update. Frontend `SignificantDatesEditor` title
    field swapped from an empty `PicklistSelect` to a plain text input — so titles are now typeable.
  - **Mekurav special dates auto-enable:** the new-contact page now, after creating a mekurav,
    **reveals the significant-dates editor inline** (with the new id) instead of navigating away,
    so dates can be added immediately; a "Done — go to contact" link continues to the card.
  - Verified: admin create 201 (no regression), free-text title add 201, routes 200.

- **P5 — DONE.** Roles & nav.
  - **Stage 1:** contacts page = **mekurav only**; admin-only **Shluchim page** `/dashboard/shluchim`
    (**פעילים**); **Apartments page** `/dashboard/apartments` (admin + shliach) with create +
    **optional associate-contact**; backend `GET /api/apartments/list` (enriched + shliach-scoped),
    `ApartmentCreate.contact_id` links a mekurav's `apartment_id`. Nav: פעילים (admin), דירות (all),
    buildings → admin; new-contact button hidden for shliach.
  - **Stage 2a — dynamic picklists on mekurav form:** `ContactCreate/Update.picklist_values`
    + `ContactDetailOut.picklist_values` ({system_name: value}); generic upsert/read via
    `contact_picklist_values` with picklist validation; the 3 lists render on the mekurav form
    (`MEKURAV_PICKLISTS`) and in `ContactView`. Verified create/read/update/clear/invalid-reject.
  - **Stage 2b — multi-area on new-shliach (Open Q1 resolved):** new `contact_shliach_area`
    M2M (created by `create_all`, no wipe needed); `ShliachData/Out.area_ids`; `_set_shliach_areas`
    in create/update; new `AreaMultiSelect` on the shliach form + areas shown in `ContactView`;
    `GET /api/areas/{id}/shluchim` now unions **apartment-coverage + direct area coverage**.
    Verified end-to-end.

- **Calendar pickers (polish) — DONE.** Verified no native `type="date"`/`datetime-local`
  inputs remain — the bilingual `DatePicker` (built in P1) already covers first-visit and
  significant dates. The only native temporal input left is `type="time"` for reminder times
  (correct). *(This is the "calendar date-pickers" frontend item, not numbered P6.)*
- **P6 — DONE (new modules).**
  - **Visit History** (`היסטורית ביקורים`): new `visit_history` table; sub-resource router
    `/api/contacts/{id}/visits` (GET/POST/PUT/DELETE, org-scoped); `VisitHistoryEditor` (date +
    notes, newest first) on the mekurav contact page.
  - **Donation History** (`היסטורית תרומות`): new `donations` table (**`contact_id` nullable**);
    `/api/donations` CRUD **admin-only**, supports contact-less rows + `?contact_id` filter;
    `DonationsEditor` reused as a top-level admin **Donations page** `/dashboard/donations`
    (contact rendered as a clickable link) and a per-contact section (admin) on the contact page.
    Nav: **תרומות** (admin). Verified end-to-end (visit add/list; donation linked + contact-less +
    filter; contact_name resolved).
- **P7 — DONE (maps & config).**
  - **Map default center → config:** `OrganizationOut/Update` + settings UI carry
    `default_lat/lng/zoom`; `AreaPolygonMap` initializes from the org center (via `useAuth`),
    falling back to the constant. Round-trip verified; `/auth/me` exposes the center.
  - **Coordinates display:** ContactForm lat/lng are now **read-only, minimal `x,y`** (single
    field; coords come from the address picker / geocoding) — no manual editing.
  - **שלוחים→פעילים:** already relabeled in P1.

- **P8 — DONE (email templates).**
  - Responsive HTML templates in **`backend/HTML/`**: `hello_shliach.html` (new-shliach access
    link) and `hello_tenant.html` (new-tenant verification; embeds the registration data + the
    approval/verify link). Branding logo `cdn-icons-png.flaticon.com/128/1767/1767033.png` + the
    app's magenta palette. *(Spec mislabeled template 2 as a 2nd `hello_shliach.html` — treated as
    a typo and named `hello_tenant.html`.)*
  - `core/email.py`: HTML-capable `send_email` (text + `add_alternative` html), a `render_template`
    loader (`{{var}}` substitution from `/HTML`), `send_shliach_welcome`, and `send_verification_email`
    now sends the tenant HTML template (signature takes the `user`).
  - **Triggers:** admin creating a shliach contact → emails the welcome/access link (wrapped so a
    send failure never blocks creation); tenant signup/resend → HTML verification email. Templates
    render-verified; live SMTP is configured (gmail) so sends are real, not dev-printed.

> **fixes4 COMPLETE** — P0–P8 all done.

## Suggested phasing (shippable increments)

- **P0 — Foundations** ✅: add new columns/tables to `models.py`; **wipe & reseed** the DB; seed new picklists/columns; org map-center columns.
- **P1 — Bilingual localization (full sweep)** ✅: localization table he+en, language toggle/RTL-LTR, all strings extracted, localization config editor.
- **P2 — Picklist overhaul** ✅: DB-driven definitions + values (he/en), config editor (`עריכת תיבת בחירה`), DB-backed validation.
- **P3 — Inputs & validation** ✅: `PhoneInput`/`EmailInput`, instant email/phone validation, US-CA/IL geo rules.
- **P4 — Bug fixes** ✅: block shliach contact-create; mekurav special-dates enable; free-text title.
- **P5 — Roles & nav** ✅: contacts=mekurav; Shluchim page (פעילים, admin); multi-area new-shliach; apartment workflow + list page; nav per role; dynamic picklists on mekurav form.
- **P6 — New modules** ✅: Visit History; Donation History.
- **P7 — Maps & config** ✅: map center in config; שלוחים→פעילים; read-only minimal coords.
- **P8 — Email templates** ✅: `/HTML` templates, HTML email, shliach-welcome + tenant-verification triggers.

### Dependencies
- P0 unblocks everything. P1 (localization) should precede P2/P5–P7 since those add UI strings that must go through the table (full-sweep decision). P2 depends on P0. P8 depends on P0 (templates) and pairs with P5 (shliach creation trigger).
