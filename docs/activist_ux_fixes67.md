# Activist Frontend UX Overhaul - minicrm (implementation spec for Claude Code)

Repo: IbexDataIsrael/minicrm (Next.js 14 frontend/ + FastAPI backend/)
Date: 2026-09-25. Context: Sukkot campaign is live NOW; Chanukah campaign in ~2 months.

*** READ ONLY ***
Zvi alone saves, commits, and pushes. Do NOT run git commit, git push, or any
write to the remote. Produce the code changes in the working tree only and stop.
Everything below is one change-set; comment convention follows the repo's
existing "fixesNN §x.y" style - use "fixes67" (fixes66 is the highest used;
fixes67+ are free, verified by code search).

=====================================================================
0. VERIFIED CURRENT STATE (read from the repo - build on this, don't invent)
=====================================================================

Stack: Next.js 14.2.5 (app router), React 18, TypeScript, Tailwind 3.4 +
tailwindcss-animate, lucide-react icons, sortablejs. No state library, no
framer-motion, no confetti library. Backend: FastAPI + SQLAlchemy + SQLite,
alembic for migrations, Pipenv.

i18n / RTL: frontend/lib/localization.tsx - LocalizationProvider, lang "he"
default, sets <html dir="rtl|ltr">, t(key, hebrewFallback). Translation keys
are seeded server-side in backend/app/seed.py LOCALIZATION as tuples
(category, technical_name, hebrew, english). LanguageToggle component exists
and already flips the whole app. So: every new string goes through t() with a
Hebrew fallback, plus a seed tuple (see B4).

Persistence: lib/persist.ts usePersistentState(key, initial) - localStorage,
keys namespaced "crm.*" (swept on logout, so device-local only).
lib/preferences.ts useDbPreference - server-backed per-account ("crm.pref.*").
Use usePersistentState for view choices and route position.

Activist entry point: app/dashboard/activist/page.tsx - landing tiles,
announcements, per-campaign stat tiles (/api/campaigns/active-stats),
report-completion modal. The route mode this spec adds hangs off this page.

Apartments grid: app/dashboard/apartments/page.tsx - desktop table,
server-side pagination (page_size must be 20, 50 or 100), persisted filters,
group-by-building, and sort="hierarchy": report number -> building address ->
floors.sort_order -> apartment label (backend _sort_keys in
routers/apartments.py). This hierarchy order is the route order - reuse it,
do not re-sort client-side.

Backend shliach scoping: routers/apartments.py::_shliach_apartment_ids
already restricts every list endpoint for role="shliach" server-side. Reuse.

SPEED PROBLEM (measured in tonight's pentest): GET /api/apartments (the plain
endpoint, not /list) returns ALL apartments, unpaginated, full fields: ~25k
rows / 9.7MB. Do NOT build the activist flow on it. The fix is a new trimmed,
activist-scoped endpoint (B1) - assigned apartments only, UI fields only -
plus a client cache. Do not make the dump bigger.

Visits: VisitHistory model ALREADY has apartment_id (nullable FK, SET NULL)
and followup fields - but schemas.VisitCreate does NOT expose apartment_id,
non-admins can only create visits under POST /api/contacts/{id}/visits, and
POST /api/visits is admin-only. There is no door-outcome concept: visit.type
picklist = home/phone/event/meeting. So one-tap door outcomes need the small
backend addition in B2.

"Not Jewish" flag: the apartment.Jewish_status picklist values are
na / jewish / jewish_interested / jewish_gentile / jewish_interested_gentile /
jewish_shtumtz. There is NO pure "not Jewish" value today. B3 adds
"not_jewish" as ordinary seed data (idempotent), which is also what makes it
draft-friendly: apartment.status (active/draft) already exists and the
picklist value is just data - no schema change, works on drafts.

Celebration: there is NO confetti/celebration component anywhere in the repo
(searched confetti / celebration / balloons: 0 hits). An earlier spec for
confetti on task completion was never implemented. This spec builds ONE
shared components/Celebration.tsx that the route flow uses now and the
task-completion feature can reuse later.

apiFetch (lib/api.ts): Bearer token from localStorage, retries GETs with
backoff (1s/3s/6s/10s), throws ApiError(status, message, body).

=====================================================================
FEATURE 1 (fixes67 §1) - SPEED: one upfront load, activist-scoped + cached
=====================================================================

Goal: zero per-apartment round trips. The full route loads once on open and
is cached client-side; reopening the app is instant, even in a stairwell.

1.1 New file frontend/lib/activistRoute.ts:
- Types (mirror B1): ApartmentRouteItem { id, guid, building_id,
  building_name, building_address, area_name, report_number_name, floor,
  apartment_name, name, phone, apartment_notes, jewish_status,
  mezuzah_status, status, last_outcome, last_outcome_at }.
- loadRoute(): stale-while-revalidate against cache key
  "crm.activist.routeCache.v1" = { fetchedAt: string, items: ApartmentRouteItem[] }.
  - Render cached items immediately (synchronous localStorage read).
  - Then background apiFetch<ApartmentRouteItem[]>("/api/apartments/my-route").
    On success: replace cache + state, stamp fetchedAt. On failure: keep the
    cache and surface a status chip (see 1.2).
  - Manual refresh: RefreshCw icon button next to the chip, spins while
    in-flight. (Pull-to-refresh is v2; do not build it now.)
- Size note: this is the activist's ASSIGNED set only (tens to low hundreds
  of rows, trimmed fields) - one small request on open, then nothing per door.

1.2 Sync status chip on the route page: "עודכן {HH:MM}" when fresh,
"לא מקוון - מציג נתונים מ-{HH:MM}" when the last refresh failed.

Acceptance (Zvi):
- Opens /dashboard/activist/route on Wi-Fi: all his doors appear after one
  short load. Closes the app, reopens: doors render instantly with the
  "עודכן" chip.
- Turns on airplane mode and reopens: doors still render, chip reads
  "לא מקוון". Taps the refresh icon when back online: data refreshes.

=====================================================================
FEATURE 2 (fixes67 §2) - CARD UI with grid fallback (persisted)
=====================================================================

2.1 New file frontend/components/activist/DoorCard.tsx - one door fills the
screen. Contents, top to bottom:
- Don't-knock banner (Feature 5; only when flagged).
- Building address (text-2xl font-bold), floor + apartment label
  (e.g. "קומה 2, דירה 7"), area/report-number line in muted text.
- Resident name; phone rendered as a tel: link (Phone icon) so one tap calls.
- apartment_notes in a muted box when present.
- Last outcome chip when last_outcome is set ("סומן: לא בבית, 21:40").
All strings via t(); logical Tailwind properties only (ms/me/ps/pe,
text-start) - never ml/mr/left/right (RTL, Feature 9).

2.2 View toggle cards|grid persisted as "crm.activist.view" via
usePersistentState (LayoutGrid / RectangleVertical icons in the header).
New file frontend/components/activist/RouteGrid.tsx: the whole route grouped
by building, then floor, compact rows with an outcome-status chip per door;
tapping a row switches to card mode positioned at that door's index.

2.3 Better-than-swipe recommendations (Zvi asked for alternatives to his
swipeable-cards idea - implement these, not swipe):
- Buttons live in a sticky bottom thumb zone (min-height 56px targets,
  full-width row, safe-area padding) - one-handed use with the phone in one
  hand, no reaching.
- navigator.vibrate(30) on every outcome mark: silent tactile confirmation
  when the phone is muted in a stairwell.
- Swipe gestures are DEFERRED (v2). They are the top cause of accidental
  marks; if added later, swipe may only advance, never record an outcome.

Acceptance (Zvi):
- On his phone, one door fills the screen; the outcome buttons sit under his
  thumb without scrolling.
- Taps the grid icon: sees the building grouped by floor with status chips.
  Taps a door: back in card mode at that door. Reopens the app later: same
  view mode as he left it.

=====================================================================
FEATURE 3 (fixes67 §3) - ONE-TAP OUTCOMES per door
=====================================================================

3.1 New file frontend/components/activist/OutcomeButtons.tsx - five large
buttons (each min-h-14, text-lg, full-width, stacked or 2-col grid):
  answered         נענו
  not_home         לא בבית
  jewish           יהודי
  not_jewish       לא יהודי
  come_back_later  לחזור מאוחר יותר

3.2 One tap = enqueue outcome (Feature 8) + optimistic UI update + vibrate +
auto-advance to the next door. No confirmation dialog, no second screen.
- jewish / not_jewish record an answered visit AND set the apartment's
  Jewish_status (server-side in B2). The card's chip updates optimistically.
- Undo: a 5-second undo toast after each mark. Undo removes the item from
  the outbox - it only works while the mark is still unsynced; state that in
  the toast copy ("בטל - עוד לא סונכרן").

Acceptance (Zvi):
- Standing in the stairwell he taps "לא בבית": the door is marked and the
  next door appears instantly, no spinner, no dialog.
- Taps "יהודי": the visit is logged and the apartment shows יהודי in the
  grid chip. He can undo within 5 seconds while offline.

=====================================================================
FEATURE 4 (fixes67 §4) - ROUTE FLOW: floor by floor, resume where you left off
=====================================================================

4.1 Order: the server returns my-route pre-sorted by the existing hierarchy
sort (report number -> building -> floors.sort_order -> apartment label).
The client NEVER re-sorts; "next" is index+1. This gives the floor-by-floor
walk through the assigned building for free.

4.2 Route position persisted: "crm.activist.routePos.v1" = { apartmentId,
index } via usePersistentState. Reopening the app resumes on the same door.
A small "חזרה" (back) moves index-1 without touching recorded outcomes.

4.3 New file frontend/components/activist/DividerCard.tsx: when the next
door crosses into a new building or floor, show a slim divider card first:
"בניין הרצל 12 - קומה 3 - 6 דירות נותרו". One tap advances. Divider cards
are also the slot for Feature 7's inspiration content.

Acceptance (Zvi):
- He marks the last door on floor 1: next screen is the floor-2 divider,
  then floor 2's first door.
- He force-closes the app mid-route and reopens: he is on the exact door he
  left, with his progress intact.

=====================================================================
FEATURE 5 (fixes67 §5) - DON'T-KNOCK markers (non-Jewish resident)
=====================================================================

5.1 Rule: jewish_status === "not_jewish" (new seed value, B3) renders a loud
banner at the TOP of DoorCard, above everything: background status.darkred
(#8b0000, already in tailwind.config.js), white bold text, Ban icon:
  "לא לדפוק - דייר לא יהודי" / "DO NOT KNOCK - non-Jewish resident".
Not dismissible, no subtle variant. The grid row gets the same dark-red chip.

5.2 Mixed households (jewish_gentile, jewish_interested_gentile) are NOT
don't-knock - they contain a Jew. They render a neutral muted info line only.

5.3 Marking "לא יהודי" from the outcome buttons flips the banner on
immediately (optimistic) and it persists via B2.

5.4 Draft-friendly: the marker is an ordinary picklist value on the
apartment; it works on active and draft apartments alike (apartment.status
already exists - no schema change).

Acceptance (Zvi):
- He marks a door "לא יהודי". On every later approach to that door - tonight,
  at Chanukah - the red "לא לדפוק" banner is the first thing on screen before
  he knocks. The admin sees לא יהודי in the apartments grid filter and can
  edit or remove it like any other status.

=====================================================================
FEATURE 6 (fixes67 §6) - PROGRESS bar + celebrations
=====================================================================

6.1 New file frontend/components/activist/RouteProgress.tsx: sticky top bar
under the header: "34 / 60 דלתות" + a progress bar (bg-primary fill on
bg-muted track, h-2, rounded). A door counts as done when it has a door
outcome (last_outcome set from my-route, or marked this session).

6.2 New SHARED file frontend/components/Celebration.tsx (top-level
components/ - this is the same component the pending "confetti on task
completion" todo will reuse; build it generic):
- API: <Celebration fire={kind} onDone={...}/> where kind is
  "milestone" | "complete".
- Implementation: dynamic import("canvas-confetti") inside the effect so it
  never blocks first paint. milestone = one star-shaped burst;
  complete = 3-staggered multi-burst in brand + status colors.
- Honor prefers-reduced-motion: no confetti, show a static "כל הכבוד!" card
  instead.
6.3 Fire points in the route page: 25%, 50%, 75% (milestone) and 100%
(complete, plus a completion card "סיימת את כל הדלתות - כל הכבוד!").

Acceptance (Zvi):
- The bar reads "34 / 60 דלתות" and fills as he works.
- Marking the door that crosses 50% fires a star burst; marking the final
  door fires the full celebration and shows the completion card.

=====================================================================
FEATURE 7 (fixes67 §7) - INSPIRATION: Rebbe pictures + quotes (assets approach)
=====================================================================

7.1 New file frontend/components/activist/RebbeInspiration.tsx: rendered
inside DividerCard slots (Feature 4.3), at most one per divider, alternating
photo card / quote card. Rotation is deterministic (index = number of
dividers seen this route) so nothing repeats until the list cycles.

7.2 Assets - Zvi supplies them; ship empty placeholders:
- frontend/public/rebbe/photos/ - Zvi drops .jpg/.webp files here. Ship the
  folder with only .gitkeep and a README.md telling him exactly where to
  drop photos and the naming rule (01.jpg, 02.jpg... or any filename; the
  component reads a static manifest).
- frontend/public/rebbe/quotes.json - Zvi's curated list, shape:
  [{ "he": "...", "en": "...", "source": "..." }]. Ship it as [].
- frontend/public/rebbe/manifest.json - { "photos": ["01.jpg", ...] } - ship
  with an empty array.
- HARD RULE: the component renders NOTHING when manifest and quotes are
  empty - no placeholder quote, no stock text, no hotlinked image. Every
  quote comes from Zvi's reviewed quotes.json; never invent one. Real quotes
  only, per Zvi.
- Photos render as plain <img> object-cover, max-h ~40vh, rounded-xl;
  quote card shows he text (or en in English mode) plus the source line.

Acceptance (Zvi):
- With empty assets: divider cards show plain building/floor info, no broken
  images, no fake quotes.
- After he drops 3 photos + 5 quotes: divider 1 shows photo 1, divider 2
  shows quote 1, and nothing repeats mid-route.

=====================================================================
FEATURE 8 (fixes67 §8) - STAIRWELL-TOLERANT offline queue
=====================================================================

8.1 New file frontend/lib/outbox.ts:
- localStorage key "crm.activist.outbox.v1" =
  [{ client_uuid (crypto.randomUUID()), apartment_id, outcome, at, notes? }].
- Mark flow: append -> optimistic UI -> flush. Flush triggers: the window
  'online' event, a 30s interval while the page is open, and right after each
  append.
- Flush = sequential POST /api/apartments/{id}/door-outcome with client_uuid.
  Remove the item on 2xx. On network error: keep, retry next flush. On 4xx:
  keep the item, flag it, and show a small warning chip - never silently drop
  a mark.
- The server dedupes on client_uuid (B2), so a retried POST can never
  double-log a visit.
8.2 Outbox badge on the route page: "3 סימונים ממתינים לסנכרון" with a
spinner while flushing; disappears when the queue is empty.

Acceptance (Zvi):
- Airplane mode: he marks 5 doors, the UI advances normally and the badge
  counts up to 5. Airplane mode off: within ~30s the badge drains to 0 and
  the admin's visits list shows exactly 5 visits - no duplicates, no losses.

=====================================================================
FEATURE 9 (fixes67 §9) - HEBREW-FIRST RTL with English toggle
=====================================================================

9.1 Every new string uses t("activist_route.*", "<Hebrew fallback>") and gets
a matching LOCALIZATION seed tuple, category "activist_route" (full list in
B4), so admins can refine wording without a deploy.
9.2 RTL comes from the existing LocalizationProvider (<html dir>) - new code
must use logical Tailwind properties only (ms-/me-/ps-/pe-, text-start,
start-0/end-0). No ml/mr/left/right anywhere in the new files.
9.3 The existing LanguageToggle in the header flips the route page too -
verify by toggling, no new toggle work.

Acceptance (Zvi):
- Default view is fully Hebrew, RTL. Toggling to English flips the whole
  route UI to English LTR; button order and banner layout stay correct.

=====================================================================
FRONTEND FILE-BY-FILE CHECKLIST
=====================================================================

NEW:
  frontend/app/dashboard/activist/route/page.tsx   - the route mode screen:
      data load (activistRoute), position state, renders DoorCard /
      DividerCard / RouteGrid, RouteProgress, outbox badge, Celebration.
  frontend/components/activist/DoorCard.tsx        - Feature 2/5
  frontend/components/activist/OutcomeButtons.tsx  - Feature 3
  frontend/components/activist/RouteProgress.tsx   - Feature 6
  frontend/components/activist/RouteGrid.tsx       - Feature 2 grid fallback
  frontend/components/activist/DividerCard.tsx     - Feature 4/7 slot
  frontend/components/activist/RebbeInspiration.tsx- Feature 7
  frontend/components/Celebration.tsx              - Feature 6 (SHARED; the
      pending task-completion confetti todo reuses this - build it generic)
  frontend/lib/activistRoute.ts                    - Feature 1
  frontend/lib/outbox.ts                           - Feature 8
  frontend/public/rebbe/README.md                  - where Zvi drops assets
  frontend/public/rebbe/quotes.json                - [] (Zvi curates)
  frontend/public/rebbe/manifest.json              - { "photos": [] }
  frontend/public/rebbe/photos/.gitkeep

EDIT:
  frontend/app/dashboard/activist/page.tsx - add one big primary tile
      "התחל סיבוב" (Start route) linking to /dashboard/activist/route,
      showing today's done/total when a route cache exists.
  frontend/lib/types.ts - ApartmentRouteItem, DoorOutcome types.
  frontend/package.json - ONE new dependency: canvas-confetti
      (+ dev @types/canvas-confetti). Nothing else.

=====================================================================
BACKEND CHANGES (minimal, listed separately - deferrable if tonight is tight)
=====================================================================

The frontend above only fully works once B1 + B2 exist. B3/B4 are idempotent
seed data. B5 is optional hardening - separate PR, not part of this feature.

B1. GET /api/apartments/my-route (routers/apartments.py)
    - Shliach role: scoped by the existing _shliach_apartment_ids. Admin: all.
    - is_display=True only; order by the existing _sort_keys("hierarchy").
    - New schemas.ApartmentRouteItem (trimmed): id, guid, building_id,
      building_name, building_address, area_name, report_number_name, floor,
      apartment_name, name, phone, apartment_notes, jewish_status,
      mezuzah_status, status, last_outcome (str|null), last_outcome_at
      (datetime|null) - the value/date of the most recent visit_history row
      for the apartment that has a visit.door_outcome picklist link.
    - Target payload: the activist's assigned set only - tens to low hundreds
      of rows, well under 1MB. This replaces the 9.7MB dump for the app.

B2. POST /api/apartments/{apartment_id}/door-outcome (routers/apartments.py)
    - Body schemas.DoorOutcomeIn { outcome: Literal["answered","not_home",
      "jewish","not_jewish","come_back_later"], client_uuid: str,
      notes: str|None = None }.
    - Permission: the covering shliach (reuse the _shliach_apartment_ids
      check) or admin.
    - Creates VisitHistory(organization_id, apartment_id, contact_id = the
      apartment's linked contact if any, visit_date = utcnow) with
      visit.type = "home" and a visit.door_outcome picklist link:
        answered / not_home / come_back_later -> the value as-is
        jewish     -> door_outcome "answered" + set apartment Jewish_status
                      "jewish" via the existing _apply_picklist_fields path
        not_jewish -> door_outcome "answered" + set apartment Jewish_status
                      "not_jewish"
    - Idempotency: new nullable column visit_history.client_uuid (+ index,
      one small alembic migration). If a visit with the same client_uuid
      exists, return it with 200 instead of inserting. If a migration is too
      heavy tonight: temporary fallback dedupe on (apartment_id, same
      outcome, created within 60 seconds) and note the debt in the PR.

B3. Seed data (backend/app/seed.py - seed_picklists is idempotent, existing
    orgs pick these up on next seed run):
    - PICKLISTS += ("apartment.Jewish_status", "not_jewish", "לא יהודי",
      None, 6, False); PICKLIST_ENGLISH_VALUES[("apartment.Jewish_status",
      "not_jewish")] = "Not Jewish".
    - New picklist field visit.door_outcome values:
      ("visit.door_outcome", "answered", "נענו", None, 0, False)
      ("visit.door_outcome", "not_home", "לא בבית", None, 1, False)
      ("visit.door_outcome", "come_back_later", "לחזור מאוחר יותר", None, 2, False)
      + English entries in PICKLIST_ENGLISH_VALUES.
    - Register "visit.door_outcome" in routers/visits.py
      _VISIT_PICKLIST_FIELD_KEYS so it validates/serializes like visit.type.

B4. LOCALIZATION seed tuples, category "activist_route" (he, en):
    activist_route.title            התחל סיבוב / Start route
    activist_route.outcome.answered נענו / Answered
    activist_route.outcome.not_home לא בבית / Not home
    activist_route.outcome.jewish   יהודי / Jewish
    activist_route.outcome.not_jewish לא יהודי / Not Jewish
    activist_route.outcome.come_back_later לחזור מאוחר יותר / Come back later
    activist_route.do_not_knock     לא לדפוק - דייר לא יהודי / DO NOT KNOCK - non-Jewish resident
    activist_route.progress         {done} / {total} דלתות / {done} / {total} doors
    activist_route.synced           עודכן {time} / Updated {time}
    activist_route.offline          לא מקוון - מציג נתונים מ-{time} / Offline - showing data from {time}
    activist_route.outbox_pending   {n} סימונים ממתינים לסנכרון / {n} marks waiting to sync
    activist_route.undo             בטל - עוד לא סונכרן / Undo - not synced yet
    activist_route.divider.building בניין {address} / Building {address}
    activist_route.divider.floor    קומה {floor} / Floor {floor}
    activist_route.divider.remaining {n} דירות נותרו / {n} doors left
    activist_route.complete         סיימת את כל הדלתות - כל הכבוד! / All doors done - well done!
    activist_route.marked           סומן: {outcome}, {time} / Marked: {outcome}, {time}
    (plus grid/back/refresh/view-toggle labels in the same pattern)

B5. OPTIONAL, separate PR (pentest follow-up, NOT required here): the plain
    unpaginated GET /api/apartments returns every apartment with every field
    to any org member. Make it admin-only or paginate it.

=====================================================================
NON-GOALS
=====================================================================

- No service worker / full PWA, no push notifications.
- No admin UI changes beyond the seed data.
- No changes to contact pages, maps, or the desktop apartments table.
- No swipe gestures (deferred to v2, see 2.3).
- No wiring of Celebration into the tasks page - that is the separate
  pending confetti todo; this spec only builds the shared component.
- Git: no commit, no push - Zvi alone saves/commits/pushes.

=====================================================================
DEFINITION OF DONE
=====================================================================

1. npm run build passes; pipenv run the backend tests still pass.
2. Every acceptance check in Features 1-9 verified on a phone viewport
   (Chrome DevTools mobile emulation is fine).
3. Hebrew default renders fully RTL; English toggle flips cleanly.
4. Airplane-mode walkthrough of Feature 8 shows zero lost and zero
   duplicated visits.
5. With empty /public/rebbe assets, no placeholder quote or image appears.
6. All new/edited code blocks carry "fixes67 §" comments in the repo's
   existing style.
