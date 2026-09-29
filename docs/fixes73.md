About “completing building” 
what happens in the case that building was not completed? 
Ensure that user cant move to next building without being notified . 
only after they know that building is not complete and confirm that they can move to next building . 
the notification should be a modal saying “building {building name} not completed” 
also display the names of all the apartments that user did not make an edit
 the message should explain “these apartments need to have at least one edit to be considered done” do the translation of this to Hebrew 
once user approves he understands that building wasn’t completed let them move to next building
for every building only check 1 previous building
make sure this and all error messages are in localization and not hard coded! 


---

## Status (2026-09-29) — DONE, live-verified locally, NOT committed

Where: `/dashboard/street2` (the activists' apartments page) — `frontend/app/dashboard/street2/page.tsx`.

- [x] **Can't move to the next building without being notified** — tapping a door in a building checks the building right before it in the list (`openDoor()`). If that building still has to-knock doors with no edit, the door does NOT open; a modal shows instead.
- [x] **Modal "building {building name} not completed"** — title key `street.building_incomplete_title` (`הבניין {name} לא הושלם` / `Building {name} not completed`).
- [x] **Lists every apartment with no edit** — apartment number (+ floor) of each pending door. Uses the same rule as the completion celebration: only doors marked *to knock* are required, so non-to-knock doors aren't listed (they never block completion either). A building with zero to-knock doors doesn't warn.
- [x] **Explanation text, Hebrew + English** — `street.building_incomplete_body`: "הדירות הבאות צריכות לעבור לפחות עריכה אחת כדי להיחשב כבוצעו:" / "These apartments need to have at least one edit to be considered done:".
- [x] **After approval, user moves on** — "הבנתי, עבור לבניין הבא" opens the door they tapped and makes it the new current building; "הישאר בבניין" (or tapping outside) keeps them where they were.
- [x] **Only 1 previous building is checked** — the building right before it in list order, no further back. Once confirmed for a building, its doors open freely afterwards; the confirmation is stored per user in localStorage (`crm.street2.ackedBuildings.<userId>`), so a refresh doesn't ask again.
- [x] **All text in localization, not hard-coded** — 5 new `street.building_incomplete_*` rows in `backend/app/seed.py`. The building-completion celebration (`components/BuildingCelebration.tsx`) had hard-coded Hebrew/English — moved to 5 new `street.celebration_*` rows too, and it now follows the UI language/direction. The page's other messages (save failed, phone/email validation, load failed) were already localized.

Evidence: `tsc --noEmit` clean. Headless Chromium drive (390px mobile) as local activist user 144 (2 buildings, both unfinished): door in A opens normally; another door in A → no warning; door in B → modal listing apartments 1, 2, 3 of A, no sheet; "stay" → nothing opens; "continue" → B's door opens; after reload, door in A → warning about **B** only. The backend picked up the new seed rows (`/api/metadata/localization` returns them). No apartment data was edited during the drive.

### 2026-09-30 rework: skipping a building bypassed the check

The user reported that they could skip buildings with no modal. **Real bug:** the first version only checked the building where the activist had *last tapped a door*. Scrolling past a building without tapping any of its doors meant it was never tracked, so it could be skipped freely. Now the check uses the building right before it in **list order**, whether or not it was touched. Completed (hidden) buildings still count in that order and never warn.

Evidence: `tsc --noEmit` clean. Headless drive (local activist 144, fresh storage):
1. Tap the 2nd building directly, skipping the 1st → modal for the 1st building.
2. "Stay" → nothing opens.
3. The 1st building has no previous building → opens normally.
4. "Continue" → door opens.
5. Another tap in the 2nd building → no repeat modal.
6. After a reload → still no repeat modal.
