# Fixes 9 — Technical Implementation Plan

Spec: `docs/fixes9.md` (dynamic system title, `admin_areas` entity, mekurav
`tzedaka_potential`, localization). One Alembic migration.

## 0. Database migration (one revision, follows `e5f6a7b8c9d0`)

`backend/alembic/versions/f6a7b8c9d0e1_fixes9_system_settings_admin_areas.py`:

1. **`system_settings`** — global (non-tenant) key/value store, like
   `field_localization` / `email_templates`:
   `id` PK, `guid`, `key` (String(100), unique), `value` (Text), `updated_at`.
2. **`admin_areas`** — org-scoped entity (the spec lists only id/name/comments,
   but every tenant-visible table in this codebase carries `organization_id`):
   `id` PK, `guid`, `organization_id` FK→organizations (indexed), `name`
   String(150) NOT NULL, `comments` Text NULL, `created_at`.
3. **`contact_mekurav`** — add `admin_area_id` (Integer FK→admin_areas.id,
   nullable, indexed) and `tzedaka_potential` (Text, nullable — the spec said
   Integer, changed to free text per user request during implementation).

Matching model changes in `backend/app/models.py` (`SystemSetting`, `AdminArea`,
two columns + `admin_area` relationship on `ContactMekurav`).

## 1. System title dynamic configuration (spec §1)

* **Storage:** two `system_settings` rows, seeded by a new
  `seed_system_settings()` in `backend/app/seed.py` (insert-if-missing, called
  from `seed_all`):
  * `system_title_template` → `"{public.organizations.name} CRM"`
  * `system_fallback_org_name` → `"Jewish Points CRM"`
* **Public read** (title is needed on the login page, pre-auth):
  `GET /api/metadata/system-config` in `routers/metadata.py` →
  `{ "title_template": …, "fallback_name": … }`, falling back to the seed
  defaults if rows are missing (keeps tests / fresh DBs working un-seeded).
* **Superadmin write:** in `routers/admin.py` —
  `GET /api/admin/system-settings` + `PUT /api/admin/system-settings`
  (payload `{title_template?, fallback_name?}`, upsert, `require_superadmin`).
* **Frontend:**
  * `frontend/components/TitleManager.tsx` — client component mounted inside
    `Providers` (needs `useAuth`): fetches `/api/metadata/system-config` once,
    computes the title and applies it to `document.title`. With an org name the
    template is applied (placeholder → org name); with none, the fallback is
    used **as the whole title** — the seeded fallback "Jewish Points CRM"
    already ends in "CRM", so substituting it into the template would produce
    "Jewish Points CRM CRM". Reacts to login/logout via the auth context, so
    every page (login, signup, dashboard) gets the computed title.
  * `frontend/app/dashboard/layout.tsx` — remove the old
    `document.title = orgName` effect (TitleManager owns the title now).
  * `frontend/app/layout.tsx` — static SSR `metadata.title` becomes
    `"Jewish Points CRM"` (the pre-hydration default; TitleManager overrides).
  * `frontend/app/dashboard/admin/page.tsx` — new `SystemSettingsCard`
    (two inputs + save → PUT), rendered near `EmailTemplatesCard`.

## 2. Admin Area entity (spec §2)

* **Router** `backend/app/routers/admin_areas.py`, prefix `/api/admin-areas`,
  registered in `main.py`. Mirrors the areas router: reads for any
  authenticated org user, mutations `require_admin`, org-scoped 404s.
  * `GET ""` (list, ordered by name), `POST ""`, `GET/PUT/DELETE /{id}`.
  * **Delete semantics:** deleting an admin area NULLs
    `contact_mekurav.admin_area_id` on referencing rows first (same pattern as
    superadmin user delete), so contacts survive.
* **Schemas:** `AdminAreaCreate` (name required, comments optional),
  `AdminAreaUpdate`, `AdminAreaOut` (+id, guid).
* **Tenant cascade:** add `AdminArea` to `_delete_organization_cascade`'s
  `ordered_models` (after `ContactMekurav`, which references it).
* **Nav** (`frontend/app/dashboard/layout.tsx`): new entry in `placeItems`
  **immediately before Areas**: `/dashboard/admin-areas`, label
  `t("nav.admin_areas", "אזור מנהל")`, visible to all org users (same as Areas).
* **Page** `frontend/app/dashboard/admin-areas/page.tsx`: simple CRUD list —
  name + comments columns, add form (admins), inline edit, delete with confirm;
  same visual language as the other list pages.
* **`mekurav_contact` FK (spec §2C):**
  * `MekuravData` schema += `admin_area_id: Optional[int]`.
  * `routers/contacts.py` create + update paths validate the id belongs to the
    org (400 otherwise) — new `_validate_admin_area` helper.
  * `ContactForm.tsx` mekurav section: dropdown fed by `GET /api/admin-areas`,
    gated by `vis("contact_mekurav.admin_area_id")`.
  * `ContactView.tsx`: display row (admin area name).

## 3. `tzedaka_potential` (spec §3)

* `MekuravData` schema += `tzedaka_potential: Optional[str]` (free text).
* `ContactForm.tsx`: text input in the mekurav section, gated by
  `vis("contact_mekurav.tzedaka_potential")`; `ContactView.tsx` display row.
* `frontend/lib/types.ts`: extend `Mekurav` + `MekuravFormValues`.
* `field_registry.py`: register `contact_mekurav.admin_area_id` and
  `contact_mekurav.tzedaka_potential` as toggleable (visible by default).

## 4. Localization additions (seed, he/en — spec §4)

Append to `LOCALIZATION` in `seed.py`; all new UI strings render via `t()`:
`nav.admin_areas` (אזור מנהל / Admin area), `page.admin_areas_title`
(אזורי מנהל / Admin areas), `page.add_admin_area`, `page.edit_admin_area`,
`page.no_admin_areas`, `msg.delete_admin_area_confirm`,
`admin_areas.name` (שם / Name), `admin_areas.comments` (הערות / Comments),
`contact_mekurav.admin_area_id` (אזור מנהל / Admin area),
`contact_mekurav.tzedaka_potential` (פוטנציאל לצדקה / Tzedaka potential),
`admin.system_settings_title`, `admin.system_settings_intro`,
`admin.title_template`, `admin.title_template_hint`, `admin.fallback_name`.

## Tests (`backend/tests/test_fixes9.py`, pytest in Docker)

1. **System config:** public `GET /api/metadata/system-config` returns seeded
   defaults; superadmin `PUT` updates both fields and the public endpoint
   reflects them; org-admin `PUT` → 403.
2. **Admin areas CRUD:** admin create/list/get/update/delete; staff mutation →
   403; cross-org id → 404.
3. **Mekurav integration:** create contact with
   `mekurav.{admin_area_id, tzedaka_potential}` → detail echoes both; foreign /
   nonexistent `admin_area_id` → 400; update path too.
4. **Delete semantics:** deleting a referenced admin area NULLs the contact's
   `admin_area_id` (contact still readable).

## Execution order

1. Models + migration → run `alembic upgrade head` locally (Docker).
2. Schemas, admin-areas router, contacts validation, metadata/admin endpoints,
   seed (settings + localization), field registry.
3. Backend tests.
4. Frontend: types → TitleManager + layouts → admin page card → nav + admin-areas
   page → ContactForm/ContactView.
5. `tsc --noEmit`, page compiles, live smoke (title, CRUD, contact form).
