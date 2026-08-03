# Feature Requirements & Technical Specification

Please implement the following system modifications, authentication enhancements, and UI updates across the dashboard and superadmin features.
make fixes40-plan.md before code
---

## 1. Superadmin Authentication & Routing Fix

* **Issue:** Logging in with `superadmin` credentials routes to the regular system dashboard, rendering the main administrative system unreachable.
* **Requirements:**
  1. Fix the authentication/routing logic so logging in as `superadmin` successfully redirects to the Superadmin Management interface.
  2. **Environment Variables:** Extract superadmin credentials into `.env` configuration variables (`SUPERADMIN_USERNAME`, `SUPERADMIN_PASSWORD`) so they can be set via Render environment configuration.

---

## 2. Multi-Organization Login & Post-Login Redirection

### A. Dual Account / Organization Selection
* **Scenario:** A user email exists twice across the system (e.g., as an **Organization Admin** in one organization and a **Shliach** in another organization).
* **Requirements:**
  1. Upon successful credential verification, if multiple accounts/organizations match the email address, display an intermediate account selection screen showing all associated roles/organizations.
  2. Once the user selects their target profile/organization, establish the session bound to that specific organization context.

### B. Deep-Linking / Post-Login Redirect
* **Requirement:** If an unauthenticated user attempts to access a protected URL (e.g., `/dashboard/contacts/247`), intercept the request, redirect them to `/login`, and upon successful authentication, automatically redirect them back to their original target URL.

---

## 3. `dashboard/fields` Layout & Ordering Configuration

1. **Tabbed Layout:** Reorganize the page into **3 distinct tabs** (matching the tab pattern used in `dashboard/custom-fields` and `dashboard/picklists`).
2. **Remove Unnecessary Section:** Remove the standalone `"Additional fields"` section completely (these custom fields are already rendered within their respective context sections such as Contact, Apartment, etc.).
3. **Field Order Input:** For each field entry in every section (**Contact**, **Apartment**, **Visit**), add a numerical input field to specify display order.
4. **Validation:** Add validation to ensure order numbers are **unique within each section** (no duplicate order numbers allowed).
5. **Ordering Logic:** Use these numerical values to dictate the dynamic visual layout order across single entity pages.

---

## 4. Entity Detail Page Display Ordering

Ensure fields and UI components are sorted in ascending numerical order (**lowest number first**, e.g., `1, 2, 3...`):

### A. Single Contact Page (`/dashboard/contacts/[id]`)
* **Contact Details Section:** Display contact details fields sorted by their configured field order number.
* **Summary of Visits Section:** Sort and display summary boxes according to their configured field order number.
* **Visit Details:** Apply the exact same field ordering logic to individual visit records/forms.

### B. Single Apartment Page (`/dashboard/apartments/[id]`)
* Display all apartment detail fields ordered strictly by their configured field order number (lowest first).

---

## Status: DONE (2026-08-03)

389 backend tests passing (`test_fixes40b.py` new, +8), frontend `tsc --noEmit`
clean, all 4 items live-drive verified via CDP/playwright-core against the
local docker-compose stack.

- [x] **§1 Superadmin auth/routing fix.** Root cause found by reproducing
  live (not guessed): the login page fired **two** post-auth navigations —
  an explicit `router.replace()` in `onSubmit`/`onGoogleCredential`/
  `onSelectOrg`, plus the page's own `useEffect` that *also* redirects once
  `user` becomes truthy. The two concurrent `router.replace()` calls raced;
  when the loser was the one triggered by `DashboardHome`'s own
  superadmin→`/dashboard/admin` follow-up hop, the app got stuck rendering
  "טוען…" at `/dashboard` forever. Fixed by removing the redundant explicit
  calls — the effect is now the sole redirect trigger. Verified with 6
  back-to-back superadmin logins (0 failures after the fix; failed
  intermittently before). `SUPERADMIN_USERNAME` env var added
  (`backend/app/config.py`, `seed_superadmin()`), alongside the existing
  `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` — mirrors the demo admin's
  `admin_username`/`admin_email`/`admin_password` pattern. Backend tests:
  `TestSuperadminUsername` (3 tests).
- [x] **§2 Multi-org login + deep-link.** Both were already implemented
  correctly (fixes14 org-picker, fixes8 `?redirect=`) — verified, not
  rebuilt. Live-drive: created two throwaway test accounts sharing one
  email across two orgs (admin in one, staff in the other), confirmed the
  org-picker lists both and each selection lands in the right org/role;
  confirmed an unauthenticated deep link to `/dashboard/apartments`
  round-trips through `/?redirect=...` back to the original URL after
  login. Test accounts/org deleted after verification.
- [x] **§3 dashboard/fields — 3 tabs + ordering.** Rewritten to the same
  tab pattern as custom-fields/picklists (Contacts / Apartment / Visit,
  "Apartment" also carries the `building` entity). The standalone
  "Additional fields" section is gone — custom fields/picklists now render
  merged into their own tab, sorted alongside built-in fields. Every row
  gets a numeric order input; duplicates within a tab get a red border +
  "כפול" inline (client-side; a tie only produces a stable-sort tie in
  rendering, not a crash, so this wasn't also duplicated server-side).
  Backend: `FieldSetting.sort_order` (new nullable column + migration
  `e4f5a6b7c8d9`), `PUT /api/field-settings` now accepts `sort_order` and
  routes it to whichever table actually owns ordering for that key
  (`FieldSetting` / `CustomFieldDefinition` / `PicklistDefinition` — the
  latter two already had the column, now just exposed/writable through
  this one endpoint). `PicklistFieldOut`/frontend `PicklistField` gained
  `sort_order`. Backend tests: `TestFieldSettingSortOrder` (5 tests).
- [x] **§4A Contact page ordering.** `ContactView.tsx` was already
  tuple-array-based — added one `sortByFieldOrder()` call
  (`frontend/lib/fieldSettings.tsx`, new shared helper) before rendering.
  Summary of Visits was already ordered server-side by
  `CustomFieldDefinition.sort_order` (fixes39) — free once §3 made that
  number admin-editable. Visit Details: the custom-field/picklist groups
  are likewise already pre-ordered server-side (no code change needed);
  **`torah_thought`'s fixed position was intentionally left as-is** — it
  renders from a separate sub-layout than the other three visit-field
  sources (legacy boolean checklist via `CustomFieldsEditor`, select
  picklists, other custom fields), and fully interleaving one built-in
  field into that would mean restructuring all four into one array for a
  single field's sake. Noted here rather than left in silent limbo.
- [x] **§4B Apartment page ordering.** `apartments/[id]/page.tsx` used
  inline `field()` calls directly in JSX (not an array) — refactored into
  collect-then-sort-then-render, same `sortByFieldOrder()` helper. Building
  name and building-address stay at their fixed positions (first/last) —
  neither is toggleable today, so neither is orderable, matching the
  existing "not literally every field" boundary from the label-styling
  round.

Live-drive evidence: set `contacts.email`→1, `contacts.last_name`→2 and
confirmed the contact page's field grid re-ordered to match (screenshot);
set `apartments.email`→1, `apartments.phone`→2 and confirmed the same on
the apartment page; confirmed dashboard/fields' 3 tabs, 27 order inputs on
the Contacts tab, and the duplicate-order red-border+"כפול" indicator, all
via screenshot. All test order values were reset to unordered afterward —
no lasting change to the local dev DB's field ordering.