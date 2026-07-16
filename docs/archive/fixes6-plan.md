# fixes6 — plan: global search + "Digital twin" AI chat

Requested 2026-07-04:
1. A general search box that can find anything in the project: **area / building / apartment / contact (mekurav or shliach)**.
2. An **AI chat with a "Digital twin"** that can answer questions about the user's career, via **OpenRouter**, model **`openai/gpt-oss-120b:free`**, key `OPENROUTER_API_KEY` from the root `.env`.

---

## Feature A — Global search box

### Backend — `GET /api/search?q=<text>`
New router `backend/app/routers/search.py`, wired into `main.py`.

- **Auth:** any authenticated user; all queries org-scoped (`organization_id`).
- **Matching:** case-insensitive "contains" (`ilike %q%`), min 2 chars, up to 10 hits per entity type.
- **What is searched:**
  | Type | Columns | Subtitle shown |
  |---|---|---|
  | `contact` | name, last_name, phone, email | phone + type (מקורב/פעיל) |
  | `area` | area_name, area_notes | — |
  | `building` | building_name, building_address | area name |
  | `apartment` | apartment_name, apartment_notes | building name |
- **Role scoping:** `shliach` users only get results inside their coverage, reusing the
  same rules as the existing routers (areas via `_shliach_area_ids`, contacts via covered
  apartments, buildings/apartments inside covered areas). Admin/staff see everything in the org.
- **Response:** `{ "query": q, "results": [{ "type", "id", "title", "subtitle" }] }` —
  flat list with `type`; the frontend groups.

### Frontend
- New `frontend/components/GlobalSearch.tsx`:
  - Search input in the dashboard **header** (`app/dashboard/layout.tsx`), hidden for superadmin (no tenant data).
  - Debounced (~300 ms) call to `/api/search`; dropdown grouped by entity type with Hebrew/English group headers.
  - Each row links to the detail page: `/dashboard/areas/{id}`, `/dashboard/buildings/{id}`, `/dashboard/apartments/{id}`, `/dashboard/contacts/{id}`.
  - RTL-aware; closes on outside-click/Escape/navigation (same pattern as `NavMenu`).
- `lib/api.ts`: `globalSearch(q)` helper + result types.
- Seed localization keys (`search.placeholder`, `search.no_results`, `search.group.contacts` …) in `seed.py` so they're editable at `/dashboard/localization`.

### Tests — `backend/tests/test_search.py`
- Finds an area / building / apartment / contact by partial text.
- Tenant isolation (org B's data never returned to org A).
- 401 without a token; empty/1-char query returns nothing.

---

## Feature B — "Digital twin" AI chat (OpenRouter)

### Env / config
- **Root `.env`:** add `OPENROUTER_API_KEY=` — ⚠️ **the key is NOT in the file today**; a
  placeholder line is added and the user must paste the real key, then `docker compose up -d backend`.
- `docker-compose.yml`: pass `OPENROUTER_API_KEY` into the backend container.
- `backend/app/config.py`: `openrouter_api_key: str = ""`, `openrouter_model: str = "openai/gpt-oss-120b:free"`.
- **Render (prod):** set `OPENROUTER_API_KEY` on the dashboard (`.env` files are not deployed).

### Career profile ("digital twin" knowledge)
- `backend/career.md` — plain markdown file describing the user's career (CV, roles, skills,
  projects). Created with a fill-me-in template; the whole file is injected into the system
  prompt on every chat call, so editing it updates the twin without code changes.

### Backend — `POST /api/ai/chat`
New router `backend/app/routers/ai.py`.

- **Auth:** any authenticated user.
- **Body:** `{ "messages": [{ "role": "user"|"assistant", "content": "..." }] }` — the client
  sends the running conversation (capped server-side to the last 20 messages).
- Builds `[system prompt + career.md] + messages`, POSTs to
  `https://openrouter.ai/api/v1/chat/completions` (httpx, 60 s timeout) with
  `Authorization: Bearer <OPENROUTER_API_KEY>` and model `openai/gpt-oss-120b:free`.
- **Returns:** `{ "reply": "<assistant text>" }` (non-streaming V1).
- **Errors:** 503 + clear message when the key is missing; 502 when OpenRouter errors/times out.

### Frontend — `/dashboard/ai`
- New page `app/dashboard/ai/page.tsx`: chat bubbles (user vs. twin), input + send (Enter),
  "typing…" indicator while awaiting the reply, error toast on failure, history kept in
  component state (resets on reload — V1).
- Nav entry in the **"עוד" (More)** menu: `nav.ai_chat` — "צ'אט AI / Digital twin".
- `lib/api.ts`: `aiChat(messages)` helper.

### Tests — `backend/tests/test_ai_chat.py`
- 503 when no API key configured.
- Happy path with the OpenRouter HTTP call monkeypatched.
- 401 without a token.

---

## Order of work
1. ✅ This plan.
2. ✅ Backend search router + tests.
3. ✅ Backend AI router + config/env wiring + `career.md` + tests.
4. ✅ Frontend: `globalSearch`/`aiChat` in `lib/api.ts`, `GlobalSearch` component, header integration.
5. ✅ Frontend: `/dashboard/ai` chat page + nav entry.
6. ✅ Seed new localization keys.
7. ✅ Backend pytest in Docker (93 passed) + `tsc --noEmit` clean + endpoint/page smoke checks.
8. ✅ Logged in `docs/fixes5.md` → Done (2026-07-06).

**Status: implemented.** Outstanding user actions: paste `OPENROUTER_API_KEY` into root `.env`
(+ Render dashboard for prod) and fill in `backend/career.md`.

## Assumptions / open items
- **Career data:** nothing in the repo describes the user's career, so the twin starts from the
  `backend/career.md` template — the user should fill it in (Hebrew or English both fine).
- **OPENROUTER_API_KEY:** not found in root `.env` (nor `backend/.env`) at planning time —
  wiring is in place; user pastes the key.
- Search is substring-match V1 (no fuzzy/Hebrew-normalization); can be upgraded later if needed.
- AI chat is non-streaming V1; streaming (SSE) is a possible follow-up.
