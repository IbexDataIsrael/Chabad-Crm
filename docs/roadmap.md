# Roadmap — deferred changes

Things intentionally paused during the launch push (2026-07-01). Each entry notes
**why** it's off and **how** to turn it back on. None of these are bugs — they are
conscious "not now" decisions.

## 1. Re-enable email verification on signup  ⏸️ PAUSED (must return)

Right now signup is "old school": username + password, the org admin is created
**active + verified immediately**, and no verification email is sent
(`REQUIRE_EMAIL_VERIFICATION=false`, default in `backend/app/config.py`).

This is **temporary**. A verification email *should* be sent — it was paused only
because Gmail silently drops the verification mail when it's sent from a personal
`gmail.com` sender (plain "welcome" mail arrives; link-bearing "verify" mail gets
dropped/spam-filed). The whole verify-by-email flow is still in the code behind the
flag (`/api/auth/verify-email`, `/api/auth/resend-verification`, `hello_tenant.html`,
`_send_verification_safely`).

**To re-enable (do this once a real sending domain exists):**
1. Set up a transactional-email provider on a real domain (Resend / Mailgun /
   SendGrid) with SPF + DKIM + DMARC. Point the `SMTP_*` env vars on Render at it,
   and set `EMAIL_FROM` to `no-reply@yourdomain`.
2. Set `REQUIRE_EMAIL_VERIFICATION=true` on Render.
3. Signup then reverts to: create pending admin → email verify link → activate on
   click. No code change needed.

## 2. Re-add "Log in / sign up with Google"  ⏸️ PAUSED

The Google Sign-In button was removed from the login (`app/page.tsx`) and signup
(`app/signup/page.tsx`) pages because it depends on a third-party Google widget we
couldn't fully control during launch. The `GoogleSignInButton` component and the
backend endpoints (`/api/auth/google`, `/api/auth/google-signup`) are **kept** — only
the button usage was removed.

**To re-enable:** re-import `GoogleSignInButton` on those two pages (git history has
the exact markup). Requires the Google OAuth consent screen to be **published** (not
"Testing") and `https://minicrm-ibexdata.vercel.app` in Authorized JavaScript origins
(see `docs/deployment.md`), plus matching `GOOGLE_CLIENT_ID` on Render and
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` on Vercel.

## 3. Change-password option in settings  ✅ DONE (2026-07-01)

Self-service "change password" form on `/dashboard/settings`. Backend
`POST /api/auth/change-password` (auth required) verifies the current password,
enforces the strength rules, and sets the new bcrypt hash. The settings page now
renders for all users (org-settings form stays admin-only; the change-password card
shows for everyone), and the settings nav link is visible to non-admins.

## 4. fixes8 — floors default, apartment sort + pagination, login deep-links  ✅ DONE (2026-07-07)

Spec `docs/fixes8.md`, plan `docs/fixes8-plan.md`, commit `db8f10f`; tested live.
New buildings auto-create floors 1–8 unless overridden. `GET /api/apartments/list`
returns a paginated envelope `{items,total,page,page_size}` (20/50/100 per page)
with `area_id`/`apartment_id` filters and natural-order sorting (floor →
apartment number). The apartments and buildings pages land pre-filtered on the
first area and fetch lazily per filter change. Unauthenticated deep links bounce
to `/?redirect=…` and return to the original page after login (internal paths
only). Note for external consumers of `/api/apartments/list`: the response is no
longer a bare array — read `.items`.
