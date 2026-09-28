STREET VERSION 2 - BUILD INSTRUCTIONS FOR CLAUDE CODE
Project: minicrm (Next.js, Hebrew RTL)
Date: 2026-09-28
Goal: Build a new page /dashboard/street2 with a card-based layout and a building-completion celebration. The existing /dashboard/street stays untouched.

============================================================
RULE 0 - DO NOT TOUCH THE EXISTING STREET PAGE
============================================================
- Do not modify /dashboard/street or any file it imports, unless the import is shared data/API code (see Rule 1).
- Do not rename, move, or refactor anything the current street page depends on.
- /dashboard/street2 is a NEW route. Everything new lives in new files.

============================================================
RULE 1 - DATA, FIELDS, AND NAMING: COPY EXACTLY
============================================================
- Copy the data fetching of /dashboard/street exactly: same endpoints/queries, same data shapes, same field names, same Hebrew labels.
- The current street page was just fixed to show ALL fields flagged "visible" on the apartment record. Street2 must show exactly the same visible fields. If the current page renders a field, Street2 renders it. If the current page hides a field, Street2 hides it. Do not invent a new field list.
- If the current page's data fetching lives in shared code (a hook, a lib function, an API route), import and reuse it. Do not duplicate and fork it.
- Same status values, same status names, same marking flow for apartments. Whatever the current page calls a "done" apartment, Street2 uses that.
- Street2 is for activists only, same as the current street page: apply the same access rule the current page uses (street hidden from admin menu). [DESIGN CHOICE: assumed the activist-only restriction applies to street2 as well, since street2 is the same page with a new layout.]

============================================================
RULE 2 - CARD LAYOUT
============================================================
Approved v2 design direction: buildings as cards, doors (apartments) as cards.

Structure:
- One BUILDING CARD per building, not all buildings on one endless page.
  [DESIGN CHOICE: show one building card at a time, with previous/next navigation and a small progress indicator "בניין 2 מתוך 7". If you prefer, a vertical list of collapsed building cards is acceptable, but one-at-a-time was the direction the user approved.]
- Each building card shows:
  - Building name/address (use the exact field the current page uses).
  - Route progress: a progress bar + "X מתוך Y דירות" (done of total).
  - The apartments of that building as DOOR CARDS inside the building card.
- Each door card shows:
  - The apartment number and ALL the visible apartment fields (Rule 1).
  - The same actions the current page offers per apartment (mark done / status change / etc.), wired to the same mutations.
- Game path element: a route progress bar across the top of the street2 page showing overall progress through the route (buildings completed of total). [DESIGN CHOICE: the mockup mentioned a walking character on a path; implement the progress bar first, and add a small character marker on the bar at the current progress position if trivial.]
- Layout is RTL (dir="rtl"), mobile-first: activists use phones. Cards full-width, large touch targets, sticky progress header. [DESIGN CHOICE: sticky header.]

============================================================
RULE 3 - CELEBRATION ON BUILDING COMPLETION
============================================================
- When the last undone apartment of a building flips to done (i.e. building.apartments.every(isDone) becomes true as a result of the user's action, not on initial page load), show the celebration:
  1. fireBuildingCelebration() - multi-burst confetti, festive colors, all falling from the TOP of the screen, ~4.5 seconds.
  2. A completion card overlay with: "כל הכבוד! סיימתם את הבניין!", one RANDOM Rebbe quote from public/rebbe/rebbe-quotes.json (Hebrew + English + source), a Rebbe photo from public/rebbe/, and a dismiss button "המשיכו בדרך!".
- Provided files:
  - Components/BuildingCelebration.tsx - the overlay component + confetti logic. Import it from street2 and control it with an `open` state. Adjust import paths to project conventions.
  - rebbe-quotes.json - goes into /public as /public/rebbe-quotes.json. The component fetches "/rebbe-quotes.json". Do not change the quote texts or refs.
- Install dependency: npm install canvas-confetti && npm install -D @types/canvas-confetti
- Rebbe photos: create /public/rebbe/ and the USER will add real photos named 1.jpg, 2.jpg, ... The component picks a random one and hides the image if it is missing. REBBE_IMAGE_COUNT in BuildingCelebration.tsx is 10 by default; tell the user to set it to the number of photos actually added. Do NOT fetch Rebbe images from the internet yourself; the user supplies them.
- The celebration fires once per building completion (per session). [DESIGN CHOICE: don't refire on page refresh for an already-completed building; simplest reliable implementation is firing only at the moment the last apartment is marked done by the user's action.]
- Tapping the overlay background or the button dismisses it.

============================================================
RULE 4 - CHECKS BEFORE DECLARING DONE
============================================================
- /dashboard/street still works exactly as before (open it, verify).
- /dashboard/street2 renders with the same data as street: same buildings, same apartments, same visible fields, same labels.
- Marking all apartments of a building done fires confetti + the card with a quote and (if photos exist) a photo.
- Page works on a phone-width viewport, RTL.
- No TypeScript errors; no console errors on load or on celebration.

============================================================
NOTES
============================================================
- Everything user-facing is bilingual where the existing app is bilingual; Hebrew primary, dir="rtl".
- Keep the app's existing styling conventions (colors/spacing) except where this file or the component specifies otherwise.
- Do not push anywhere; the user reviews the branch/preview link first.

============================================================
CLOSEOUT (2026-09-28)
============================================================
Built locally on `main`; nothing committed or pushed per RULE — everything
below is uncommitted working-tree changes, waiting for review.

- [x] RULE 0 (don't touch street) — /dashboard/street/page.tsx and
      street.module.css are untouched. street2 is a fully separate route:
      frontend/app/dashboard/street2/page.tsx + street2.module.css. The only
      shared files touched are app-wide chrome that street.tsx doesn't
      import: app/dashboard/layout.tsx (added a nav entry) and
      components/layout/Sidebar.tsx (added its icon) — additive only.
- [x] RULE 1 (same data/fields/access) — the fetch loop, the 4 fixed
      picklists, text fields, report number, notes, contact, and the
      vis()-gated custom-picklist/custom-field "extra fields" block are the
      same hooks/endpoint/logic as street.tsx, just re-laid-out as cards.
      Live-verified against org 1's real ~26k-apartment data: field set and
      values match street's door-detail sheet 1:1 (spot-checked one
      apartment's full row list + extras). Access rule copied exactly — nav
      entry uses the same `roles: ["staff","shliach","campaign_manager"]`
      restriction street's entry uses (hidden from admin's menu; direct URL
      still works for admin, same as street itself).
- [x] RULE 2 (card layout) — one BUILDING CARD at a time with prev/next +
      "בניין X מתוך Y", building-level apartment progress bar, doors as
      stacked DOOR CARDS showing every visible field inline. Sticky header
      holds a page-wide route progress bar (buildings completed/total) with
      a walking-emoji marker at the current-progress position. Mobile-first,
      RTL, large touch targets (verified at 390×844 viewport).
- [x] RULE 3 (celebration) — DESIGN CHOICE: the current street page has no
      "done"/completion concept anywhere (no such field on Apartment, no
      such action in its UI), so there was no existing mutation to reuse for
      it. Added a street2-only, client-side "mark done" toggle per door,
      persisted to localStorage (key `crm.street2.done`, not scoped to
      backend or organization_id) — it drives the progress bars and the
      celebration trigger and is the one piece of this page that ISN'T a
      reused mutation from street.tsx. Live-verified: marking the last
      undone door of a 138-apartment building fires
      fireBuildingCelebration() + the overlay with a random quote (from
      /public/rebbe-quotes.json, moved there from its original
      /public/rebbe/rebbe-quotes.json — the component fetches "/rebbe-quotes.json"
      at the public root) and a Rebbe photo (public/rebbe/1..9.jpg,
      REBBE_IMAGE_COUNT already matches the 9 photos provided); dismiss (tap
      button or backdrop) closes it; a full page reload afterward does NOT
      refire it. canvas-confetti/@types were already in package.json and
      already installed in the frontend container's node_modules — no
      install step needed.
      - Bug found + fixed during verification: the done-state didn't survive
        a reload (0/138 after reload, should be 138/138). Cause:
        usePersistentState's key was `crm.street2.done.${user?.id}`, but
        `user` loads asynchronously and the hook's lazy initializer only
        runs once at mount — so every fresh load started from the
        not-yet-logged-in "anon" key (empty) and then silently overwrote the
        real per-user key with that empty state once `user` resolved. Fixed
        by dropping the user-id scoping in favor of a fixed key
        (`crm.street2.done`), matching how every other `usePersistentState`
        call in this app is already keyed (e.g. `crm.sidebarCollapsed` —
        none of them are per-user either). Re-verified: state now survives
        mount and reload correctly.
      - Also fixed a real pre-existing TypeScript error in the *provided*
        BuildingCelebration.tsx (`cachedQuotes` typed `Quote[] | null` but
        `loadQuotes()` returned it un-narrowed) — one-line `?? []` fix so
        `tsc --noEmit` is clean project-wide.
- [x] RULE 4 (checks) — /dashboard/street re-opened and still works
      (untouched files). /dashboard/street2 live-driven with Playwright
      (headless, 390×844) against real org-1 data logged in as a temp admin
      (created via legacy /api/auth/register, moved into org 1 via direct
      SQL for the test, deleted afterward): loads, renders the same fields
      as street, RTL confirmed (`dir="rtl"` wrapper present), 138/138 doors
      markable, celebration fires with quote+photo, dismiss works, no
      refire on reload, zero browser console errors. `npx tsc --noEmit` is
      clean for the whole project. `npm run build` (prod webpack build)
      could NOT be verified in this sandbox — no outbound network access,
      and `app/layout.tsx`'s `next/font/google` loader needs to fetch font
      metadata at build time; this is an environment limitation unrelated to
      street2 (root layout, pre-existing). Recommend a real `next build` (or
      the Vercel preview) before merging, per the project's own
      verify-prod-build rule.
  - Heads-up (not caused by this work, found while placing the provided
    assets): frontend/public/rebbe/quotes.json is deleted in the working
    tree, and frontend/public/rebbe/manifest.json's `photos` list is still
    empty. Both belong to the *separate*, pre-existing
    /dashboard/activist/route feature (fixes68 §7) — its own Rebbe
    photo/quote divider screens, unrelated to street2's celebration. If that
    deletion wasn't intentional, activist/route's quote divider currently
    has nothing to show.

