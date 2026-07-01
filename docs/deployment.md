# Deployment — production environment variables

Topology: **frontend = Vercel**, **backend = Render**, **database = Neon (Postgres)**.

`.env` files are **local only** — they are never deployed. Each host reads config
from env vars you set in *its* dashboard. Set the values below (real secret
values are not stored in this repo — pull them from your local `backend/.env` /
`.env`, or the service that issued them).

Legend: 🔒 = secret (never commit / never put in the frontend) · ✅ = safe/public.

---

## Render — backend (FastAPI)

Render → your service → **Environment**. Backend reads these via `app/config.py`
(pydantic `Settings`). Changing them triggers a redeploy.

| Var | Value / source | Notes |
|---|---|---|
| `DATABASE_URL` 🔒 | your Neon pooled connection string | the DB. Without it, Render falls back to throwaway SQLite. |
| `SECRET_KEY` 🔒 | a long random string | JWT signing. Do **not** ship the default. |
| `FRONTEND_URL` ✅ | `https://minicrm-ibexdata.vercel.app` | used to build email verification links. Missing → links point to `localhost`. |
| `SEED_DEMO_DATA` ✅ | `false` | keeps `admin/admin123` + fake contacts out of prod. |
| `CORS_ORIGINS` ✅ | your custom domain(s), comma-separated | optional — `*.vercel.app` is already allowed by regex in code. |
| `ALGORITHM` ✅ | `HS256` | default is fine; only set to override. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` ✅ | `480` | default is fine. |

### Email (verification / welcome mails)
| Var | Value / source |
|---|---|
| `SMTP_HOST` ✅ | `smtp.gmail.com` |
| `SMTP_PORT` ✅ | `587` |
| `SMTP_USER` ✅ | the sending Gmail address |
| `SMTP_PASSWORD` 🔒 | Gmail **App Password** (16 chars, needs 2FA on) |
| `EMAIL_FROM` ✅ | the sending Gmail address |

> If `SMTP_HOST` is empty, the backend logs the email instead of sending it
> (`===== [DEV EMAIL — not actually sent] =====`).

### Google (Sign-In + server-side geocoding)
| Var | Value / source | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` ✅ | OAuth 2.0 Web client id | must match the frontend's `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. |
| `GOOGLE_CLIENT_SECRET` 🔒 | OAuth client secret | backend only. |
| `GEOCODING_API_KEY` 🔒 | server Maps key (no referrer restriction) | fills lat/lng from an address on save. |

### Cloudinary (org logo signed upload)
| Var | Value / source | Notes |
|---|---|---|
| `CLOUDINARY_CLOUD_NAME` ✅ | your cloud name | also set on the frontend. |
| `CLOUDINARY_API_KEY` ✅ | your API key | |
| `CLOUDINARY_API_SECRET` 🔒 | your API secret | backend only — this is what makes the upload "signed". |
| `CLOUDINARY_UPLOAD_FOLDER` ✅ | `org_logos` | optional. |

---

## Vercel — frontend (Next.js)

Vercel → project → **Settings → Environment Variables**. These are `NEXT_PUBLIC_*`
and are **baked in at build time** — after changing one you must **Redeploy**.

| Var | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` ✅ | `https://minicrm-3xtt.onrender.com` | the backend base URL. No trailing slash. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` ✅ | your browser Maps key | referrer-restricted to the Vercel domain. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` ✅ | OAuth Web client id | same value as backend `GOOGLE_CLIENT_ID`. |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` ✅ | your cloud name | gates the logo upload UI. |

---

## External console setup (not env vars)
- **Google Cloud → your browser Maps key** → Website restrictions → add
  `https://minicrm-ibexdata.vercel.app/*`; enable Maps JavaScript API, Places
  API, Geocoding API; billing on.
- **Google Cloud → OAuth Web client** → Authorized JavaScript origins → add
  `https://minicrm-ibexdata.vercel.app`.
