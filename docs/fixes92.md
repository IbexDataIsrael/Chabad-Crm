
1. GOAL
Build the game-path road map from the attached demo HTML public/route.html (and the font file route-demo-font.ttf) as a NEW page: /dashboard/route.
Do not change /dashboard/street2. It stays exactly as it is.
Add a menu entry "הסיבוב שלי" for shliach only. "דירות" still goes to street2.

2. HOW A DOOR IS MARKED
Same as street2 today: open the door, edit a field, save.

3. PROGRESS
The counter ("2 מתוך 7") and the dots are live.
Count = edited required doors. Total = all required doors.
"Required" = doors to knock: only apartments whose Jewish status is "jew" or "unknown" (the same rule street2 uses today). Everything else is "לא נדרש".
A building is done when all its required doors are edited (and there is at least one).

4. THE THREE SCREENS
a) Path: green winding road, door circles, title "הסיבוב שלי", progress dots, "הדלת הבאה".
   Green with a check = edited. Yellow = next door to do. Gray = other required doors.
   Muted with "לא נדרש" = not required. Use the check and text too, not only color.
   One building at a time, with previous / next building buttons.
b) Door sheet: the same sheet and the same edit fields as street2 today. Keep it open after a save.
c) Completion screen: celebration with confetti, "הבניין שלך!", counts of edited and not-required doors,
   and a "לבניין הבא ←" button. Show it only when a building really becomes complete,
   not when the page loads. Real counts, not the demo numbers.

5. DATA
Use the same data, fields, saving and building-complete logic as street2. Invent nothing.
The demo HTML is only the look. Do not copy its fake data or its restart behavior.
Keep Hebrew, right-to-left, mobile first.

6. LABEL YOUR OWN DECISIONS
Read the street2 code yourself first.
If you decide anything that is not in this spec or the demo, label it clearly as "Claude decision".
If something is unclear, ask me.
7. add menu item for activist only called "מסלול השליחות" / "Shlichus path"
8. commit everything that is in public 
Don't push - stop for my review.

---

## Closeout (Claude, 2026-10-01)

Built: `/dashboard/route` (`frontend/app/dashboard/route/page.tsx` +
`route.module.css`), menu entry, localization rows. **No file under
`/dashboard/street2` was modified** (git shows none).

### How each spec point was met

- §1: new page `/dashboard/route`; street2 unchanged; "דירות" still → street2.
- §2/§5: door marking, fields, saving and building-complete logic are street2's
  own: done = the apartment was edited (`root_id` set); required = `to_knock`
  (the backend keeps it in sync with Jewish status — jew / unknown); a building
  is done when all its required doors are edited and it has at least one;
  completion persisted per active campaign (fixes72); practice building for an
  activist with no task (fixes79). No demo data, no restart behavior.
- §3: counter "X מתוך Y" = edited required doors / required doors of the
  building on screen; dots live, one per door.
- §4a: green dotted winding road; door circles: green + ✓ = edited, yellow +
  "הדלת הבאה" = next, gray = other required, muted + "−" + "לא נדרש" = not
  required; every door also shows its state as text. One building at a time.
- §4b: the same street2 sheet + the same tap-to-edit / autosave fields
  (fixes88); stays open after a save.
- §4c: completion screen with confetti, "הבניין שלך!", the building's real
  counts (edited / not required), "לבניין הבא ←"; only when a save completes
  the building, never on load.
- §7: menu item "מסלול השליחות" / "Shlichus path", activists only.

### Claude decisions (not in the spec or the demo)

1. **Copy, not shared code:** the page is a copy of street2's page with the
   presentation replaced, so street2 stays untouched (spec §1). Cost: the data
   / save logic is duplicated; it can be unified later if you want.
2. **Menu label vs. title:** §1 says the entry is "הסיבוב שלי", §7 says
   "מסלול השליחות". Menu = "מסלול השליחות" (§7, later and more specific);
   page title = "הסיבוב שלי" (§4a). Placed right after "דירות", route icon,
   shown under the same "apartments" feature switch as "דירות".
3. **Building navigation:** ← / → buttons around the building name, with
   "בניין i מתוך n · N דירות".
4. **No "קלאסי / מסלול" toggle and no "איפוס ההדגמה" button** from the demo:
   the classic view is street2 itself, and the spec rules out restart.
5. **Scrolling:** on opening a building (and on load) the next door scrolls
   into view; closing the sheet scrolls to the (new) next door.
6. **Door caption:** the resident name only when the campaign shows the name
   field, else "דירה X".
7. **Last building:** when the completed building was the last one, the button
   reads "חזרה למסלול" and the page says all buildings are done.
8. **Completed buildings disappear** from the route (same as street2); the
   completion screen keeps the counts captured at the moment of completion.
9. **Kept from street2 as-is:** the "building not completed" warning when
   opening a door in a building after an unfinished one (fixes73), and the
   admin / campaign-manager read-only `?activist=<id>` view.
10. **Font:** the demo's `route-demo-font.ttf`, loaded from `/public`.

### Verified (local, live, 390px)

- Activist #5 (real data): menu shows "מסלול השליחות" and still "דירות";
  title "הסיבוב שלי", "0 מתוך 6", 30 doors = 30 dots, exactly one "הדלת הבאה";
  editing a door kept the sheet open and moved the counter to "1 מתוך 6";
  closing moved "next door" on. No page errors.
- Practice building (activist #2, no task): no completion screen on load;
  16 required doors edited one by one ("1 מתוך 16" … "15 מתוך 16"); the 16th
  showed "הבניין שלך!" with 16 edited / 0 not required + confetti, sheet
  closed; 0 PUT requests (practice edits are never saved).
- `tsc --noEmit` clean.

Not verified live: "לבניין הבא ←" moving to a *following* building (needs a
real building completed on local data); its logic is the same id hand-off.

Committed (incl. everything in `frontend/public`), **not pushed**.
