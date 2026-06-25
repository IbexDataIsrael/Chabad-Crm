# fixes2 — Implementation Plan

Plan for the major changes in `docs/fixes2.md`. **No code yet** — this is the agreed
design. Decisions below reflect the Q&A held while drafting.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Picklists | **Keep** the rich per-org `picklist_values` table (hebrew_label, color_hint, sort_order, is_active). Do **not** flatten to `{id, table_name, field_name, value}`. Optionally also expose `table_name`/`field_name` derived from `field_key`. |
| Google login | **Add now, alongside** username/password. User supplies `GOOGLE_CLIENT_ID`/`SECRET`. Google identity links to an existing `User` **by email**; unknown emails rejected. |
| Google **signup** | **Add now.** `/signup` offers "הרשמה עם Google" as an alternative to the name/username/password form. The org name is still required (it is the app title and can't be derived). A new `POST /api/auth/google-signup` verifies the Google token, rejects an already-registered email, then creates the `Organization` + an **admin** `User` (no password, `google_sub` bound, `is_active`/`email_verified` true since Google already verified the email), provisions the org, and returns a JWT for **immediate** login — no email-verification round-trip. Username is derived from the email local-part (unique within the brand-new org). |
| Contact split | **Keep CRM-ish fields on `contacts`** (area, pipeline_status, color_tag, priority_score, assignee). Move only kiruv-religious fields + the Tefillin checklist to `contact_mekurav`. |
| Shliach | Adding a shliach **auto-creates a linked `User`** (role `shliach`) from the contact's email. Shliach sees **only** mekuravim in apartments they cover (scoped access). |
| Area polygon | **Interactive map drawing now** (Google Maps Drawing library). |
| Reminders | **Real delivery now**, Android-style configurable offset + time. Channel = **Email**. Recipient = **assigned user / covering shliach** *(assumed default — confirm)*. |
| Migration | **Wipe & reseed** the dev SQLite DB (no Alembic). |
| PK convention | Keep existing **int PK + `guid` column** on every table (not GUID-as-PK). |
| Tenancy | **Every** new table carries `organization_id` (doc omitted it; required). |

## Open questions still to confirm

1. **Reminder recipient** — assumed "assigned user / covering shliach". OK?
2. **`significant_date.title` picklist values** — doc gives the *type* values (יום הולדת, תאריך פטירה) but not the *title* values. What are they?
3. **`potential_next_step`** — kiruv or CRM? Plan currently moves it to `contact_mekurav`. Keep on `contacts` instead?
4. **Checklist + custom fields ownership** — plan re-points `community_checklists` and `custom_field_values` to `contact_mekurav` (only mekuravim have them). Confirm.
5. **Multiple reminders per date?** Android allows several (e.g. 1 week + 1 day before). Plan supports N reminders per date via a child table. OK?

---

## Target schema

Convention: `id` (int PK) + `guid` + `organization_id` (tenant) on all tenant tables.

### Changed: `users`
- `role`: now `admin | staff | shliach`.
- `password_hash`: becomes **nullable** (Google-only users).
- `google_sub` (string, unique, nullable) — Google subject id for linked identities.

### Changed: `contacts` (core CRM only)
- Keep: `name, last_name, phone, address, latitude, longitude, assigned_user_id, area, pipeline_status, color_tag, priority_score`.
- **Add** `email` (string, nullable).
- **Add** `contact_type` (picklist `contact.contact_type` → מקורב / שליח).
- **Remove** (move to `contact_mekurav`): `first_visit, rebbe_connection, recommendations, background, potential_next_step`.

### New: `contact_mekurav` (1:1 with a mekurav contact)
`contact_id` (unique FK), `apartment_id` (nullable FK → apartments), `first_visit`,
`rebbe_connection`, `recommendations`, `background`, `potential_next_step`.
- `community_checklists` and `custom_field_values` re-point here (per open Q4).

### New: `contact_shliach` (1:1 with a shliach contact)
`contact_id` (unique FK), `user_id` (nullable FK → the auto-created login user), `notes`.

### New: `contact_shliach_apartment` (M2M shliach ↔ apartment)
`contact_shliach_id` (FK), `apartment_id` (FK). *(corrects doc's copy-paste error.)*

### New: `areas`
`area_name`, `area_notes`, `area_polygon` (text — GeoJSON from the map drawing tool).

### New: `buildings`
`area_id` (FK), `building_name`, `building_address`, `longitude`, `latitude`.

### New: `apartments`
`building_id` (FK), `apartment_name`, `apartment_notes`.

### New: `significant_dates`
`special_date` (datetime), `hebrew_date` (text), `special_date_type` (picklist
`significant_date.type` → יום הולדת / תאריך פטירה), `special_date_title` (picklist
`significant_date.title`), `is_set_reminder` (bool).

### New: `contact_mekurav_special_date` (M2M mekurav ↔ significant_date)
`contact_mekurav_id` (FK), `special_date_id` (FK).

### New: `significant_date_reminders` (Android-style, N per date)
`significant_date_id` (FK), `offset_minutes` (int — how long before the date),
`remind_at_time` (time of day), `channel` (`email`), `last_sent_at` (datetime, nullable).

### Picklists to seed (per-org)
- `contact.contact_type`: `mekurav`=מקורב, `shliach`=שליח
- `significant_date.type`: `birthday`=יום הולדת, `yahrzeit`=תאריך פטירה
- `significant_date.title`: **TBD (open Q2)**

### Localization
Add `field_localization` rows (table + column labels) for every new table/column,
using the Hebrew titles from `fixes2.md`.

---

## Backend work

1. **Models** (`models.py`): all tables above; add `shliach` role, `google_sub`,
   nullable password. Re-point checklist/custom-values FKs.
2. **Schemas** (`schemas.py`): split Contact schemas; add Mekurav/Shliach/Area/
   Building/Apartment/SignificantDate/Reminder Pydantic models.
3. **Routers** (new): `areas.py`, `buildings.py`, `apartments.py`,
   `significant_dates.py`; extend `contacts.py` for the type split + sub-resources.
   Full CRUD on every new entity. All org-scoped; mutations on geo/areas = admin.
4. **RBAC scoping**: helper that, for a `shliach` user, restricts contact reads to
   mekuravim whose `apartment_id` ∈ apartments they cover (via `contact_shliach_apartment`).
   `require_admin` unchanged; add `require_admin_or_self` patterns where needed.
5. **Shliach provisioning**: `POST` "add shliach" creates `contacts(type=shliach)` +
   `contact_shliach` + a `User(role=shliach)` linked by the contact email.
6. **Google OAuth** (`core/security.py` + `routers/auth.py`): verify Google ID token,
   match `User` by email, issue our JWT. New `GOOGLE_CLIENT_ID`/`SECRET` env vars.
7. **Reminder scheduler**: background job (APScheduler) that scans
   `significant_date_reminders` and emails due reminders to the recipient; marks
   `last_sent_at`. Recurrence handles yearly birthdays/yahrzeits.
8. **Seed** (`seed.py`): new picklists + localization; updated sample data for the
   split model. Wipe & recreate the dev DB.

## Frontend work

1. **Add Shliach** admin button "הוסף שליח" → contact + shliach fields; apartment
   multi-select with **autocomplete** ("הוסף דירה").
2. **Mekurav form**: add-apartment flow that first selects a **building**; choosing an
   address creates the apartment (address + lat/lng copied in, editable).
3. **Significant dates** editor inside mekurav form — add/edit/remove dynamically,
   with reminder offset/time controls.
4. **Areas page**: list + CRUD, interactive **polygon drawing** on Google Maps;
   shows shluchim covering the area (click → contact page).
5. **Buildings page**: list + CRUD.
6. **Calendar date-pickers** everywhere (replace `datetime-local`/native) — `react-datepicker`
   with RTL/Hebrew.
7. **Google sign-in** button on the login screen.
8. **Nav + types + localization** updates for all new pages/entities.

## Progress

- **Backend: complete** for all phases (models, areas/buildings/apartments routers,
  contact split + shliach provisioning + significant-dates sub-resources, Google login,
  email reminder scheduler, RBAC shliach scoping). App imports cleanly.
- **Frontend P1 — DONE**: `dashboard/areas` (CRUD + interactive polygon drawing via
  new `AreaPolygonMap`, shluchim-per-area list) and `dashboard/buildings` (CRUD + area
  select + address autocomplete), plus nav links. Typechecks clean.
- **Frontend P2 — DONE**: `ContactForm`/`ContactView` reworked for the contact split
  (nested `mekurav`, `email`, `contact_type`); new `ApartmentPicker` (building→apartment
  with inline "+ הוסף דירה"); new live `SignificantDatesEditor` (CRUD + Android-style
  reminders) on the contact detail page; `first_visit` + significant dates now use the
  calendar `DatePicker` (P6 overlap). Full `next build` passes (all 15 routes, types OK).
- **Frontend P3 — DONE**: admin-only "+ הוסף שליח" button + `contacts/new-shliach` page;
  `ContactForm` now renders a shliach block (notes + apartment **multi-select** with
  autocomplete via new `ApartmentMultiSelect`); `ContactView` shows the shliach's covered
  apartments; checklist/custom-fields are gated to mekurav contacts only. Backend RBAC
  (shliach read-scoping + login provisioning) was already complete. `next build` passes
  (16 routes). NOTE: backend `POST /api/contacts` is *not* admin-gated, so shliach creation
  is currently restricted only in the UI — tighten server-side if required.
- **Frontend P5 — DONE**: Google sign-in button placed on the login screen (`/`). Plus
  **Google signup**: new `POST /api/auth/google-signup` (org + admin from a Google
  identity, immediate JWT) and a "הרשמה עם Google" button on `/signup` (requires only the
  org name) wired via `googleSignup` / `signUpWithGoogle`.
- **Frontend P6 pending**: remaining calendar date-picker swaps + polish.
- **Areas UX**: "הוסף אזור" now navigates to a dedicated route `dashboard/areas/add`
  (cleaner than the inline editor). `AreaPolygonMap` rewritten to draw polygons with
  **core Maps classes only** (Polyline/Polygon/Marker + map click handler) — the async
  `drawing` library (`DrawingManager`) loaded separately from core and was unreliable.
  Has a visible load-status overlay + GeoJSON-textarea fallback on map-load failure.
- **Dev infra (Windows/Docker)**: the Windows→Linux bind mount doesn't deliver inotify
  events, so Next's dev server silently served **stale** code and 404'd new routes.
  Fixed by `WATCHPACK_POLLING=true` + `CHOKIDAR_USEPOLLING=true` on the frontend service
  in `docker-compose.yml`. If edits ever stop reflecting, `docker-compose restart frontend`.

## Suggested phasing (shippable increments)

- **P1 — Schema & geo CRUD**: models, migration wipe, Areas/Buildings/Apartments
  backend + pages (polygon drawing).
- **P2 — Contact split**: contacts/mekurav/shliach tables, forms, checklist re-point.
- **P3 — Shliach role + RBAC scoping + auto-provisioning**.
- **P4 — Significant dates + reminder scheduler (email)**.
- **P5 — Google login**.
- **P6 — Calendar date-pickers + polish**.
