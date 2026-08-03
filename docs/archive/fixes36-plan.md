# fixes36 plan

## Root cause (both issues share one bug)

`ContactView.tsx` (and, identically, `ContactForm.tsx` and `contacts/page.tsx`) fetch
`GET /api/picklists` and treat **any** definition not explicitly excluded as an
"admin-added custom contact picklist" to auto-render inside the contact's core
fields (`customDefs` fallthrough, gated by `FIXED_CONTACT_PICKLIST_KEYS` plus a
handful of foreign-entity prefix exclusions: `apartment.`, `visit.`,
`checklist.`, `interaction.`, `shliach.`).

Two registered picklist_defs slip through that fallthrough and get rendered a
second/bogus time in the contact detail core-fields section:

1. **`contact.contact_type`** — already has its own dedicated, always-shown
   entry in `ContactView`'s `fields`/`shliachFields` arrays (label "סוג איש
   קשר" / "Contact Type"), but it's missing from `FIXED_CONTACT_PICKLIST_KEYS`
   (`frontend/lib/picklists.ts`), so it also lands in `customDefs` and renders
   **again** inside `mekuravFields`. → duplicate "Contact Type".

2. **`significant_date.type`** — a picklist belonging to the `significant_dates`
   entity (Hebrew label "סוג תאריך", English label "Date type"), already
   rendered correctly inside `SignificantDatesEditor` via its own dedicated
   `usePicklist("significant_date.type")` call. It has no `apartment./visit./
   checklist./interaction./shliach.` prefix, so it isn't excluded, and it
   isn't in `FIXED_CONTACT_PICKLIST_KEYS` either (it's not a contact field at
   all) — so it also falls into `customDefs` and renders as a bogus
   contact-level "Date type" field. → field that doesn't belong to
   `Contact_mekurav` leaking onto the page.

Note: the admin Picklists page (`app/dashboard/picklists/page.tsx`) already
groups `significant_date.*` under its "contacts" tab on purpose (fixes33) —
that's the management UI and stays as-is. This bug is specifically the
contact-record *display* fallthrough treating it as a contact field.

## Fix

1. `frontend/lib/picklists.ts`: add `"contact.contact_type"` to
   `FIXED_CONTACT_PICKLIST_KEYS`. This constant is the single shared source
   used by `ContactView.tsx`, `ContactForm.tsx`, and `contacts/page.tsx`, so
   this removes the duplicate everywhere consistently (detail view, add/edit
   form, list page's dynamic picklist filters/columns) rather than only in
   one spot.
2. In the same three `customDefs`/`customPicklistDefs` filters (`ContactView.tsx`,
   `ContactForm.tsx`, `contacts/page.tsx`), add
   `!d.field_key.startsWith("significant_date.")` alongside the existing
   foreign-entity exclusions, so that picklist stops leaking into the
   contact-field fallthrough anywhere it's used.
3. No backend/schema change — both picklist_defs stay valid and manageable
   from the admin Picklists page; only the frontend "is this a generic
   contact field" heuristic changes.

## Verification

- `tsc --noEmit` in the frontend container (per project rule: dev mode hides
  build-breaking TS errors).
- Headless-drive check on a mekurav contact's `/dashboard/contacts/[id]` page:
  "Contact Type" (סוג איש קשר) appears exactly once; "Date type" (סוג תאריך)
  does not appear anywhere in the core fields section.
- Spot-check the add-contact form and the contacts list page's custom
  picklist filter/column dropdowns no longer offer "Date type" either.
- `pytest` in backend as a sanity net (no backend changes expected to affect
  it).
