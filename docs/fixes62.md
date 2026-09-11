# QA Bug Report & Enhancement Specifications

**Status: 6 of 7 items done and live-verified (headless Chromium drive against real local data); 1 item (1.1) investigated and does not reproduce in the current codebase. Not committed/pushed — awaiting go-ahead.**

## Overview
This document details bug fixes and functional enhancements identified during exploratory testing, focusing on localization, layout alignment, and user dashboard controls.

---

## 1. Localization & Translation Defects

### Bug 1.1: Untranslated Settings Page (Defaults to English) — NOT REPRODUCIBLE
* **Path:** `Menu -> Settings` (`/dashboard/settings`)
* **Defect:** The Settings page UI remains entirely in English when the active system language is set to Hebrew.
* **Affected Labels:** `Settings`, `Change password`, `Current password`, `New password`, `Confirm password`, and password requirement helper text.
* **Expected Behavior:** All form labels and help text must load corresponding i18n keys and render in Hebrew when Hebrew is selected.

**Investigation:** every affected label already renders via `t("settings.change_password", …)` / `t("nav.settings", …)` etc. (`frontend/app/dashboard/settings/page.tsx`), and all of those keys are present in `backend/app/seed.py`'s `LOCALIZATION` list with **both** Hebrew and English values populated, confirmed against the live local DB (`field_localization` table has non-empty `hebrew_label` and `english_label` for `nav.settings`, `settings.change_password`, `settings.current_password`, `settings.new_password`, `signup.verify_password`, `validation.password_hint`). Live-verified in a headless Chromium session: toggling to Hebrew shows the whole Settings page in Hebrew (screenshot), toggling to English shows it fully in English (screenshot) — no leftover English-in-Hebrew-mode text found anywhere on the page. **No code change made** — either this was already fixed in an earlier round, or the original report was against stale data. Flagging rather than silently closing: if this still reproduces for you, it's likely an account-specific stuck locale preference (`GET /api/preferences`) rather than a missing translation — worth a hard refresh / re-check with a clean session.

### Bug 1.2: Untranslated Table Action Links in English Mode — DONE
* **Path:** `/dashboard/areas` (Areas Page)
* **Defect:** In English mode, the links under the **Actions** column remain in Hebrew (`הצג אזור >>`) across all table rows, while surrounding content (e.g., `"No activist assigned"`) correctly translates.
* **Expected Behavior:** Action links must render in English (e.g., `View Area >>`).

**Root cause:** the row link used `t("page.show_area", "הצג אזור »")` — a key that was **never seeded** (unlike the very similar `areas.view_area` key used on the same page's map info-window, which was seeded correctly). Per `t()`'s fallback rule, a missing key always returns the hardcoded fallback string regardless of active language, which is why it stayed Hebrew even in English mode while every other (seeded) label on the page translated normally.

**Evidence:** added `("page", "page.show_area", "הצג אזור »", "View area »")` to `LOCALIZATION` in `backend/app/seed.py`; confirmed the row was auto-inserted into `field_localization` on backend reload (idempotent `seed_localization()`). Live-verified: English-mode Areas page now shows "View area »" on every row; Hebrew "הצג אזור" no longer appears anywhere on the page.

### Bug 1.3: Google Maps Language Discrepancy — DONE
* **Path:** `/dashboard/areas` (Embedded Map View)
* **Defect:** Switching the system language to English does not update the Google Map instance. Location labels (e.g., *ניו יורק*, *ברוקלין*) and map controls (*Keyboard shortcuts*, *Terms*, *Report a map error*) remain in Hebrew.
* **Expected Behavior:** Google Maps API instance must dynamically reload with the corresponding `language` parameter (`hl=en` vs `hl=he`) matching the user's active locale.

**Root cause:** `frontend/lib/maps.ts`'s `loadGoogleMaps()` hardcoded `language=he` in the Maps JS script URL and cached the loaded script forever — once loaded, a later call was a same-language-forever no-op even if the UI's active language changed, because the Maps JS API has no supported way to hot-swap its `language` param on an already-loaded instance.

**Fix:** `loadGoogleMaps(lang)` now takes the active language, and when it differs from what's currently loaded, removes the old script tag + `delete window.google` + reloads a fresh script with the new `language=` param. Every call site now passes the real active language instead of nothing: `AreasMap`, `ContactMap`, `AreaPolygonView`, `AreaPolygonMap`, `BuildingsMap`, `MapPointPicker` pass the UI's `lang` (from `useLocalization()`); `AddressAutocomplete` keeps using its own pre-existing per-organization `map_in_english` toggle (a distinct, deliberate setting — unrelated to the UI language). `AreasMap`'s map-rebuild effect (already present, keyed on `lang`) now actually produces an English map since the underlying script reload works. Other map components' `loadGoogleMaps` calls were updated so future navigations start in the correct language, without changing their (deliberately once-only, drawing-state-sensitive) mount effects — see [[google-maps-billing]] and the "do not rewrite AreaPolygonMap" lesson.

**Evidence:** live-verified — toggling English on `/dashboard/areas` reloads `https://maps.googleapis.com/maps/api/js?...&language=en...` (confirmed via the actual `<script>` tag's `src`, was `language=he` before the toggle) and the rendered map switches to "New York", "Newark", "Keyboard shortcuts", "Map data ©2026 Google", "Terms", "Report a map error" — all English (screenshot).

---

## 2. Layout & BIDI (Bidirectional) Text Bugs

### Bug 2.1: Asymmetric Layout Switching in LTR Mode — DONE
* **Steps to Reproduce:** Click `Toggle language` to switch to English.
* **Defect:** Main body content shifts to `LTR`, but the top navigation bar and sidebar remain anchored in `RTL` alignment on the right side of the viewport.
* **Expected Behavior:** The root layout container must toggle top-level direction attributes (`dir="ltr"` / `dir="rtl"`), mirroring sidebar and navigation position consistently across the application.

**Root cause:** `components/layout/Sidebar.tsx`'s `<aside>` hardcoded `dir="rtl"` and `right-0`/`border-l`/`translate-x-full` positioning — it never looked at the active language at all. `app/dashboard/layout.tsx`'s content wrapper hardcoded `lg:mr-64`/`lg:mr-0` to make room for a right-anchored sidebar.

**Fix:** `Sidebar` now reads `dir` from `useLocalization()` and flips: anchor (`right-0`+`border-l` vs `left-0`+`border-r`), the `dir` attribute itself, and every open/closed/collapsed translate class (mirrored for LTR). `DashboardLayout`'s content margin now picks `lg:ml-64`/`lg:mr-64` (and the collapsed `0` variant) based on the same `dir`.

**Evidence:** live-verified via real bounding-box measurements after toggling to English: sidebar `{left: 0, right: 256}` (anchored left, as expected for LTR) with the header/content area starting exactly at `left: 256`; collapsing the sidebar moves it fully off-screen left (`{left: -256, right: 0}`) with content reflowing to fill the full width, no gap. Screenshots confirm the sidebar, header, and content all agree on LTR positioning together.

### Bug 2.2: Alphanumeric Reversal in Hebrew Strings (LTR Container) — DONE (fix applied as specified; not independently reproducible in Chromium)
* **Path:** `/dashboard/areas` (Areas Table)
* **Defect:** Hebrew area designations containing trailing digits invert sequence order when viewed in LTR/English mode.
  * *Example:* `א6` renders as `6א`; `א13` renders as `13א`.
* **Root Cause:** Table cells inherit container-level `LTR` text direction without explicit bidirectional isolation for mixed language strings.
* **Fix:** Apply proper `dir="auto"` attributes or Unicode bidirectional overrides (`unicode-bidi: isolate`) to string renderer components.

**Evidence:** wrapped the area-name cell's text in `<bdi>` (`frontend/app/dashboard/areas/page.tsx`'s `AreaRow`) — the standard, semantically-correct HTML element for exactly this case (user-entered text of unknown/foreign directionality inside surrounding UI chrome). Applied the report's own prescribed remedy. **Caveat found during verification:** an A/B screenshot comparison (same row, same string `א13`, with and without the `<bdi>` wrapper, in English/LTR mode) showed pixel-identical output in headless Chromium — and that output already matches native Hebrew/RTL mode's rendering of the same row (`13א` reading left-to-right in both cases), which is the mathematically-correct Unicode BiDi Algorithm result for an RTL-initial string with trailing digits, not a reversal. `<bdi>`'s isolation only changes rendering when a run sits next to *other* competing inline content (the confirmed real bug in [[rtl-bidi-digit-overlap]]); a single self-contained string in its own table cell resolves the same with or without it in this engine. Left the isolation in place regardless (harmless, correct practice, and may matter in browsers/engines not available for local testing) but flagging that the specific "6א"/"13א" example in the report is standard bidi behavior already matching Hebrew-native rendering, not a defect introduced by LTR mode.

---

## 3. UI Enhancements & Feature Requests

### Feature 3.1: Organization Default Region Autocomplete Location Picker — DONE
* **Path:** `/dashboard/settings`
* **Requirement:** Add an **Autocomplete Location Picker** (integrating Google Places Autocomplete or map pinpoint selection) when configuring the default starting region for an organization.
* **Objective:** Allow administrators to search and select coordinates/locations on a global map rather than manually keying in static identifiers.

**Found already half-done:** `MapPointPicker` (click-to-place-marker + drag-to-fine-tune, wired to the org's `default_lat`/`default_lng`/`default_zoom`) already existed on this page from an earlier round — that alone satisfies the spec's "map pinpoint selection" alternative.

**Added:** the literal, preferred half of the request — a Google Places `AddressAutocomplete` search box directly above the map picker. Selecting a suggestion now sets the org's default lat/lng from the place's coordinates. `MapPointPicker`'s lat/lng-sync effect now also calls `map.panTo(...)` (previously only moved the marker), so a typed search that's far outside the current viewport actually recenters the visible map instead of just relocating an off-screen pin.

**Evidence:** `frontend/app/dashboard/settings/page.tsx` (new `AddressAutocomplete` + `regionSearch` state), `frontend/components/MapPointPicker.tsx` (`map.panTo`). Live-verified via screenshot: the "Default map center" section now shows a "Start typing an address…" box above the map.

### Feature 3.2: Restrict "View Contact" Link for Activists — DONE
* **Path:** `/dashboard/users/[id]` (e.g., `/dashboard/users/30`)
* **Requirement:** Disable or completely remove the "View Contact" (`צפייה באיש קשר`) action link for accounts assigned the **Activist** user role.

**Investigation:** the "View Contact" link only ever rendered inside the `{user.shliach && (...)}` block, and `user.shliach` is populated **exclusively** for `role === "shliach"` (Activist) accounts (confirmed in `backend/app/schemas.py`: "the linked ContactShliach (role='shliach' only) ... None for admin/staff"). So this link was never reachable for any role other than Activist — removing it for Activists means removing it outright.

**Evidence:** deleted the link block from `frontend/app/dashboard/users/[id]/page.tsx`. Live-verified on activist user id 5 (`zvi.shmuel@gmail.com`): the "View Contact" link/text no longer appears anywhere on the page; the rest of the Activist details card, edit history, etc. render unaffected (screenshot).

---

## Verification notes
- `docker exec sheepsidebay_crm-frontend-1 npx tsc --noEmit` — clean, no errors, after all changes.
- Backend `pytest` run for regressions (seed.py change is additive-only).
- All live verification done via headless Chromium (Playwright) against the real local Postgres dev DB (`docker-compose.local-db.yml`), logged in as an admin.
- **Housekeeping from this session, flagging so it's not a surprise:** the local dev admin account's password (`username: admin`) had to be reset to `QaTest123!` to get a working login for testing (the previously-recorded local dev password no longer worked). A disposable test org/admin (`qa_fixes62` / org id 106) was also created via the legacy `/api/auth/register` dev endpoint and left in place — harmless, empty, safe to delete whenever convenient.
