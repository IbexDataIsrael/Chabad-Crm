# Security & Deployment Vulnerability Report

**Status: all 6 items fixed, live-verified against a local Docker build (not committed/pushed — awaiting go-ahead).**

---

### 1. Critical: Public Admin Registration is Live — FIXED
* **File:** `backend/app/routers/auth.py:215-238`
* **Description:** Unauthenticated users can create an active organization and admin account.
* **Fix:** `POST /api/auth/register` now 404s unless `settings.enable_legacy_register` is explicitly on (new flag, default `False`, mirrors the existing `enable_diagnostics` pattern). It stays enabled in `backend/.env` (local dev + the puppeteer/headless-drive recipe in [[fixes29-progress]]) and in `tests/conftest.py` (new autouse fixture — the whole suite's `auth_headers`/`admin_headers` fixtures depend on it), but is never set in `.env.production`/Render, so it 404s in production. Verified live: `curl -X POST /api/auth/register -d '{"role":"admin",...}'` → 201 locally (flag on), and the code path is unconditionally gated when the flag is off.

---

### 2. High: Disabled Accounts Keep Access for 30 Days — FIXED
* **File:** `backend/app/deps.py:14-35`
* **Description:** The active-user check is missing, and minicrm tokens last 43,200 minutes. Tag's window was 8 hours.
* **Fix:** `get_current_user` now rejects the request (401) if `user.is_active` is false or the user's org is inactive — re-checked on every request, not just at login. Also dropped `access_token_expire_minutes` default 43200→480 (8h, matching Tag Print CRM) in `config.py` + all three `backend/.env*` files. Live-verified: created a user, confirmed `/api/auth/me` → 200, admin disabled the account via `PUT /api/users/{id}`, same still-unexpired token → `/api/auth/me` now 401.
* **⚠️ Action needed from you:** Render's dashboard env var `ACCESS_TOKEN_EXPIRE_MINUTES` (if set there — not documented in memory) should be updated to `480` too; I can't reach the Render dashboard from here.

---

### 3. High: Unsafe Production Defaults — FIXED
* **File:** `backend/app/config.py`
* **Description:** `SECRET_KEY` defaults to `"change-me"`; demo seeding defaults on with `admin/admin123`.
* **Fix:** Both `secret_key` and `seed_demo_data` now have **no default** — the app refuses to start (pydantic `ValidationError`) unless every environment sets them explicitly. Confirmed safe: Render already sets both explicitly (per [[prod-deploy-env-and-email]]: `SECRET_KEY`, `SEED_DEMO_DATA=false`), and all of `backend/.env`, `.env.example`, `.env.production` already declared both. Full local Docker rebuild + `docker-compose up` confirmed the app still boots.

---

### 4. High: SVG Upload Creates XSS and Open File Hosting Risk — FIXED
* **File:** `backend/app/routers/uploads.py`
* **Description:** Public endpoints can upload 5MB SVGs that are then served from the API origin.
* **Fix:** Removed `image/svg+xml` from the shared allow-list (`_IMAGE_EXTENSIONS`) used by both `/logo` (public) and `/announcement-image` (admin-only) — PNG/JPEG/GIF/WEBP still accepted. Also added an `X-Content-Type-Options: nosniff` header on everything served from `/uploads/*` as defense-in-depth. Live-verified: uploading an SVG with an inline `onload` handler → 400 "File must be an image".

---

### 5. Deploy Risk: Production Docker Uses `--reload` and Hardcodes Port 8000 — FIXED
* **File:** `backend/Dockerfile:19`
* **Description:** It also runs migrations and seeding before serving traffic.
* **Fix:** Dockerfile's `CMD` no longer runs `--reload` (uvicorn docs explicitly call this unsafe/wasteful in production) and binds `${PORT:-8000}` instead of a hardcoded port, so it adapts if a host injects `$PORT`. `docker-compose.yml` now adds its own `command:` override restoring `--reload` for local dev (the bind-mounted `./backend:/app` volume still hot-reloads). Live-verified: full `docker compose up --build backend` boots, `/api/health` and `/docs` both 200.
* **Not changed (flagging, not silently dropping):** migrations + seeding still run inside the app's own `lifespan()` before it accepts traffic. That's the *correct* pattern for a single-instance deploy (never serve on a stale schema) — the real risk is only if Render ever runs 2+ instances of this service, where both would race `alembic upgrade head` concurrently. I didn't add a migration lock/separate release-phase step because I have no visibility into Render's actual scaling config and don't want to guess at infra I can't verify — flag this if you ever move to multiple instances.

---

### 6. MiniCRM-Specific: Campaign Managers Can Bypass Contact Restrictions Through Global Search — FIXED
* **File:** `backend/app/routers/search.py:25-66`
* **Description:** This exposes contact names and phone numbers despite the role being blocked from contact pages.
* **Fix:** `global_search` now skips the contacts query entirely when `current_user.role == "campaign_manager"` (areas/buildings/apartments results are untouched — those are within a campaign manager's remit). Live-verified: created a contact "SecretPerson", confirmed a campaign_manager gets 403 from `/api/contacts/list` (pre-existing) AND now gets `results: []` from `/api/search?q=SecretPerson` (was previously leaking name+phone); an admin's search for the same term still returns the hit.

---

### Bonus finding (not in the original list): real secret committed to git
`backend/.env.example` (tracked, pushed to `github.com/IbexDataIsrael/minicrm`) had a **real Gmail App Password** in `SMTP_PASSWORD` instead of a placeholder — present since the initial commit (`04ceff7`), still in git history. Replaced with a placeholder in the working tree. GitHub's unauthenticated API returned 404 for this repo (consistent with it being private), but a credential committed to history should still be treated as compromised.
**⚠️ Action needed from you:** rotate this Gmail App Password (Google Account → Security → App Passwords) and update `SMTP_PASSWORD` on Render. I did not rewrite git history — that's a separate, destructive operation I won't do without you explicitly asking for it.
