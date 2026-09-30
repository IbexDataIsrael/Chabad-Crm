# fixes85 — "email already belongs to another activist" when adding in another org

Reported 2026-10-01: adding an activist in a different org with the same email
fails with "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון". Requirement (fixes14,
restated): the same email may be an activist in several orgs; at login the
activist picks which org to continue with.

## Finding

Cross-org is **not** broken. Every uniqueness check is scoped to one org, and
a new test proves the exact flow: activist `both@example.com` created in org A
and in org B → both 201 → login returns the org picker with 2 orgs.

The block was a real duplicate **inside** the target org. Prod org **#10
"ארגון הדגמה"** is the clone of org 1 (fixes84). Clone copies org 1's 18
activist contacts **with their real emails** (e.g. zvi.shmuel@gmail.com,
mkishon770@gmail.com, mendelraices@gmail.com) but no logins. So those
activists already exist in org 10, and adding one again is a same-org
duplicate. Because they have no login, they appear in org 10's Users page
only as "no login" rows, which is why they looked absent.

## Done

- [x] The error now names the existing activist and its contact id, e.g.
      "כתובת אימייל זו כבר משויכת לפעיל אחר בארגון: יוסי כהן (#612)"
      (`core/shliach.py::email_taken_error`, used at all 3 sites).
- [x] Tests: `test_same_activist_email_in_two_orgs_then_org_picker`,
      `test_same_org_duplicate_names_the_existing_activist`.
      test_fixes14 + test_users + test_fixes65 → 42 passed.

## Open — needs a decision

- [ ] What should clone do with activist contacts' emails? Options: keep them
      (today), blank them on the copy, or skip activist contacts entirely.
- [ ] For org #10 today: to give one of those 18 people a login there, use
      the existing activist (Users page, "no login" row → create login) rather
      than adding a new one.

Not committed or pushed.

## 2. Settings map not showing (reported on the new clone org)

**Not clone-specific, not Google:** the prod key renders a real map on the prod
domain (Playwright page served as minicrm-ibexdata.vercel.app, 50 tiles, also
with the app's exact `libraries=places,drawing&v=weekly` URL). Reproduced
locally for org 1 **and** the clone: "Google Maps JavaScript API included
multiple times", 0 tiles. Cause: `AddressAutocomplete` loaded Maps in the
org's "map in English" language while every map loaded the UI language;
`loadGoogleMaps` tears the global API down on a language mismatch, killing the
map mid-render. Every org with "map in English" on was affected on any page
with both.

- [x] `lib/maps.ts::useMapsLang()` (org "map in English" → en, else UI
      language) used by all 7 Maps callers. Settings map now renders for org 1
      and the clone (47 tiles); Areas map still renders.

## 3. Separate English title + subtitle in Settings

- [x] `organizations.name_en`, `public_subtitle_en` (migration `85a1b2c3d4e5`,
      applied locally). Settings: "שם הארגון באנגלית"; public-page card:
      "כותרת משנה באנגלית". Blank = Hebrew one.
- [x] Used when viewing in English: public `/org/<slug>` page title + subtitle,
      and the app sidebar/header org name. Test
      `test_org_english_title_and_subtitle`. Live-verified (en shows English,
      he unchanged).
