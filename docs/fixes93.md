# fixes93 — localization: everything in the table; translations page off by default

Requested 2026-10-01.

## 1. "Everything has to go to the localization table"

- [x] Audit script: every `t("key", fallback)` in the frontend vs. the seed's
      `LOCALIZATION` rows. Files touched this session: 16 keys were only
      fallbacks → added (2 of them built the org name into the text with
      `${org.name}` — switched to a `{name}` placeholder so a translation
      keeps it). Whole frontend: 15 more → added. **Now 0 missing.**
- [x] New strings of this round are in the table too.

## 2. The translations page (/dashboard/localization) hidden by default

- [x] New per-org switch `localization_page_enabled` in `organization_prefs`
      — the only feature switch that defaults **OFF**.
- [x] Superadmin → org → "תכונות": checkbox "עמוד תרגומים (לוקליזציה)".
- [x] Off: "תרגומים" is not in the org admin's menu, and opening the URL shows
      "עמוד התרגומים אינו פעיל בארגון זה…". On: menu item + page as before.
- Test `test_localization_page_off_by_default_superadmin_can_enable`;
  22 passed (superadmin + fixes54). Live-verified both states for org 1
  (left OFF afterwards).

## 3. Why so few error / alert messages appear on the translations page

Findings:
- The page lists only rows in the localization table. Its "error" group is
  one category; error-like texts also live under `msg`, `auth`, `admin`,
  `users`, etc. (1,365 rows in ~40 categories).
- The frontend is now fully covered (0 missing keys).
- **The real gap is the backend:** about 179 places raise an error with a
  plain text message (68 distinct one-line messages counted, plus multi-line
  ones not counted yet; mostly English, some Hebrew; some include values). The frontend shows that text as-is (`err.message`, 97 places).
  These never pass through the table, so they can't be seen or translated
  there. Only the login errors (fixes75) use translation codes.

Proposal — **implemented in fixes94** (see docs/fixes94.md):
- One central change in the frontend's error handling: a backend error
  message is looked up in the localization table (category `error`, key
  derived from the message) before it's shown — all 97 places get it at once.
- Seed one row per backend message (Hebrew + English), so every error shows
  on the translations page and can be edited there.
- Messages that include values get a `{placeholder}` form.

Not committed.
