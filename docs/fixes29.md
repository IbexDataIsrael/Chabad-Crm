# plan.md

This plan outlines the implementation steps for the requested fixes and features in the application, ensuring consistency across forms, clean UI toggling, and proper localization data seeding.
make fixes29-plan.md before starting

> **Status 2026-07-16 — all three sections DONE** (plan: `fixes29-plan.md`).
> §1 toggle on both views (persisted per browser, hidden filters keep applying);
> §2 inline red hint under the input replaces the toast in inline editing —
> phone now shows the same full hint as the add form; §3 seeded with a guarded
> rename so existing orgs upgrade but admin-customized text survives.
> Verified: 320 backend tests, tsc clean, 11-check headless drive (toggle +
> persistence on both pages, invalid-email hint + blocked save + valid save).
> ⚠️ Note: this spec file is truncated mid-§3 (the Hebrew block never closes and
> no English value follows). The English was derived as
> "Please enter a valid email address, e.g. name@example.com" — say the word if
> you meant something else.
---

## 1. Filter Section Toggle
Add an option to toggle the visibility of the entire filter section on the "Contact Mekurav" and "Visits" views.

### Implementation Steps
1. **State Management:**
   * Introduce a boolean state variable `isFilterVisible` (defaulting to `true` or `false` depending on the preferred initial UI state) in the parent component managing the filter and list views.
2. **UI Button:**
   * Place a toggle button (e.g., "Show Filters" / "Hide Filters" or a funnel icon) near the top of the section.
3. **Conditional Rendering:**
   * Wrap the filter form container in a conditional block that renders only when `isFilterVisible` is true.
   * Ensure smooth transitions if CSS transitions/collapsing are preferred over abrupt unmounting.

---

## 2. Form Error Consistency (Edit Contact)
Ensure that email and phone validation errors during contact editing are displayed exactly as they are during contact addition—directly underneath their respective input fields.

### Implementation Steps
1. **Identify Differences:**
   * Compare the `AddContact` and `EditContact` form structures.
   * Locate where inline validation errors are currently rendered in the `EditContact` component (e.g., global toast notifications or top-of-form summaries).
2. **Refactor Error Rendering:**
   * Move the rendering logic for `errors.email` and `errors.phone` to sit directly beneath the corresponding `<input>` or `<FormField>` wrapper in the edit form.
   * Apply matching CSS classes (e.g., `text-red-500`, `text-sm`, `mt-1`) to guarantee identical styling.

---

## 3. Localization Seeding Update
Update the database seeding configuration for validation hints to provide clearer guidance in both Hebrew and English.

### Seeding Data Changes
* **Key:** `validation.email_hint`
* **Hebrew (he):** 
  ```text
  נא להזין כתובת אימייל תקינה, לדוגמה name@example.com