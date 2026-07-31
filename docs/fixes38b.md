# Feature Request & Bug Report Summary

## 1. Manage Fields – Hidden Fields Issue
* **Location:** Manage Fields $
ightarrow$ Hide Fields
* **Issue:** The **"Created On"** field continues to appear even after it has been explicitly marked as hidden.
* **Expected Behavior:** Marking "Created On" as hidden should strictly hide it from the view/interface.

---

## 2. Mekurav Section – Show / Hide Entity Mix-up
* **Location:** Mekurav Section $
ightarrow$ Show / Hide Settings
* **Issue:** It is currently unclear which entity the **Mivtzoim fields** belong to. There is a mix-up where Mivtzoim fields are currently listed/grouped under **Contact**.
* **Expected Behavior:** 
  * Reassign and display all **Mivtzoim fields under the Visit entity** (not under Contact).
  * Ensure clear UI categorization showing which entity controls which fields.

---

## 3. Additional Fields – Missing Entity Identifiers
* **Location:** Manage Fields $
ightarrow$ Additional Fields
* **Issue:** "Additional fields" do not clearly display or indicate which entity they belong to.
* **Expected Behavior:** Clearly show/label the associated parent entity (e.g., `Contact`, `Visit`) next to each additional field item.

---

## Status: DONE 2026-07-31, UNCOMMITTED (user committing separately)

Initially misdiagnosed this as a stale-production/Render-suspended issue —
that was wrong (traced to a stale archived doc referencing an abandoned
Render service URL, not the real one). Corrected by extracting the actual
backend URL from the live Vercel JS bundle
(`https://minicrm-1-phw9.onrender.com`, confirmed up) and reproducing all
three bugs directly against the real, working production site with a
throwaway test account — not just localhost.

- [x] **#1 "Created On" hide not respected** — root cause: two separate
      pages independently rendered this column without ever checking the
      `contacts.created_at` field-visibility setting at all (only the
      contact detail page's row, fixed earlier today, actually respected it):
      - `frontend/app/dashboard/contacts/page.tsx` — the list page's optional
        "created" grid column had `availability.created` hardcoded to `true`.
        Now `vis("contacts.created_at")`.
      - `frontend/app/dashboard/shluchim/page.tsx` — the activists list
        rendered its own unconditional "נוצר בתאריך" column/cell with no
        visibility check at all. Now gated behind the same toggle
        (header + cell + colSpan adjusted).
      - Confirmed live on production: hid the field via the API, both list
        pages still showed the column before the fix; after the fix
        (verified locally, not yet deployed) both correctly hide it.
      - Deliberately did **not** touch `/dashboard/users` — it reuses the
        same `contacts.created_at` *label text* for an unrelated column (a
        login user's own creation date, not a contact's), so gating it by
        the contacts toggle would incorrectly conflate two different
        entities that only happen to share a translation string.
- [x] **#2/#3 Additional Fields entity mix-up** — the Mivtzoim system fields
      themselves were already correctly grouped under "Visits" (confirmed via
      `/api/field-settings`, `entity: "visit"` on every one). The actual bug:
      `frontend/app/dashboard/fields/page.tsx`'s `CustomFieldsSection`
      ("שדות נוספים") independently fetched and flat-listed **every** custom
      field across **every** entity with zero entity labeling — reproduced
      live on production by adding a visit-scoped and a contact_mekurav-scoped
      custom field and confirming both rendered identically, side by side,
      indistinguishable. Fixed by grouping that list by `entity_type` with a
      visible sub-heading per group (reusing the same `ENTITY_GROUPS` labels
      already used for the built-in fields above it on the same page, and
      the same grouping pattern `/dashboard/custom-fields` already used).
- [x] `tsc --noEmit` clean.
- [x] Re-verified against the real production site (not localhost) with a
      throwaway test account: reproduced all three bugs as described before
      the fix was in place, confirming this is a genuine code gap and not a
      deployment/staleness artifact.

**Not done:** not yet committed/pushed (user is committing this round
themselves, per their usual workflow this session) or deployed. A leftover
throwaway test org ("Prod Check", plus two throwaway custom field
definitions) was created directly on production for verification — flagged
to the user, left in place pending their call on whether to remove it.
