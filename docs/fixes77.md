MINICRM - CHANGE REQUEST -
Floor dividers on the activist street2 page
Scope: ONE frontend fix. English implementation brief first; Hebrew review text second.

ENGLISH - FOR CLAUDE CODE

1. Confirmed request
On /dashboard/street2, visually separate the apartments within EACH BUILDING by floor.
Zvi's words: "in the activist page in street2 make a divider between each floor!"
Keep the existing compact door tiles and tap-to-open apartment sheet.
This is not a request to change the classic apartment grid, street v1, PDFs, or exports.

2. Recommended design choice - not confirmed by Zvi
Put the floor label on the divider, for example "קומה 1" or "קומה 2".
Zvi was asked whether he wants a plain line or a labeled divider, but did not answer.
The label is a recommendation in this brief, not an approved product requirement.
Keep the label easy to remove without removing the separation between floors.
Use the stored floor name, not an inferred number. Names can be "L", "קרקע", letters,
zero, or other free text. Do not manufacture floors from apartment numbers.

3. Verified current code
Inspected the repository default branch on 2026-09-30. Search links resolve to commit
cb9cf120a2d68f8247840b1c18f893e4b6d164a7. Re-read your checkout before editing;
if these locations have changed, adapt to the current code without undoing newer work.

Actual page: frontend/app/dashboard/street2/page.tsx
- load() fetches every page of /api/apartments/list?page=...&page_size=100.
- Admin preview adds as_user_id. Preserve that preview and its read-only behavior.
- The buildings useMemo groups items by building_id in a Map, preserving first-seen
  building order and the received apartment order within each building.
- Completed buildings are filtered out using completedBuildingIds.
- Render currently uses buildings.map, then ONE styles.doors grid per building,
  then b.apartments.map. There is NO floor section or floor divider today.
- Each door already displays a.floor using t("apartments.floor", "קומה").
- openDoor(a), isDone(a), isToKnock(a), and doorStyles[state] drive existing behavior.
  Keep all of these intact. Do not replace the tile with a different component.

Actual fields:
- frontend/lib/types.ts: Apartment.floor is string | null; ApartmentListItem extends
  Apartment. apartment_name is the door label; building_id identifies the building.
- backend/app/models.py: Apartment.floor is nullable String(50), a floor NAME,
  not a floor ID. Floor has building_id, name, and sort_order.

Actual order today:
- street2 does not pass a sort parameter and does not re-sort apartments locally.
- /api/apartments/list defaults to sort="floor", dir="asc".
- backend/app/routers/apartments.py: _floor_rank() looks up the minimum
  Floor.sort_order matching Apartment.building_id and Apartment.floor.
- _sort_keys("floor", db) uses that rank, then natural keys for the floor string.
  Apartment numbers use ascending natural keys next; Apartment.id breaks ties.
  Order keys use nullslast. backend/app/core/natural_sort.py supplies those keys.
- The page therefore groups by building after receiving floor-sorted rows. It is
  NOT using the /route endpoint's report-number/building/floor hierarchy.
Do not add an alphabetical frontend floor sort: it can break the configured floor
order and put "10" before "2". Preserve backend ordering for this visual fix.

Actual styling and localization:
- street2 imports ../street/street.module.css as styles. That CSS is SHARED with
  street v1. styles.doors is a responsive grid: repeat(auto-fill, minmax(96px, 1fr)),
  gap 12px, padding 16px.
- street2 already has its own ./doorStates.module.css, imported as doorStyles.
- useLocalization supplies t(). frontend/lib/localization.tsx sets <html lang>
  and dir="rtl" for Hebrew, dir="ltr" for English.

4. Implementation plan
A. Within each building's existing apartment array, derive ordered floor groups.
   Recommended implementation choice: use a Map keyed by a.floor ?? "", populated
   in received order. Null and empty string share one unknown-floor group. Preserve
   all other stored strings as distinct values. Do not trim, rename, or persist data.
   Keep the first-seen floor order and each group's existing apartment order.
   Each apartment must appear exactly once. Never group floors across buildings.
   Helper/group names are your choice; they are new code, not existing identifiers.
B. Render each floor as its own section with the SAME styles.doors tile grid.
   Add a visible horizontal divider between adjacent floor sections, spanning the
   full section width. A wrapped row of doors is not a new floor.
   Recommended design choice: a small floor heading above each floor's doors,
   including the first floor. Reuse t("apartments.floor", "קומה") for known floors.
   For the unknown group, recommend a localized "קומה לא צוינה" / "Floor not specified"
   label. This wording and label are recommendations, not user-confirmed copy.
   Use the project's localization path for any new key; do not hardcode Hebrew-only UI.
C. Add new styles ONLY in a street2-local CSS module. You may extend the existing
   doorStates.module.css or introduce a new local module. Do not change shared
   street.module.css selectors in a way that changes street v1.
   Follow the current street2 colors and spacing. Use logical CSS properties and
   text-align: start; inherit RTL/LTR. Avoid reversing the apartment arrays for RTL.
   The divider/heading must not be a clickable door, a focus stop, or a sticky bar.
D. Keep building headers/counts, navigation links, door states, all fields, editing,
   save behavior, campaign visibility, activity tracking, completion hiding,
   building-leave warnings, and BuildingCelebration unchanged.
   Floor groups are presentation only. No new floor-completion rule, API fetch,
   permission, database field, migration, or apartment write is needed.

5. Acceptance checks
- Two buildings with the same floor names remain separate buildings and sections.
- In one building with several floors, there is a full-width divider at every floor
  boundary. Multiple rows within one floor do not get extra dividers.
- Single-floor building: one door grid, no unnecessary between-floor divider.
- Preserve configured floor order (including lobby/ground), floors 2 and 10,
  letter floors, "0", and apartment number order within each floor.
- Null and empty floors remain visible exactly once in the unknown group.
- Nothing disappears if a floor section has one apartment.
- Hebrew mobile at 360px width: labels readable, no sideways scrolling or overlapping
  door badges. English LTR: labels and doors remain correctly aligned.
- Open a door, edit, save, and reopen: same fields and write path as before.
- Existing visited/to-knock/idle states and completion behavior still work.
- Admin activist preview gets the same dividers without gaining edit permission.
- /dashboard/street and the classic apartment grid remain unchanged.
- Run the repository's applicable frontend lint/type/build checks and add focused
  grouping tests using its existing test setup. Do not invent a new test framework.
- Inspect actual rendered mobile screenshots in Hebrew and English. Do not call the
  visual change complete based only on DOM structure or a successful build.

6. Delivery rules
Make small local commits. Do not push, deploy, merge, or modify production data.
Stop for Zvi's review. Report changed files, tests and results, screenshots, and any
remaining uncertainty. If your checkout conflicts with this brief, explain the
conflict rather than silently changing other pages or product behavior.



---

## Closeout (2026-09-30) — DONE locally, committed in small local commits, NOT pushed

Waiting for Zvi's review. Everything below was checked against local Docker (localhost:3001).

### What changed
- `frontend/lib/floorGroups.ts` (new): `groupByFloor(apartments)`. Called for ONE building. Keyed by `floor ?? ""` in received order: null and "" become one unknown group (`floor: null`), and every other string is its own group, untrimmed. It never re-sorts, so the backend's configured floor order and the apartment order inside a floor are both kept.
- `frontend/app/dashboard/street2/page.tsx`: after the building header, each floor gets its own `<section>` with a heading and the SAME `styles.doors` grid. The door `<button>` JSX (openDoor/isDone/isToKnock/doorStyles) is unchanged, only re-indented. Building grouping, completion filtering, counts, sheet, save, leave-warning and celebration are not touched.
- `frontend/app/dashboard/street2/floors.module.css` (new, street2-local): the divider is `.floor + .floor { border-block-start }`, so it appears only BETWEEN floors. The heading is a separate element: deleting the `floorLabel` div keeps the divider. Uses logical properties and `text-align: start`. It is static, not focusable, and not clickable. The shared `street.module.css` is not modified.
- Label (§2 recommendation, not confirmed by Zvi): "קומה {name}" / "Floor {name}" reuses `apartments.floor`. The unknown group uses the new `apartments.floor_unknown` row "קומה לא צוינה" / "Floor not specified", added to `backend/app/seed.py` LOCALIZATION. `seed_all` runs at startup, so production gets the row on the next deploy. Locally it was applied with `seed_localization` and read back.
- `frontend/lib/floorGroups.test.mjs` (new): focused grouping tests.

### Tests and checks
- [x] Grouping tests: `node --test lib/floorGroups.test.mjs` (run from frontend/) gives 7/7 pass. They cover configured order kept (L, קרקע, 0, 2, 10, letter floor, and "10" never before "2"), apartment order within a floor, null + "" as ONE unknown group, untrimmed distinct strings, each apartment exactly once, single-apartment floors, single-floor building, and two buildings with the same floor names staying separate.
  - Conflict with the brief: the frontend has NO test setup (no jest/vitest, no test script). Following "do not invent a new test framework", I used Node's built-in `node:test` (no new dependency). The file is `.mjs` so the Next/tsc build doesn't pick it up.
- [x] `npx tsc --noEmit`: clean.
- [ ] Lint: not run. ESLint was never configured in this repo: `next lint` opens its interactive setup wizard.
- [ ] `next build`: not run on the host. A host build corrupts the live Docker dev server's shared `.next` (known gotcha). tsc is the strict type pass that Vercel's build fails on.
- [x] Live, Hebrew and English, mobile 360px (Playwright Chromium). Activist user 5 has 7 buildings and 135 apartments. Door count = 135 = API count, and every building badge equals its doors. Floors per building are 3/6/6/6/6/1/1. There is a 2px divider on every floor section except the first, spanning the full card width (300/300). The two single-floor/no-floor buildings have one grid and no divider. The null-floor apartments appear once each under "קומה לא צוינה" / "Floor not specified". No sideways scroll (scrollWidth 360 = viewport 360). In RTL the label is on the right, in LTR on the left, and doors align in both. Screenshots: `s2_he_top.png`, `s2_en_top.png`, `s2_he_unknown.png` (session scratchpad).
- [x] Admin preview (`?activist=5`): same 7 buildings / same floors / 135 doors. The opened sheet shows 0 edit pencils and 13 locks, and no apartment write requests were sent.
- [x] Door states: to-knock, visited and no-knock-needed tiles render as before inside the floor sections (see screenshots).
- [x] Open → edit → save as test activist 184: the save went through the normal versioned write (DB: new display row 157198 with root_id 154461, name saved). The celebration then fired and the building was hidden, which is the existing completion behaviour working. Side effect: that local test building ("Fixes Test St 58 196559") is now marked complete for the active campaign.
  - Not done: "reopen the same door". The only multi-door test data belongs to real local routes, and any save permanently marks a door visited (apartment versioning), so I did not edit those. The sheet/save code is not modified by this change.
- [x] `/dashboard/street` (v1) unchanged: 0 floor sections, 7 plain door grids, 135 doors. The classic apartments grid, PDFs and exports were not touched.

### Remaining uncertainty
- Label vs plain line: Zvi hasn't chosen. To drop the label, delete the `floorLabel` div in page.tsx; the divider stays.
- Local data only has numeric floors (1–6) plus nulls. The configured-order edge cases (L/ground/10/letters) are covered by the unit tests and the unchanged backend ordering, but were not seen live.
