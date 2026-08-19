# fixes50 — implementation plan

Written before any code changes, per the spec's "make plan file first" instruction.
Source spec: `docs/fixes50.md`.

## §1.1 `dashboard/fields` — Visit tab hide/show for location + visit type

**Reading:** `backend/app/field_registry.py`'s `TOGGLEABLE_FIELDS` only has one
`entity="visit"` row today (`visits.torah_thought`) — `location` (a plain
`VisitHistory.location` column) and `visit_type` (picklist-backed via
`PicklistLink`, `visit.type`) are always rendered, in `VisitDetails.tsx`,
`VisitForm.tsx` and (for `visit_type` only) `VisitHistoryEditor.tsx`'s
collapsed row.

**Plan:**
- Add `("visits.location", "visits.location", "visit")` and
  `("visits.visit_type", "visits.visit_type", "visit")` to `TOGGLEABLE_FIELDS`
  (both default-visible — no entry in `DEFAULT_HIDDEN`).
- Gate the location/type `dt`+`dd` block in `VisitDetails.tsx` and the
  matching `<label>` block in `VisitForm.tsx` behind
  `vis("visits.location")` / `vis("visits.visit_type")`.
- Gate the type chip + `📍 location` span in `VisitHistoryEditor.tsx`'s
  collapsed row the same way (it already imports nothing field-settings
  related — add `useFieldSettings`).
- New localization keys `visits.location` / `visits.visit_type` aren't
  needed — `t("visit.location", …)` / `t("visit.type", …)` already exist;
  the registry's `label_key` just needs to resolve to a readable string in
  the Fields page, so reuse those existing keys as the `label_key` (matches
  how `visits.torah_thought` already reuses `visits.torah_thought` — for
  location/type there's no exact existing `visits.*` key, so add 2 tiny new
  LOCALIZATION rows `visits.location` / `visits.visit_type` mirroring the
  Hebrew/English of `visit.location` / `visit.type` — keeps the Fields page
  row label distinct from the on-page field label key namespace like every
  other `visits.*` registry entry).

## §1.2 `dashboard/fields` — numbering input / ordering bug

**Reading:** the backend (`routers/field_settings.py`) already persists
`sort_order` correctly for all three row kinds (built-in `FieldSetting`,
`PicklistDefinition`, `CustomFieldDefinition`) — verified by reading the
PUT handler in full. `lib/fieldSettings.tsx` already exports
`sortByFieldOrder`, used by `ContactView.tsx`/apartment views to *apply* the
configured order everywhere the field actually renders. But
`app/dashboard/fields/page.tsx`'s own `renderRows()` never calls it — the
admin's own management page lists rows in raw registry/API order regardless
of what number they type in. Typing "1", "2", "3" into the order inputs
saves correctly (confirmed via the PUT handler + refresh cycle) but the admin
never *sees* it take effect on the one page meant to demonstrate it — reads
as "the numbering doesn't do anything." This also directly covers "sort
custom fields ascending" since custom fields/picklists are ordinary rows in
the same `tabFields` list.

**Plan:** in `page.tsx`, sort `group` (and the flat `tabFields` used by the
single-entity tabs) with `sortByFieldOrder(group, (f) => f.field_key,
orderFor)` before calling `renderRows`. No backend change.

## §2.1 `dashboard/contacts/[id]` — label/value contrast

**Reading:** every field label in `ContactView.tsx` is a bare
`<dt className="text-xs text-gray-500">`, indistinguishable in weight from
the `<dd>` value directly under it. The spec explicitly offers two options
(pill/border on the label, or a bordered "frame" like Mivtzoim uses) — a
per-field pill reads better here since the ask is about *label-vs-value*
contrast, not section grouping (the frame pattern groups a whole section,
which already exists elsewhere and isn't what's being asked for).

**Plan:** change every `<dt>` in `ContactView.tsx` (main grid + shliach
areas/report_numbers/notes/password rows) to a small pill:
`inline-block w-fit rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium
text-gray-500`. Same treatment applied to `VisitDetails.tsx`'s `dt`s since
they render inline on the same page (segment "visits") and would look
inconsistent left unstyled.

## §2.2 `dashboard/contacts/[id]` — cap visit history to 7

**Reading:** `VisitHistoryEditor.tsx` fetches `/api/contacts/{id}/visits`
(already sorted `visit_date desc` server-side) and renders every row with no
limit.

**Plan:** frontend-only. Add `visibleCount` state (default 7); render
`visits.slice(0, visibleCount)`; when `visits.length > visibleCount` show a
"הצג עוד" button that bumps `visibleCount` by 7 (simple reveal-more, no new
endpoint/pagination — the full list is already in memory).

## §3.1 `dashboard/contacts/visit-summary` — show all dates

**Reading:** `VisitSummary.tsx` always sends `date_from`/`date_to`
(defaulted to the current week) — `visits_summary` in
`routers/visits.py` declares both as required `datetime.date` query params,
and the frontend effect bails out entirely (`if (!dateFrom || !dateTo)
return;`) if either is empty, so there's currently no way to ask for
"every visit ever."

**Plan:**
- Backend: make `date_from`/`date_to` `Optional[datetime.date] = None` on
  `visits_summary`; skip the date filter clause(s) for whichever side is
  missing (open-ended range) instead of requiring both.
- Frontend: add a prominent "הצג את כל התאריכים" toggle button next to the
  date pickers. When active, it clears `dateFrom`/`dateTo` to `null`,
  disables (greys out) the two date pickers, and the fetch effect sends the
  request with no date params instead of bailing out. New localization row
  `visitsummary.all_dates`.

## §3.2 `dashboard/contacts/visit-summary` — "All users" filter bug

**Reading (the ambiguous one — documenting the reasoning):** the owner
filter's empty/placeholder state literally means "All users" (`t("filter.
all_users")`), shown to both admin and staff (`showOwnerFilter = contactId
== null && !isShliach`). But actually widening the query past "my own
assigned contacts" is currently a *second*, separate control — the
`scope_all` checkbox — and it's admin-only both in the UI
(`contactId == null && isAdmin`) and in backend authorization
(`current_user.role == "admin" and scope_all`). A staff user therefore has
no way at all to get an aggregate "everyone" view: picking the "All users"
placeholder from the dropdown does nothing beyond what leaving it untouched
already does, and there's no checkbox for them to reach for instead.

I confirmed via `backend/tests/test_fixes38.py`
(`test_standard_user_scoped_to_assigned_contacts`,
`test_admin_default_scope_is_also_assignment_based`) that "self-scope by
default for both staff and admin" is an intentional, already-tested
contract from fixes38 — NOT what's broken here, and not something this
round should change. What's missing is symmetry with the already-existing
`assigned_user_id` param, which fixes40 deliberately opened up to
`current_user.role != "shliach"` (i.e. staff can already look up any *one*
other specific user's visits) — the all-at-once widening never got the same
treatment and stayed admin-only, which is the gap "selecting … All users
fails" is describing.

**Plan:**
- Backend: broaden the scope_all condition in `visits_summary` from
  `current_user.role == "admin" and scope_all` to
  `current_user.role != "shliach" and scope_all` (mirrors the
  `assigned_user_id` branch immediately above it, same file).
  Default self-scope (no params) is untouched — still applies to anyone
  who doesn't pass `scope_all` or `assigned_user_id`, admin included.
- Frontend: show the checkbox to staff too — change its guard from
  `contactId == null && isAdmin` to `contactId == null && !isShliach`.
  Label unchanged ("הצג את כל הביקורים בארגון" already reads fine for
  staff).
- No test in `test_fixes38.py`/`test_fixes40.py` asserts scope_all is
  admin-exclusive at the API layer (only the UI hid the control) — so this
  doesn't regress a locked contract, it closes a gap the existing tests
  never covered either way.

## §3.3 Nav active-state bug (Contacts vs. Visit Summary)

**Reading — confirmed, literal bug:** `NavMenu.tsx` marks an item active
via `pathname === it.href || pathname.startsWith(it.href + "/")`. Both
"Contacts" (`/dashboard/contacts`) and "Visit Summary"
(`/dashboard/contacts/visit-summary`) live in the same `peopleItems` group
(`dashboard/layout.tsx`). On `/dashboard/contacts/visit-summary`:
`pathname.startsWith("/dashboard/contacts/")` is true, so **both** items
(and the group button) light up — the prefix rule meant to catch detail
routes (`/dashboard/contacts/123`) also catches a sibling nav item whose
href happens to nest under another item's href.

**Plan:** in `NavMenu.tsx`, compute a match length per item
(`pathname === href ? href.length : pathname.startsWith(href + "/") ?
href.length : -1`), take the max across all items in the menu, and only mark
the item(s) achieving that max as active (same value feeds `groupActive`).
General fix (not a hardcoded `visit-summary` exclusion) — also correctly
keeps "Contacts" active for real contact-detail routes since nothing else
in the group matches those paths.

## §4.1 `dashboard/users` — custom fields not rendering

**Reading:** static trace of the whole data pipeline (`fetchAllShliachContacts`
→ `/api/contacts/list?contact_type=shliach` → `_list_item` →
`_custom_field_map_bulk`/`_apply_contact_picklist_fields` → `ContactOut.
picklist_values`/`custom_field_values` → `shliachContactsById` →
`inlineShliachPicklistCell`/`inlineShliachCustomFieldCell`) found no defect —
confirmed live: a brand-new org with a boolean (`chanukah`) and a select
(`status_married`) `contact_shliach` custom field, values set via the normal
contact PATCH, rendered correctly on `/dashboard/users` out of the box.

**Root cause (found live, reproduced with Playwright):** `isGridColumnActive`
for a picklist/custom-field column read `visibleShliachPicklistKeys ==
null || visibleShliachPicklistKeys.includes(entry.key)` — an *inclusion*
list. The moment an admin hides even one such column, `useDbPreference`
writes a concrete array (`toggleShliachPicklistColumn`/`toggleShliachField
Column`: `current = prev ?? shliachPicklistDefs.map(d => d.field_key)`,
i.e. "everything that existed at that moment, minus the one just hidden").
Any custom field/picklist created **after** that point is never a member of
that frozen array, so `.includes(entry.key)` is false and it silently
defaults to hidden — appearing only in the inactive/available chip list,
which an admin has no reason to check after adding a brand-new field.
Reproduced exactly: created field A, toggled column state once (locking the
array), created field B afterward — B's chip rendered in the *inactive*
style and never appeared as a table column, even though `/api/custom-fields`
and `/api/contacts/list` both carried its definition and value correctly the
whole time. This is a real, silent "data mapping and UI rendering" bug, not
a data problem — matches the spec's wording exactly.

**Plan (implemented + live-verified):** flip the stored preference from an
opt-in *visible* list to an opt-out *hidden* list, so a field absent from
the array means "never hidden" (visible), matching how every other column
already behaves by default. Renamed the preference keys
(`users.shliachPicklists` → `users.shliachPicklistsHidden`,
`users.shliachCustomFields` → `users.shliachCustomFieldsHidden`) so a
pre-existing "visible" array from before this fix is never misread as a
"hidden" array under the new semantics — worst case an admin's previously
hidden custom column re-appears once and they hide it again, no data loss.
Scoped to `dashboard/users/page.tsx` only, per the spec's section heading —
the Contacts page's `visibleCustomPicklistKeys`/`visibleCustomFieldKeys`
carries the identical latent bug shape but is out of scope for this round;
worth a follow-up if the user wants it addressed there too.

Verified live (Playwright, headless Chromium): reproduced the stale-list
scenario end to end, confirmed the new field showed up hidden before the
fix and visible after: it rendered both in the "Customize Columns" panel (active pink
chip) and as a real table header/column with the correct value, and that
explicitly hiding a column afterward still works and survives a reload.

## Cross-cutting

- Every new Hebrew UI string gets a `LOCALIZATION` row in
  `backend/app/seed.py` (idempotent seeding).
- `tsc --noEmit` + `pytest` + a live Chrome drive (Playwright, per the
  project rule to use its bundled Chromium rather than the user's real
  profile) before calling this done.
- `docs/fixes50.md` gets closed out per-checkbox with evidence once
  verified.
