# UI & Logic Updates Plan

**Status (2026-09-17): done except §3's address-formatting bullet — verified
locally (real local Postgres + a live browser session), NOT deployed/pushed.**

## Closeout notes

### §1 Single Building Display
- [x] Building Type now shown on `/dashboard/buildings/[id]` — fetches
  `/api/buildings/types` and renders a "סוג בניין" row, same label convention
  as the buildings-list page's own badge (`frontend/app/dashboard/buildings/[id]/page.tsx`).
  Live-verified for all 3 types (building / town_house / divided_town_house).
- [x] Apartment naming/sorting: the display title is now `{floor} {apartment
  number}` (space-separated, floor first) — was `{apartment
  number}{floor}` with **no separator** (fixes21 §2), which read ambiguously
  for letter-floor buildings ("2A" could be misread as apartment "2A" itself
  instead of floor A's apartment 2). One shared helper
  (`backend/app/core/display.py` `apartment_title` / `frontend/lib/types.ts`
  `apartmentTitle`) feeds every display site — apartments list, building
  pages, search results, the PDF apartment picker — so all of them flip
  together. Updated the 6 existing test assertions that pinned the old format
  (`test_fixes7.py`, `test_fixes17.py`, `test_fixes18.py`, `test_fixes21.py`).
- [x] Floor "L" (Lobby) now actually always sorts first — found the real bug:
  `POST /api/buildings`'s floor-seeding loop used the raw list index as
  `sort_order` with no L-first special case (`add_floor()` already had one,
  from fixes52 §3, but `create_building()` never did). Extracted a shared
  `_floor_sort_order_for()` helper in `backend/app/routers/buildings.py`,
  used by both endpoints now.
  - The three bulk-import scripts (`import_data2.py`, `import_data3.py`,
    `import_apartment_data.py`) had the identical gap in their own
    `floor_sort_order()` helper — "L" fell into the generic
    "unrecognized floor name" bucket (sort_order 900/999) and could even sort
    *after* "B"/"BSMT" (-1). Fixed all three the same way (`upper() == "L"` →
    a sort_order below every other special case).
  - **Real data was affected**: found 44/44 "L" floors in the local
    (~25k-apartment) dataset sorting in the wrong position. Wrote Alembic
    migration `c4d5e6f7a8b9` to backfill them (push every "L" floor below its
    building's current minimum sort_order) and ran it against local
    Postgres — confirmed 0/44 wrong afterward, spot-checked live in the
    building detail page's floor list and the apartments grid. **Not yet run
    on Neon prod — do that at deploy time**, same as fixes63's migration.

### §2 Users Module
- [x] Activist email-validation bypass: added a "פעיל ללא גישת התחברות (ללא
  אימייל)" checkbox to the activist creation form (`ContactForm.tsx`, used by
  `/dashboard/contacts/new-shliach`) that turns off the email field's
  previously-unconditional `required`. The backend
  (`_provision_shliach_user` in `routers/contacts.py`) already handled a null
  email gracefully — no login gets provisioned, `ContactShliach.user_id`
  stays NULL — so the form's hard `required` was the only actual blocker.
  Live-verified end-to-end: created a real email-less activist through the
  UI, confirmed `contacts.email`/`contact_shliach.user_id` are both NULL in
  Postgres, then deleted it cleanly.
- [x] Restricted user ("staff" role) viewing "Manager Areas" (אזורי מנהל /
  the AdminArea entity): **already worked — no code change needed.** The
  backend's `GET /api/admin-areas` already depends on `require_staff_or_admin`
  (`routers/admin_areas.py`), and the frontend nav entry
  (`frontend/app/dashboard/layout.tsx`) has no `admin`/`roles` restriction on
  it — only `isShliach`/`isCampaignManager` are excluded. Confirmed via the
  existing `test_fixes9.py` assertion (`auth_headers` = a staff user, expects
  200) plus a live browser session as a temporary staff-role user (saw the
  nav link and a working, read-only admin-areas list).

### §3 PDF Reports Generation
- [x] Header background changed to light grey (was a dark slate
  `[55,65,81]` fill with white text → `[229,231,235]` fill with dark
  `[31,41,55]` text), matching the app's own grey/slate palette elsewhere in
  the doc.
- [x] The column subheading is now a real second header **row**
  (`head: [labelsRow, subheadingsRow]`) instead of a second line crammed into
  the label's own cell — it gets its own (smaller) font size via
  `didParseCell`, sized independently of the label row.
- [x] Header + subheading row repeat on every physical page: verified with a
  synthetic 100-row/3-page report — both rows repeat correctly on pages 2
  and 3, not just page 1.
- [ ] **Address formatting (omit extra whitespace padding for
  `town_house`/`divided_town_house`): not done — couldn't locate the bug.**
  Checked and found nothing: `building_display_name`/`street_part` (backend
  + frontend twins), the PDF's building-header line and its `building`/
  `floor`/`apartment_name` row columns (live-rendered via Playwright and
  pixel-inspected), all 4 import scripts' address construction
  (`f"{street} {number}"` etc.), and every `town_house`/`divided_town_house`
  building's stored `building_address` in the local ~25k-apartment dataset
  (regex-searched for double-spaces/leading-trailing whitespace — zero
  matches). Asked the user how to proceed; decision: **leave it for now**,
  needs a concrete repro (a screenshot, or a specific building/report) before
  it can be picked back up.

### §4 Activist Role Display
- [x] Removed the "Display Order" (סדר תצוגה) and "Delete" (מחק) buttons from
  an activist's (shliach contact_type) own contact detail page
  (`frontend/app/dashboard/contacts/[id]/page.tsx`) — both now gated on
  `contact.contact_type !== "shliach"`, alongside the existing "back to
  contacts" link's own gating right next to them. Live-verified against a
  real existing activist contact (neither button renders).
- **Bonus bug found + fixed while implementing this**: deleting *any*
  shliach-type contact via `DELETE /api/contacts/{id}` was silently broken —
  a 500 (`psycopg2.errors.NotNullViolation` on `contact_shliach.contact_id`)
  from a pre-existing SQLAlchemy relationship-config gap (`Contact.shliach`
  relied on the DB's `ON DELETE CASCADE` but was missing
  `passive_deletes=True`, so SQLAlchemy's own ORM-level delete handling tried
  to NULL a NOT-NULL FK first). Not something this task introduced — just
  never previously exercised by a test. Fixed in `backend/app/models.py`;
  regression-tested in `backend/tests/test_fixes64.py` and confirmed against
  real Postgres (contact + its `contact_shliach` row both gone after delete).

### Tests
- Backend: added `backend/tests/test_fixes64.py` (floor-L-first via both
  `create_building` and `add_floor`; shliach-contact delete with and without
  a login email). Full suite: **534 passed, 0 failed** (530 pre-existing +
  4 new).
- Frontend: `tsc --noEmit` clean.

---

## 1. Single Building Display (`/dashboard/buildings/[id]`)

* **Building Detail View:** Ensure the building display view shows the **Apartment Type** property.
* **Apartment Sorting Fix:**
  * Fix apartment name generation and sorting logic across building dashboards (e.g., `/dashboard/apartments?building_ids=15841`).
  * Enforce standard naming/sorting rule: `{floor_number} {apartment_number}` (handles letter-based floors like A, B, C combined with numeric apartments).
* **Floor Ordering Exception:**
  * Force floor `"L"` (Lobby) to always sort first in the floor hierarchy.

---

## 2. Users Module

* **Activist Email Validation:** Add a toggle/button during activist creation to bypass the mandatory email validation rule (allowing creation without an email address).
* **Restricted User Permissions:** Update access rules to allow users with the `"restricted user"` role to view `"manager areas"`.

---

## 3. PDF Reports Generation

* **Address Formatting:** Omit extra whitespace padding in the formatted address when the building type is `'town_house'` or `'divided_town_house'`.
* **Header Background:** Change the report header background color to light grey.
* **Sub-Header Styling:** Reduce the font size of the sub-header row directly beneath the main header.
* **Page Layout:** Ensure header and sub-header repeat consistently across every page of the generated PDF.

---

## 4. Activist Role Display

* **Button Removals:**
  * Remove the **"Display Order"** button.
  * Remove the **"Delete"** button.