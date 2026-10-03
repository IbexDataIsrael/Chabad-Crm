# fixes96 — Google map: activist's buildings; map per task for admins

Requested 2026-10-02.

## Request (as given)

1. New menu item for the activist view, "google map", opening a new page.
2. On it: all of the activist's buildings by geo location, plus the polygons
   of the areas those buildings are in.
3. If the activist has more than one task, write the task number on the map
   where its buildings are (if possible).
4. On the admin's tasks page, a map-looking button on each task; clicking it
   opens that task's map (inline / modal / anything).

## Plan

- Backend `GET /api/tasks/map` (activist: their own buildings) and
  `GET /api/tasks/map?task_id=<id>` (admin / campaign manager: one task):
  buildings with coordinates + the task numbers covering each + the polygons
  of those buildings' areas.
- "The activist's buildings" = the same buildings they see in their apartment
  screens (active tasks under the active campaign, plus area coverage) —
  Claude decision: same access rule as street2, so the map never shows
  anything the activist can't open.
- Task number = the task id as shown on the tasks page ("#12"), drawn on the
  building marker; several tasks on one building → "#12, #15".
- Frontend: new page `/dashboard/activist-map` (menu "מפת גוגל" /
  "Google map", activists only); admin tasks page: a map icon button per task
  opening a modal with that task's map.
- All new texts in the localization table.

## Closeout (2026-10-02)

- [x] `GET /api/tasks/map` (activist) / `?task_id=` (admin, campaign manager or
      the task's own activist; others 403, unknown 404; an admin without a
      task gets an empty map). Returns buildings (coords, apartment count,
      covering task ids) + polygons of those buildings' areas only.
- [x] `BuildingsMap` extended (backward compatible): optional marker labels,
      optional popup line, hide the admin-only building link, height.
- [x] `components/TaskMapView.tsx` (shared): summary "N בניינים · M אזורים
      (· K בלי מיקום)", task numbers under markers when more than one task
      ("#12, #15"), popup with apartments + tasks.
- [x] `/dashboard/activist-map` + menu "מפת גוגל" / "Google map" (activists).
- [x] Tasks page: map-icon button per task → modal "מפת משימה #id"
      (overlay click / ✕ / Esc closes; disabled for a task with no apartments).
- [x] All texts in the localization table (audit: 0 missing).
- Tests: `tests/test_fixes96.py` (2) + related suites → 31 passed.
- Live (local): activist #5 with a temporary 2nd task — menu item, map with
  markers, labels "#44" and "#55", polygons; admin tasks page: 8 map buttons,
  modal "מפת משימה #55" with its buildings. Temporary task deleted after.

Claude decisions:
1. "The activist's buildings" = the same set their apartment screens show
   (active tasks under the active campaign + area coverage), so a building
   reached only through area coverage shows without a task number.
2. Task number = the task id ("#44"), as on the tasks page; drawn only when
   the activist has more than one task (spec).
3. Admin map opens in a modal (spec allowed inline / modal / anything).

Note: local test data has a few buildings geocoded far away (Israel vs.
Brooklyn), so the local maps zoom out to the world — the map fits all
located buildings; real coordinates zoom to the neighborhood.

Committed as c8068b3 (not pushed). Re-verified after commit: test_fixes96 +
error-localization tests 7 passed, localization audit 0 missing, tsc clean.
