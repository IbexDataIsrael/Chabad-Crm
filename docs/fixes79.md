# fixes79 — sample building for activists with no active task

Request (2026-09-30): "for all organizations: on activist system — once they register,
as long as they don't have an active task, show them sample data" + "they should see this
building: /dashboard/apartments?building_ids=9, with a clear notice 'sample data'" +
"in Hebrew 'בניין לדוגמא'".

## Decisions
- **Snapshot, not a live read of building 9.** Prod building 9 belongs to org 1
  (חבד שיפסד-ביי): 1414 President St, Brooklyn, 4 floors × 4 apartments, no names/phones/
  emails, every note = the placeholder "זה פורטין", all 16 already marked visited.
  Every org sees the sample, so reading org 1's live rows would be a cross-tenant read
  (and would leak anything org 1 types there later). `frontend/lib/sampleStreet.ts`
  holds the fixed layout (address + 4×4 doors, no notes/resident data), and every door
  starts "to knock" so there's something to practise on.
- **"No active task"** = no task with status ACTIVE (taken) under an active, non-deleted
  campaign (the same rule that gives an activist apartments).
  `core/task_claim.has_active_task`; exposed as `has_active_task` on `GET /api/auth/me`
  (shliach only, `null` for other roles).
- **Real apartments win:** sample mode = shliach, own view (not the admin `?activist=`
  view), `has_active_task === false`, **and** zero real apartments. An activist still
  covered by areas (fixes19) with no task keeps their real doors.
- **Practice is local:** edits merge into page state only (`applySamplePatch`, which
  also re-derives `to_knock` like the server). No apartment PUT, no building-completion
  POST, no street-activity events. Reload = fresh sample. Finishing it still plays the
  celebration and hides the building locally.

## Done
- [x] street2: yellow notice "בניין לדוגמא" + "אין לך עדיין משימה פעילה — זה בניין לתרגול
  בלבד. השינויים כאן לא נשמרים…"; the building's area chip also reads "בניין לדוגמא".
- [x] Activist home: orange hint under "התחל סיבוב": "אין לך עדיין משימה — אפשר להתאמן על
  בניין לדוגמא."
- [x] LOCALIZATION rows: `street.sample_building`, `street.sample_notice`,
  `activist_home.practice_hint`.
- Evidence: `tests/test_fixes79_sample_data.py` (ACTIVE+live campaign → true; AVAILABLE
  or inactive campaign → false; admin → null) + auth/signup suites: 17 passed;
  `tsc --noEmit` clean. Headless mobile drive as a new taskless activist (org 1, local):
  home hint shown; street2 shows notice + 1414 President St + 16 doors; an edit saves
  in the sheet and marks the door visited; **zero non-GET /api calls**; reload resets;
  no page errors. Test user deleted afterwards.

## Not done / notes
- Only street2 + the activist home. The old `/dashboard/street` and
  `/dashboard/apartments` pages stay empty for a taskless activist. Self-registered
  activists (public.py creates their activist card) land on the home page → "התחל סיבוב"
  → street2, so they see it. A shliach user *without* a card lands on `/dashboard/street`.
- Not committed / not pushed.
