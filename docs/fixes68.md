# fixes68 — activist door-to-door route flow

Source: `docs/activist_ux_fixes67.md` (Zvi's implementation spec, 2026-09-25,
read-only — "produce the code changes in the working tree only and stop").
Renamed the in-code comment prefix from the spec's own suggested "fixes67" to
"fixes68": fixes67 was already claimed the same day by the unrelated
single-task-page round (commit 8b98424), which the spec's author didn't know
about when it picked that number. All new/edited code in this round is
commented "fixes68 §x" instead, matching the repo's one-number-per-round
convention.

## Scope (spec §Features 1-9 + Backend B1-B4)

Full activist route flow: one upfront cached load of the activist's assigned
doors (§1/B1), card UI with a grid fallback (§2), one-tap door outcomes
(§3), floor-by-floor resume (§4), a don't-knock marker for non-Jewish
residents (§5), a progress bar + confetti celebrations (§6), an optional
Rebbe photo/quote rotation on the divider screens (§7), a stairwell-tolerant
offline outbox (§8), and full Hebrew-RTL/English-LTR support (§9).

## Checklist

Backend verified via curl + direct ORM checks against real local Postgres
(not SQLite — the FK/versioning behavior mattered here). Frontend verified
via `tsc --noEmit` + a full `next build`, then a live Playwright drive
(Chromium, 390x844 mobile viewport) against temporary org/user/apartment
fixtures on the local Docker stack; fixtures deleted afterward.

- [x] B1 `GET /api/apartments/my-route` — trimmed, hierarchy-sorted, shliach-
      scoped (admin sees all, matching the existing plain-list convention).
      Verified: shliach saw exactly their 2 covered apartments; response
      shape matches `ApartmentRouteItem`.
- [x] B2 `POST /api/apartments/{id}/door-outcome` — creates a visit +
      `visit.door_outcome` picklist link; jewish/not_jewish additionally
      version the apartment (`_apply_versioned_update`) and set
      `apartment.Jewish_status`, so the admin dashboard's "recent Jewish-
      status changes" panel (diffs a retired row against its successor)
      picks the change up — a direct in-place write would have made it
      invisible there. Verified live: idempotent retry on the same
      `client_uuid` returned the identical response (no duplicate visit).
      **Bug caught + fixed during verification**: a second jewish/not_jewish
      mark using the client's now-stale cached apartment id (the first mark
      retires that id) created a *second* `is_display=True` row in the same
      lineage instead of updating the real one — a real data-integrity risk
      any time an activist corrects a Jewish-status tap on the same door
      twice in a session. Fixed by resolving a retired id forward to its
      lineage's current active row before editing; re-verified the lineage
      has exactly one active row after a repeat mark.
- [x] B3 seed data — `apartment.Jewish_status` gained `not_jewish`;
      `visit.door_outcome` is a new picklist field (`answered`/`not_home`/
      `come_back_later`) registered in `picklist_utils.PICKLIST_FIELDS`
      (required — `set_value`'s autoheal 400s on an unregistered field_key).
      `visit.door_outcome` auto-seeds for every org via the existing
      `seed_all()` per-org loop (a genuinely new, empty field). The
      `not_jewish` value does **not** auto-seed that way — it's a new value
      on a field every org already has 6 values for, so
      `seed_default_options_for_empty_lists` never fires for it (by design,
      so it doesn't resurrect an admin-deleted default elsewhere). Added a
      one-time idempotent data migration instead
      (`cfead2898e35_visit_client_uuid.py`, same file as B2's schema
      change). Verified: backfilled into all 95 pre-existing local orgs.
- [x] B4 localization — 29 new `activist_route.*` / `activist_home.*` rows
      (the spec's list plus a few more the actual UI needed: view toggle,
      back/refresh, no-doors/load-failed states, a mixed-household line, a
      short grid don't-knock chip). Verified seeded and rendering correctly
      in both languages via the live drive.
- [x] §1 `lib/activistRoute.ts` — stale-while-revalidate cache
      (`crm.activist.routeCache.v1`), sync/offline status, manual refresh.
- [x] §2 `DoorCard` + `RouteGrid` — card and grid views, `crm.activist.view`
      persisted toggle. Verified: grid groups by building → floor with
      status chips (marked outcome, don't-knock, "not marked yet").
- [x] §3 `OutcomeButtons` + outbox enqueue — one-tap mark, optimistic
      advance, vibrate(30), 5-second undo toast. Verified live: marking a
      door advanced instantly with no dialog; the undo toast showed the
      correct copy in both languages.
- [x] §4 floor-by-floor order + resume — server hierarchy sort, client never
      re-sorts; `crm.activist.routePos.v1` persists position, resolved by
      apartment id (falling back to a clamped index) on reload so a stale
      position from a changed set doesn't strand the activist on the wrong
      door.
- [x] §5 don't-knock banner — loud, non-dismissible, `status.darkred`;
      mixed-household values render a neutral line instead. Draft-friendly
      (ordinary picklist value, no schema change).
- [x] §6 `RouteProgress` + `Celebration` — progress bar; milestone (25/50/
      75%) and completion confetti via a dynamically-imported, shared
      `canvas-confetti`, with a static reduced-motion fallback. Verified
      live: marking the first of 3 doors (33%) correctly fired the 25%
      milestone burst.
- [x] §7 `RebbeInspiration` — reads `public/rebbe/{manifest,quotes}.json`
      (shipped empty + a README telling Zvi where to drop real assets);
      hard rule confirmed in code (renders nothing when both are empty).
- [x] §8 `lib/outbox.ts` — offline queue, sequential flush (online event +
      30s interval + post-enqueue), 4xx flags-and-continues, network/5xx
      stops-for-retry, server-side `client_uuid` dedupe. Verified live
      end-to-end (not just airplane-mode UI — actual duplicate-POST replay
      against the real endpoint).
- [x] §9 RTL/i18n — logical Tailwind properties only in every new file;
      verified via live screenshots in both Hebrew/RTL and English/LTR
      (toggle correctly flips `<html dir>`, phone numbers stay LTR inside
      the RTL layout, button order/banner layout hold up in both).
- [x] EDIT `app/dashboard/activist/page.tsx` — "התחל סיבוב" tile added,
      showing today's done/total from the route cache when one exists.
- [x] EDIT `lib/types.ts` — `ApartmentRouteItem` / `DoorOutcome` types.
- [x] EDIT `package.json` — `canvas-confetti` + `@types/canvas-confetti`
      only, installed into the running container (the anon-volume gotcha).
- [x] `tsc --noEmit` clean; full `next build` (prod mode) passes with
      linting; `pipenv run pytest` — see below.

## Bonus finding (not fixed — out of scope for this round)

`_delete_organization_cascade` (`backend/app/routers/admin.py`) is missing
several models added since it was written: `UserPreference` (fixes17),
and `Task`/`Campaign`/`TaskReportNumber`/`PaperEntry` (fixes58/fixes65) are
absent from its `ordered_models` list entirely. Any org whose users have a
saved preference (e.g. a language toggle — normal usage) or that has any
campaign/task data can't be deleted via `DELETE /api/admin/organizations/
{id}` — it 500s on a `ForeignKeyViolation`. Hit this live while cleaning up
a test org; worked around it by deleting the blocking rows directly rather
than fixing the cascade function, since it's unrelated to this round's
scope. Worth its own small fix.

## Not done / deferred (per spec's own NON-GOALS)

- No service worker / full PWA, no push notifications.
- No swipe gestures (spec explicitly defers this to v2).
- Celebration.tsx is not wired into the tasks page — built shared/generic
  per the spec, for that separate pending todo to reuse later.
- B5 (making the plain `GET /api/apartments` admin-only or paginated) —
  explicitly optional/separate per the spec.

## Not pushed

Per the spec ("Zvi alone saves, commits, and pushes") and the standing
no-commit-without-an-explicit-ask rule: everything above is in the working
tree, uncommitted.
