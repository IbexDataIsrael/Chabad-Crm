Work in small commits, don't change unrelated behavior, don't push - stop for my review.

BUG 1 - Activist name edit doesn't stick
Editing an activist's name doesn't change the display (still "test cohen"); editing email works instantly. Cause: activist and user are two separate entities - the form writes the name to one, the page reads it from the other. Fix: align read and write to the same entity/field, or join correctly.

BUG 2 - Page titles and link previews carry wrong branding
Sharing an apartment link in WhatsApp shows "jewish points CRM". Fix: every page's <title> includes the organization name; set og:title (org name), og:image (org logo) and Twitter meta tags so previews show org name + logo.

BUG 3 - Logout redirect
After logout, redirect to the organization page (e.g. /org/sb). Org-scoped from the user's context, not hardcoded.

YAAKOV'S LIST - ADMIN ROLE
1. Users: when a user's email is changed, send the welcome email to the new address.
2. Menu: don't show the "street" page in the admin menu.
3. Task sheet print (דף משימה PDF, the paper route for activists without smartphones):
a. Data columns (שם דייר, מצב יהדות, מזוזה, שפה, הערות) print empty even where data exists - print all data in the boxes.
b. Column header once per page; today it repeats once per building section (5x on one page in the sample).
c. Let the user choose which fields to print (like /dashboard/reports/create).
d. Let the user order the fields (same).
e. Let the user set field widths (same).
4. /dashboard/reports/create:
a. When printing by report number, add the area name in Hebrew under it: "אזור {name}".
b. Header once per page (same repetition bug as 3b).

YAAKOV'S LIST - ACTIVIST ROLE (/dashboard/street)
a. The apartment record must show every field flagged "visible". Reference, the admin apartment page shows: בניין, מספר דוח, מבצע חנוכה, יהדות חנוכה, קומה, מספר דירה, שם דייר, טלפון, אימייל, יהדות, מזוזה, שפה, הערות, הערות חדשות, הערות מזוזה, כתובת בניין + היסטוריית שינויים and איש קשר sections.
b. On the single-apartment display, show the Judaism status instead of the tenant name.

---

## Closeout (2026-09-28)

Worked in small commits per file/item as instructed above; nothing pushed —
everything below is local on `main`, waiting for review.

- [x] BUG 1 (activist name edit) — commit `f0ac265`. Root cause: `PUT
      /api/users/{id}` updated `User.full_name` + versioned
      `ContactShliach.full_name` but never `Contact.name`/`last_name`, which
      is what `GET /api/auth/me`'s `display_name` (the header/greeting) is
      actually resolved from. Regression test added
      (`test_fixes46.py::test_full_name_edit_updates_the_contact_and_login_display_name`).
- [x] BUG 2 (WhatsApp/social preview branding) — commit `a1d8411`. Scoped to
      `/org/[slug]` and `/tasks/claim/[token]` (the only genuinely public,
      unauthenticated routes) with real server-side `generateMetadata()`
      (org name + logo in `og:`/`twitter:` tags) — a raw
      `/dashboard/apartments/{id}` link stays generic since a crawler has no
      session to resolve an org from without a new public API surface
      (explicitly out of scope per your answer). Verified live via curl
      against the rendered HTML.
- [x] BUG 3 (logout redirect) — commit `7b83cd6`. Redirects to the session's
      own `/org/{slug}` instead of `/`; falls back to `/` when there's no
      org slug. Verified live (Playwright): sign out from org
      "sheepshead-bay" landed on `/org/sheepshead-bay`.
- [x] Admin §1 (welcome email on email change) — commit `1807ba4`. Regression
      test added.
- [x] Admin §2 (hide street from admin menu) — commit `69eb968`. Verified
      live: an admin's sidebar now shows only "ניהול דירות".
- [x] Admin §3a/§3b (task sheet: real data + header once/page) — commit
      `748630f`. §3a needed a new `TaskPrintApartment.jewish_status` /
      `mezuzah_status` / `language` / `apartment_notes` on the backend (bulk
      picklist lookup). §3b: one continuous `autoTable()` per sheet instead
      of one per building. 2 new backend tests; live-verified via a
      rendered/rasterized PDF.
- [x] Admin §3c/§3d/§3e (choose/reorder/width panel) — commit `dba5508`. New
      `lib/taskSheetFields.ts` + `TaskSheetFieldsModal`, a fresh panel (not
      shared with reports/create's own, per your answer). Real bug caught
      and fixed live: the modal and the print button each held independent
      `usePersistentState`, so an edit never reached an already-mounted
      print button without a full reload — fixed with a
      `useSyncExternalStore`-backed shared store. Live-verified via a
      rasterized PDF showing the toggled/reordered/resized result.
- [x] Admin §4a/§4b (report area label + header once/page) — commit
      `b72da62`. §4a reuses the existing `GET /api/report-numbers/areas`
      endpoint. §4b: same one-continuous-table fix as §3b, ported to
      `reports/create`'s `renderBuildingTables` (subheading rows, custom
      picklist columns, narrow-column font-shrink, and per-building compact
      sizing all preserved). Live-verified via a rasterized PDF (2
      buildings, 1 header row, area line present).
- [x] Activist §a (street page shows every visible field) — commit
      `3c74c0a`. The existing "Extra fields" dump showed raw technical
      keys/values with no visibility gate; now resolves real labels and
      values and respects `useFieldSettings()`, matching the admin
      apartment page. Added a read-only, admin-gated edit-history list
      (building address + contact link were already present). Live-verified
      against a disposable test org.
- [x] Activist §b (Jewish status instead of tenant name on doors) — commit
      `3c74c0a`. Live-verified.

### Bonus findings surfaced along the way (not fixed — flagging for a
    separate round)

1. **Local dev DB drift** (fixed while chasing an unrelated hang during BUG 2
   verification): local Postgres had the fixes68 migration's DDL/data
   already applied, but `alembic_version` was stamped back to the prior
   revision by an earlier workaround — every backend `--reload` was
   re-attempting (and failing) that same upgrade. Re-stamped to
   `cfead2898e35` (bookkeeping only; confirmed the backfill was already
   present in all 95 local orgs first). Included in commit `a1d8411`.
2. **`/dashboard/street`'s `load()` fetches every page up front** — on org
   1's real ~25798-apartment table that's ~258 sequential
   `page_size=100` requests before the page renders anything at all
   (confirmed: a single page takes ~0.67s, so the full load is minutes).
   Not fixed — a real, separate performance project (virtualized/
   incremental loading), flagged in the Activist §a commit message too.
3. Local dev environment note: running `next build` on the host while the
   Docker `next dev` container is running corrupts the shared, bind-mounted
   `.next` folder (known gotcha, re-triggered this session) — recovered by
   deleting `frontend/.next` and restarting the frontend container. Avoided
   after that; used `tsc --noEmit` for type-checking instead.
