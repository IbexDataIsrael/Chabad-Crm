# fixes5 — bugs & fixes log

Living backlog. Add new items under **Open** as: page/URL, what's wrong → what you expect (priority optional).
Claude works the Open list top-to-bottom and moves items to **Done** with a one-line note.

---

## How to add a bug
```md
- [ ] **<Area/Page>**: <URL> — <what's wrong> → <what you expect>  (P1)
```
Just give the URL, what's wrong, and what you expect. Screenshots/notes welcome inline.

---

## Open

- [ ] **Production env vars** — set on each host's dashboard (`.env` files are NOT deployed). Topology: **frontend = Vercel (client)**, **backend = Render (API, minicrm-3xtt.onrender.com)**.
  - **Vercel (frontend)**: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=<browser key …XY3WW0>` and `NEXT_PUBLIC_API_URL=<Render backend URL>` (build-time inlined).
  - **Render (backend)**: `GEOCODING_API_KEY=<server key …oepb0>`, `CORS_ORIGINS=<your Vercel frontend URL>` (the *client* origin — NOT the Render URL itself).
  - Browser Maps key referrer allowlist must include your **Vercel** frontend URL `https://<...>.vercel.app/*` (and any custom domain).
- [ ] **Error-messages localization** — user to provide an MD of all user-facing messages (good/bad) to wire into the `error.*` section of `/dashboard/localization` (toast/inline). First one already seeded: `error.no_areas_for_shliach`.
- [ ] **Commit decision** — everything below is in the working tree, uncommitted, pending review.

_(add new bugs here)_

---

## Done (this session — 2026-06-29/30)

### Areas / polygon map
- [x] **AreaPolygonMap** — restored the original from git (`git checkout HEAD -- frontend/components/AreaPolygonMap.tsx`). It always had the "התחל ציור" start button, "סיום"/"ביטול", "צייר תחום מחדש"/"נקה תחום", existing-polygon render + draggable vertices. A mistaken rewrite was reverted.
- [x] **Maps not rendering** — root cause was external, not code: Google **billing disabled** → APIs not activated → key **referrer restriction missing `/*`** → local **DNS** (`ERR_NAME_NOT_RESOLVED`). All resolved. New browser key + separate unrestricted `GEOCODING_API_KEY` wired in root `.env`. Confirmed working on `/areas/2/edit` and `/areas/add`.
- [x] **Area detail page** — new `/dashboard/areas/{id}` shows area data (notes, boundary status, building count, members), buildings in the area, and **members (פעילים) with each name linking to their contact page**. Map at the bottom, degrades gracefully. List: area name + "הצג אזור »" link to it. Removed the old map-coupled inline toggle.
- [x] **Shliach sees only their own areas** — `routers/areas.py` `list_areas`/`get_area` filter by covered areas for `role=="shliach"`; admin/staff see all. Test `test_shliach_sees_only_covered_areas`.

### Buildings / apartments
- [x] **Buildings list shows coords** — `📍 lat, lng` (5dp) per row when present.
- [x] **Buildings → apartments CRUD** — each building row expands ("הצג דירות") to view/add/edit/delete its apartments inline, with toasts. Reuses existing `/api/apartments` endpoints.
- [x] **Apartment detail page** — new `/dashboard/apartments/{id}` shows apartment data (building, area, address, notes) + **linked contact name as a link** to the contact page. List: apartment name links to it.
- [x] **Building detail page** — new `/dashboard/buildings/{id}` shows building data (area→linked, address, coords) + its apartments (each name links to apartment detail). List: building name links to it. CRUD parity with areas/apartments now complete.

### UI components
- [x] **DatePicker — easy year change** — added month + year `<select>` dropdowns in the calendar header (year range: now+5 down to 1920, type-ahead). No more paging 12×/year. Applies everywhere the picker is used; no new dependency.
- [x] **DatePicker — today highlighted** — today's cell gets a magenta ring + bold so it's the obvious default to pick (does NOT force-fill empty fields, since the picker is also used for birthdays).

### Signup / auth
- [x] **Signup method chooser (either/or)** — `/signup` first offers **Email+Password** OR **Google**, not both at once. Each path has a "← חזרה" back to the chooser.
- [x] **Google = login-first, then org details** — picking Google authenticates first (captures the credential), then a step-2 form collects org name + logo and creates the org (`google-signup`). No email round-trip.
- [x] **Organization logo** — new `organizations.logo_url` column (Alembic `a1b2c3d4e5f6`), threaded through `OrganizationOut/Update`, `SignupRequest`, `GoogleSignupRequest`, and both auth endpoints. Frontend `LogoUpload` component uploads to **Cloudinary (signed)**; falls back to URL-paste when not configured. Switched from the unsigned-preset flow to a **signed** flow: the browser fetches a signature from `GET /api/uploads/cloudinary-signature` (public — used during signup, before auth), then POSTs the file directly to Cloudinary. The **API secret stays in `backend/.env`** (`CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`, optional `CLOUDINARY_UPLOAD_FOLDER`, default `org_logos`). Frontend only needs the public `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` (gates the UI). No upload preset.

### Infra
- [x] **CORS** — `backend/.env` `CORS_ORIGINS=http://localhost:3001,https://minicrm-lgkmh15es-ibexdata.vercel.app`. Frontend = Vercel (client) → so the Vercel URL is the CORS origin; removed the Render URL (that's the backend/API, not a client). Both preflights verified. NOTE: Vercel preview URL hash changes per deploy → must update on each deploy (user chose exact URLs over a `*.vercel.app` wildcard).
- [x] **Maps keys** — browser key (referrer-restricted) + server geocoding key (unrestricted) split in root `.env`.

> Earlier sessions (see other docs/memory): Postgres migration (Neon prod), bilingual UI, picklists/localization engine, field visibility, toasts, map point picker, שליח→פעיל rename, new-shliach rework, phone validation, shliach name sync.
