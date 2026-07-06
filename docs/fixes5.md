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

- [ ] **AI chat — prod key** — `OPENROUTER_API_KEY` is now in the local root `.env` (added by the user 2026-07-06) and the backend authenticates fine. For production, set the same var on the **Render** dashboard. Note: the `:free` model pool can return upstream 429s at busy times — the UI surfaces it as a retryable error.
- [ ] **AI chat — career profile** — fill in `backend/career.md` (the digital twin's knowledge base; currently a template). Edits apply immediately, no restart.

_(add new bugs here)_

---

## Done (2026-07-06 — fixes6: global search + digital-twin AI chat; plan in fixes6-plan.md)

- [x] **Global search box** — header search that finds anything in the org: `GET /api/search?q=` (new `routers/search.py`) matches areas (name/notes), buildings (name/address), apartments (name/notes) and contacts (first/last name, phone, email — מקורב & פעיל), case-insensitive, ≤10 per type, org-scoped; shliach users only get results inside their coverage. New `GlobalSearch.tsx` in the dashboard header (hidden for superadmin): debounced dropdown grouped by type, rows link to each detail page, contact rows show a מקורב/פעיל badge, subtitles give context (building→area, apartment→building, contact→phone). 7 tests in `test_search.py`.
- [x] **Digital-twin AI chat** — new `/dashboard/ai` chat page (bubbles, Enter-to-send, "חושב…" indicator, failed sends roll back into the input) + nav entry under "עוד". Backend `POST /api/ai/chat` (new `routers/ai.py`) calls **OpenRouter** model **`openai/gpt-oss-120b:free`** via httpx; system prompt = digital-twin persona + the whole of `backend/career.md` (re-read per request). 503 when the key is missing, 502 on upstream errors, history capped at 20 messages. Env: `OPENROUTER_API_KEY` root `.env` → docker-compose → `config.py`. 6 tests in `test_ai_chat.py`.
- [x] **Localization** — 15 new seeded keys (`search.*`, `ai.*`, `nav.ai_chat`), editable at `/dashboard/localization`; verified Hebrew intact via API.
- [x] **Verified** — full backend suite green in Docker (**93 passed**, incl. 13 new); `tsc --noEmit` clean; smoke-checked live: search returns areas/apartments/contacts from seeded data; `/dashboard/ai` + `/dashboard` render 200; and after the user added the key, a **real end-to-end completion** came back from `openai/gpt-oss-120b:free` via OpenRouter (the free pool 429s when saturated — retry succeeds; the UI shows a retryable error toast).

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

lea