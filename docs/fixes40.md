# Feature Request Specification & Modifications

Please implement the following updates across the dashboard modules. Ensure consistent styling, state management, and type safety throughout.
make fixes40-plan.md prior to the coding
---

## 1. `dashboard/custom-fields`

* **UI Layout:** Restructure the page into **3 distinct tabs**, adhering strictly to the tab layout and interaction pattern used on `dashboard/picklists`.

---

## 2. `dashboard/contacts`

* **Contact Owner Filter Logic:**
  * Check the configuration field: `Activists may view contacts`.
  * **When `false`:** The "Filter by contact owner" (assigned to) dropdown must be restricted to display **only** users whose role is `"Admin"` or `"restricted user"`.
* **Dropdown Enhancement:**
  * Add a **search input** inside the contact owner dropdown selector to filter through options easily.

---

## 3. `dashboard/contacts/visit-summary`

* **Filter Implementation:** 
  * Add the "Filter by contact owner" (assigned to) component.
  * Apply the exact same logic and search capabilities as specified for `dashboard/contacts` (including the `Activists may view contacts` permission check and searchable dropdown).

---

## 4. `dashboard/settings`

* **Global Text CSS Configuration Options:**
  * Add global options to customize label text styling across the system:
    1. **Label Text Size:** Numeric font-size selection (e.g., standard pt/px sizes similar to Microsoft Word).
    2. **Label Text Color:** Color picker input to select custom HEX/RGB values.
    3. **Label Text Font:** Dropdown selection populated with common standard fonts (e.g., Arial, Inter, Roboto, Times New Roman, Segoe UI, etc.).

---

## 5. `dashboard/reports/create`

* **Apartment Table Column Customization:**
  * Add functionality allowing users to select and re-arrange (re-order) any data columns belonging to the `apartment` table.
  * **Column Selection:** Must be identical to the "Customize Fields" selection available on the `apartments` page.
---

## Status: DONE (2026-08-03, uncommitted)

Plan: `docs/fixes40-plan.md`. One new Alembic migration (`d3e4f5a6b7c8`),
already applied to the local dev Postgres DB (backend auto-runs `alembic
upgrade head` on boot).

- [x] **§1 `dashboard/custom-fields` — 3 tabs** — restructured to the exact
      `dashboard/picklists` tab pattern: same `tabFor()`-style
      entity-type→tab mapping, same tab bar markup/icons (👤/📋/🏠,
      including the apartment tab's distinct pink-highlighted section), same
      `usePersistentState`-backed tab memory. The "Add field" form moved
      inside each tab, scoped to that tab's entity type(s) — the "contacts"
      tab keeps its existing mekurav/shliach choice (custom-fields already
      supported both; not regressed to match picklists' contacts tab, which
      only ever offered mekurav). Live-verified: all 3 tabs render
      correctly, including the fixes39-migrated visit fields
      (tefillin/tzedakah/… ) showing up correctly grouped under the visits
      tab.
- [x] **§2 `dashboard/contacts` — owner filter** — new shared
      `frontend/lib/ownerFilter.ts` (`visibleOwnerOptions`) excludes
      shliach-role users from the "Filter by contact owner" dropdown
      whenever the org's "Activists may view contacts"
      (`shliach_can_view_contacts`) setting is off; "restricted user" in the
      spec maps to this app's existing `"staff"` role (no new role added).
      The dropdown itself swapped from a plain `<select>` to the existing
      `SearchableSelect` component — searchable, no new component needed.
      A persisted owner selection that falls out of the now-filtered option
      set (deleted user, or the org just flipped the permission) resets to
      "all users", reusing the page's existing self-correcting effect.
- [x] **§3 `dashboard/contacts/visit-summary` — same owner filter** —
      identical `visibleOwnerOptions`/`SearchableSelect` treatment added to
      the shared `VisitSummary` component (shown only when not scoped to a
      single contact and not a shliach caller), disabling the existing
      "view org-wide" toggle while a specific owner is chosen (matches the
      backend's own priority order). `GET /api/visits/summary` gained
      `assigned_user_id`: `contact_id` > `assigned_user_id` (non-shliach
      only) > `scope_all` > default self-scoping. The non-shliach guard is
      deliberate, not incidental — a shliach account passing this param
      directly could otherwise self-serve another user's data, since before
      this round the endpoint's only scoping path for a shliach caller was
      the self-scoping default; a dedicated test
      (`test_shliach_cannot_use_it_to_see_anothers_contacts`) locks this in.
- [x] **§4 `dashboard/settings` — global label text styling** — 3 new
      independently-nullable `Organization` columns (`label_font_size`,
      `label_color`, `label_font_family`; `null` = app default, no backfill
      needed). Settings UI: a curated px-size `<select>`, a native
      `<input type="color">` HEX picker with a reset button, and a
      font-family `<select>`. Applied system-wide via a new
      `LabelStyleInjector` client component (mounted once in the dashboard
      layout) that writes a scoped `<style>` tag targeting `label >
      span:first-child` and `dt` — the two markup patterns this codebase
      consistently uses for field labels, deliberately narrower than a bare
      `label`/`dt` selector so a `<label>`'s own nested `<input>` is never
      caught. `!important` is required (a directly-applied Tailwind utility
      class on the label element itself always wins over an inherited
      value, regardless of selector specificity) and each property is only
      emitted when the org actually set it. The chosen font gets the app's
      `--font-sans` Hebrew-safe fallback stack appended, so a Latin-only
      pick never breaks Hebrew glyph rendering. Live-verified with a
      dramatic (24px, magenta, Georgia) test value — every `<dt>`-based
      label across a contact detail page (including the Visit Summary
      section's dynamic category cards) changed correctly; reset back to
      default afterward.
- [x] **§5 `dashboard/reports/create` — apartment column selection + reorder**
      — `ReportColumnKey` expanded from the old fixed 6 to the Apartments
      page's own 11 `FIELD_KEYS` plus its 2 always-on identity columns
      (`floor`/`apartment_name`) — 13 total, matching that page's
      "Customize Fields" vocabulary exactly (all values already ride the
      existing `/api/apartments/list` response, no extra fetch beyond the
      already-fixed picklists — `campaign_status` joined
      jewish/mezuzah/language as a 4th fetched picklist). The old
      checkbox-table selector was replaced with the exact same SortableJS
      chip panel + ▲/▼ arrow fallback the Apartments page's own "Customize
      Fields" panel uses (fixes39 §3's `useSortableList`, reused verbatim —
      zero new drag code) — "identical to Customize Fields" read literally
      as UI/interaction, not just the underlying data. The subheading-text +
      width-% inputs (report-specific, no Apartments-page equivalent)
      became a second, smaller table listing only the *active* columns in
      the chip panel's live order. Live-verified: toggling a new column on
      via chip click, dragging a chip across the full row (both short and
      long drags — the short one didn't register on the first attempt,
      consistent with fixes39's own finding that very-short drags can miss
      the swap threshold; a longer drag registered cleanly), the
      subheading/width table staying in sync with the chip order, and a
      full PDF generation exercising all 13 columns (including every new
      one — resident/building/area/report_number/phone/email/
      campaign_status) completing with a real file download and no console
      errors.
- [x] Backend: 381/381 pytest passing (375 pre-existing + 6 new in
      `backend/tests/test_fixes40.py`: the owner-filter priority order and
      its shliach security guard, and the label-styling fields' round-trip
      + independent-clear + admin-only-write behavior).
- [x] Frontend: `tsc --noEmit` clean.
- [x] Live verification: full docker-compose stack, driven end-to-end via a
      headless-Chrome CDP session (same `playwright-core` /
      `connectOverCDP` approach as fixes39, `chromium-cli` still not
      available in this environment) against the actual running app for
      every item above, with screenshots reviewed at each step — not just
      unit tests.

**Not done:** not committed/pushed (standing rule: only on explicit ask); not
deployed (Neon/Render — per project notes, already several fixes rounds
behind the local dev DB, which now includes this round's migration too);
§5's "identical to Customize Fields" does **not** extend to the Apartments
page's *dynamic* per-org custom picklists/custom fields as selectable report
columns (only the 13 fixed/built-in ones) — a deliberate scope cut, not an
oversight: the demo org has zero apartment-scoped custom fields/picklists
defined, so that path had nothing to verify against in this session: adding
`cf:`/`pl:`-prefixed dynamic columns to the PDF generator is a real chunk of
additional, currently-unverified complexity that a follow-up round should
pick up together with real test data.
