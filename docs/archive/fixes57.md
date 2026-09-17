### Apartments Updates

* **Filter Names:** When selecting filter checkboxes, display the filter name so it remains visible after selection.
  - [x] DONE. `MultiSelectFilter`/`MultiSelectSearchFilter` already gained an
        optional `label` prop in fixes56 §3 (button reads "Area: North"
        instead of collapsing to just "North" once checked); this round wires
        it up on every apartments-page filter that didn't have it yet: Area,
        Building, Report Number, Jewish status, Mezuzah status, Language, and
        every admin-added custom picklist filter. Verified live: selecting a
        value shows e.g. "יהדות: (ריק) -" on the button, not just the bare
        selected value.

* **Filter Reset / "Nothing" Option:** Add a `-` (nothing) option to all filters to allow clearing or selecting empty states.
  - [x] DONE for every filter whose value can genuinely be blank: Area,
        Report Number, Jewish status, Mezuzah status, Language, and every
        custom apartment picklist. Skipped **Building** on purpose —
        `apartment.building_id` is mandatory (every apartment always belongs
        to exactly one building), so a "no building" state can't exist.
  - Backend: `picklist_utils.unassigned_entity_ids()` (new) finds entities
    with no stored value at all for a field; `apartments.py::_picklist_filter`
    now ORs that in whenever `EMPTY_FIELD_SENTINEL` is among the selected
    values (reuses the same sentinel the custom-field "ריק" checkbox already
    used, fixes53 §2). Area/Report-Number use a `0` sentinel instead (real
    ids start at 1) via a new small `_id_or_null_filter()` helper, since
    they're plain nullable FK columns, not PicklistLink-backed.
  - Also fixed the client-side area↔building cross-filtering (`visibleBuildings`,
    `onAreasChange`) to understand the `0`/"no area" sentinel, so picking "-"
    for Area correctly surfaces buildings that have no area assigned instead
    of silently hiding all of them from the Building filter's own options.
  - Verified live end-to-end: selecting "-" under Jewish status returned only
    apartments whose Jewish-status column renders "-" (no value) — confirmed
    via a real screenshot of the filtered grid, not just the request/response.

* **Direct Data Links:** On the main page, convert any displayed data (e.g., new contact pages) into direct clickable links to view that data.
  - [x] DONE. The apartments grid's own contact/resident column was already a
        clickable link to `/dashboard/contacts/{id}` (fixes26-era work) — no
        gap there. The actual gap was the admin **dashboard's** "Recent
        Jewish-status changes" widget (`AdminDashboardHome.tsx`): each row
        already carried `apartment_id` but rendered its label as plain text.
        Wrapped it in a `Link` to `/dashboard/apartments/{apartment_id}`.
        Verified live: with the date range widened to 90 days (the local
        dataset had no changes in 30), clicking a row navigated correctly to
        that apartment's detail page.

* **Collapsible Menu:** Enable a menu toggle/collapse feature similar to the mobile app interface.
  - [x] DONE. The sidebar already had a full open/close drawer on mobile
        (`Sidebar`'s `open`/`onClose`, `lg:hidden` hamburger) but was
        permanently forced visible on desktop with no way to hide it.
        Added an independent `desktopCollapsed` state (persisted via
        `usePersistentState("crm.sidebarCollapsed", …)`), a new header
        toggle button visible only at `lg:` and up (mirrors the mobile
        hamburger, which stays `lg:hidden`), and made the content area's
        `lg:mr-64` margin conditional so it reclaims the full width when
        collapsed. Mobile's own drawer logic is untouched. Verified live:
        toggling hides the sidebar completely and the content reflows to
        fill the freed width; toggling again brings it back.

---

## Verification
- TypeScript: `tsc --noEmit` clean after every change.
- Backend: all 70 apartment-related pytest tests pass (`-k apartment`); no
  test files were touched by this round.
- All 4 items verified live against the local Docker stack (real login,
  real screenshots/DOM checks), not just code review — see notes above.
