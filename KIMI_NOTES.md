# Session handoff notes

_Read this first if you are a new Kimi session opened in this folder. Delete when no longer needed._

## Where you are

- Worktree: `C:\projects\minicrm-redesign`, branch `redesign`, based on `82e5611` ("new ai box", tip of `main` at setup time). All redesign work is UNCOMMITTED on this branch — the user makes their own commits; never commit/push/reset/stash on their behalf unless they explicitly ask.
- Original repo: `C:\projects\sheepsidebay_crm`, still on `main` — do not switch branches there. Its Docker stack (`sheepsidebay_crm-*`) serves the ORIGINAL light UI on port **3001** from that folder.
- **Redesign preview on :3002**: `docker compose -f docker-compose.redesign.yml up -d` (container `minicrm-redesign-frontend`, reuses the prebuilt `sheepsidebay_crm-frontend` image, shares the original backend at :8001). The redesign worktree is NOT served on 3001.
- **GREY-SCALE GLASSY REDESIGN — complete and verified (uncommitted).** Per user direction the theme is shades of grey (NOT near-black): token system in `frontend/app/globals.css` (light charcoal-grey `--background 220 9% 25%` with a stepped ladder of lighter grey card/popover/muted/sidebar surfaces, electric blue `--primary 199 89% 55%` accent, `.glass-card`/`.glass-header`/`.glow-primary` classes), subtle site-wide SVG dot-grid texture as a data-URI on body + decorative concentric-rings SVG on the login brand panel (position with `inset-0 m-auto`, NOT `start-1/2` + translate — RTL breaks that), emoji fallbacks replaced with lucide SVG icons (Building2). Fonts **Rubik** (UI) + **Karantina** (display, weights 300/400/700 only). `status.*` hexes and PDF colors intentionally untouched.
- Verify redesign work with `docker exec minicrm-redesign-frontend npx tsc --noEmit` — NOT the sheepsidebay container (that one type-checks the original repo's folder, same bind-mount trap as below).
- Do NOT run `next build` inside `frontend/` while a Docker dev server is running from the same bind-mounted folder — it corrupts the dev server's `.next` chunks and breaks the site.
- **Redesign is visually verified on :3002** (screenshots in `.redesign-shots/`): login, dashboard, contacts, street2 world + activist panel, route world (HE RTL) and dashboard + public org page `/org/demo-org` (EN LTR) all render correctly; i18n strings load.
- **Environment changes made for the preview**: (1) original repo's `backend/.env` `CORS_ORIGINS` gained `http://localhost:3002` (container was `--force-recreate`d — plain `restart` does NOT re-read env_file); (2) `npm install` was run once inside `minicrm-redesign-frontend` because the prebuilt image's node_modules predates `canvas-confetti`/`qrcode` (those 3 tsc "missing type" errors should now be gone — re-check).
- Do NOT run `next build` inside `frontend/` while a Docker dev server is running from the same bind-mounted folder — it corrupts the dev server's `.next` chunks and breaks the site.

## Recent work on main (context, not this branch's task)

- **fixes111 — AI helper chat popup** (frontend only, backend intentionally not wired):
  - `frontend/components/ai-helper/chatAdapter.ts` — single adapter. Production returns `{status:"not_connected"}`; dev-only mocks. Dev triggers: message containing `error` → error state, `insufficient` → insufficient_sources, `clarify` → clarify, `nosources` → answer without passages, anything else → answer + 3 mock passages. Wiring the real backend = one-file change here; response shape `{ status, reply?, passages?: [{filename, heading, score}] }`, statuses `answer` | `insufficient_sources` | `clarify`.
  - `frontend/components/ai-helper/AiHelperPanel.tsx` (panel; height is `max-h-[calc(100dvh-6rem)]` so it fits short windows — don't make it a fixed px height) and `AiHelperWidget.tsx` (floating button, mounted in `frontend/app/providers.tsx`).
  - Strings: all 12 `ai_helper.*` keys seeded in `backend/app/seed.py` `LOCALIZATION` (he+en); backend reseeds idempotently on restart. Frontend convention is `t("key", "hebrew fallback")` — table always wins over the fallback.
  - Verified in a real browser: EN LTR + HE RTL both render, all mock states visible.

## Conventions that matter

- i18n: hand-rolled `useLocalization()` in `frontend/lib/localization.tsx` (no library); `document.dir` flips globally. New UI strings must be added to `LOCALIZATION` in `backend/app/seed.py` with both languages.
- Requests: always via `apiFetch` in `frontend/lib/api.ts`; UI never calls fetch directly.
- Styling: Tailwind + shadcn-style tokens (`bg-popover`, `border-border`, brand `primary` blue); no dark mode; logical-position utilities (`end-4`, `ms-2`) for RTL.
- Specs live in `docs/fixes<N>.md`; each ends with a "Done when" checklist.
- Dev environment: Docker (`docker compose up -d`), frontend at http://localhost:3001, backend at :8001; local dev login `admin` / `admin123` (was reset in the dev DB after the recorded passwords stopped working).
