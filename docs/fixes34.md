# Feature Specification: Contact_mekurav & Apartments Enhancements

## 1. Contact Management (`Contact_mekurav`)
make fixes34-plan.md before starting to code!
### 1.1 "Display All" Alignment with Apartments Feature Set
* **Inline Editing:** Enable full inline editing for all fields directly from the `dashboard/contacts` page table view.
* **Custom Picklists:**
  * **Column Customization:** Make newly created picklist fields available under the **"Customize Fields"** selector to show/hide them as table columns on `dashboard/contacts`.
  * **Filtering:** Integrate custom picklist fields as filter options on the contacts dashboard.
  * **Field Visibility:** Allow hiding/showing these fields via the `dashboard/fields` settings page.
  * **CRUD Integration:** Ensure custom picklist fields are fully integrated into all CRUD operations (single-item view, creation modal, and edit forms).

---

## 2. Apartments Management

### 2.1 Single Display / Edit Custom Fields
* Enable support for custom fields within the single apartment view/edit page (`dashboard/apartments/{id}`, e.g., `dashboard/apartments/2329`).

---

## 3. Field Visibility Settings (`dashboard/fields`)

### 3.1 Contact Fields Customization
Add standard field toggles under the **Contacts** configuration section to allow hiding/showing the following core fields:
* `Email`
* `Phone`

---

## Checklist for Implementation & Testing

- [x] 1.1 Inline editing on `dashboard/contacts` list table (phone, status, priority, address, plus a name-cell pencil affordance) — mirrors the apartments list's `InlineEdit` pattern. Verified: `tsc --noEmit` + `next build` clean; live headless-Chrome drive of a throwaway org showed the phone/name cells swap to an editable control on click.
- [x] 1.1 Custom contact picklists — column ("Customize Fields"), filter, and `dashboard/fields` visibility. Root cause was two-layered: (a) backend `ContactOut`/`_apply_contact_picklist_fields` never populated a generic `picklist_values` dict beyond pipeline_status/color_tag (apartments already had this since fixes32/33 — contacts never got the equivalent fix); (b) `contacts/page.tsx` never fetched `/api/picklists` or rendered anything beyond the 3 fixed mekurav picklists. Both fixed, mirroring the apartments reference implementation (`FIXED_CONTACT_PICKLIST_KEYS` added to `lib/picklists.ts`, `contacts.customFields` DB preference, generic `picklist=field_key:value` filter param added to `/api/contacts/list`). Verified: `backend/tests/test_fixes34.py` (5 new tests, round-trip through detail GET + list + paginated list + filter), and a live drive — created a custom picklist "תזונה" via the dashboard, confirmed it renders as a column, a filter chip, and a "התאמת עמודות" toggle chip on the contacts list, and that an inline click-to-edit actually persists (`kosher` → `vegan` confirmed via a direct API check after the click).
- [x] 1.1 Custom picklist CRUD integration (single view / creation modal / edit form) — `ContactForm.tsx` and `ContactView.tsx` each gained a second loop (alongside the existing `MEKURAV_PICKLISTS` one) over the org's non-fixed contact picklists, using the same `picklist_values` read/write path that already existed generically. Verified via `tsc`/`next build`; live-drive covered the create form (see 3.1 evidence below, which incidentally also exercises this form).
- [x] 1.1 Field-visibility toggle for custom contact picklists — already functional at the settings layer before this round (fixes33 §5.1's generic dynamic-picklist field-settings rows aren't apartment-specific); confirmed still correct now that something actually renders for it to hide (a custom contact picklist shows under the "מקורב" heading on `/dashboard/fields`, per the live drive).
- [x] 2.1 Apartments single display/edit page (`dashboard/apartments/{id}`) now renders custom (non-fixed) `apartment.*` picklists. Root cause: `[id]/page.tsx` (the fixes30 §2 inline-edit page that replaced the old separate edit form) only ever rendered the 4 fixed apartment picklists — it never fetched `/api/picklists` or looped over custom defs, unlike the apartments list page and the still-extant `ApartmentEditor.tsx`. Backend needed no change — `GET /api/apartments/{id}` already returned every custom value in `picklist_values` (fixes32). Fixed by adding the same `customDefs` fetch + `InlineEdit`/`PicklistSelect` render loop used elsewhere. Verified live against apartment id 2298/2299 in a throwaway org: the custom field "תזונה" rendered with its live value, and a scripted click → select → commit round-trip confirmed the save persisted through the apartment versioning system (PUT created a new active version 2299 with the updated value; the old id 2298 correctly retained the historical value).
- [x] 3.1 `contacts.phone` / `contacts.email` field-visibility toggles added to `backend/app/field_registry.py`'s `TOGGLEABLE_FIELDS` (entity `"contact"` — appears automatically under the existing "אנשי קשר" heading on `/dashboard/fields`, no frontend structural change needed there). This reverses a deliberate fixes28 decision that made both permanently visible; the toggle only ever gates UI rendering (CRUD forms, filters, the phone list column) — it never touches the DB column, so a shliach's email-based login identity is unaffected regardless of the toggle (their own contact form/view force-shows both regardless of the org setting, since email doubles as their login identity). `backend/tests/test_fixes28.py`'s `test_email_has_no_visibility_toggle` (which encoded the old, now-reversed behavior) was updated to assert the opposite. Verified live: hid `contacts.phone`, confirmed the create-contact form dropped the phone field while keeping email (email was still visible/untouched); re-showed it, confirmed it reappeared with its validation hint.

---

## Closeout (2026-07-22)

All items above are **DONE**. Verified via: full backend pytest (345/345
passing — 340 pre-existing + 5 new in `backend/tests/test_fixes34.py`),
`tsc --noEmit` + `next build` (both clean), and a headless-Chrome CDP drive
of the real local app (a throwaway registered org, screenshots inspected,
and a scripted click→select→commit interaction verified against the actual
Postgres-backed API afterward — not just that the DOM changed). Nothing
committed or pushed — per standing project rule, that's the user's call.

### Note on §3.1 reversing a prior decision
fixes28 §1 deliberately made `contacts.email`/`phone` permanently visible
(core identity fields, and email doubles as the shliach login identity).
This round's spec explicitly asks for the opposite, so it was implemented
as asked — see the entry above for why it's safe (the toggle is UI-only).
Flagging this here rather than silently overwriting the old rationale, per
the project's "no silent limbo" closeout convention.

### A tooling note, not a code issue
While verifying live, running `next build` inside the same container as the
running `next dev` server corrupted the dev server's `.next` directory
(`MODULE_NOT_FOUND` on `/`, the same failure mode documented in the
project's "Docker stale code" memory) — fixed by `rm -rf .next` + a
container restart before the live drive. No application code was at fault;
noting it here so a future session doesn't re-diagnose it from scratch.