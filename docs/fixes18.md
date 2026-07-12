# Development Plan & Task Specification

## 📋 General Pre-requisites
*   **Mandatory Rule:** Create a detailed `plan.md` outlining the technical strategy, affected files, and regression testing approach *before* applying any fixes.

---

## ⚙️ General Requirements
1.  **Searchable Dropdowns:** Any `<select>` dropdown component displaying database data (`Apartments`, `Buildings`, `Shliach`, `Mekurav`) must be updated to a searchable select box, allowing users to type and filter options inline.
2.  **Hebrew Localization Update:** Update the database seeding/localization files to replace `“מצוות קהילה”` with `“מבצעים”` (applies to exactly 3 occurrences).
3.  **English Localization Update:** Update the database seeding/localization files to replace `“Community mitzvot”` with `“Mivtzoim”` (applies to exactly 3 occurrences).

---

## 🌐 Localization Bugs & Hardcoded Labels
1.  **Area View:** Resolve and localize the hardcoded label `areas.view_area`.
2.  **Dashboard Settings Localization:** Add the following Hebrew strings to the localization tables/seeding configuration:
    *   `“העלה לוגו”`
    *   `“לוגו הארגון”`
3.  **Map Hint Localization:** Locate the hardcoded string `“לחץ על המפה כדי לבחור את מרכז ברירת המחדל, או גרור את הסמן לכוונון.”` and replace it with the dynamic localization key `apm.start_hint`.

---

## 👥 Contacts (Mekurav) Management
*Target View: Single Shliach Profile Page (`/dashboard/contacts/[id]`)*

1.  **UI Cleanup:** Remove the following relationship sections/tabs from the single Shliach page:
    *   `Donations`
    *   `Interactions`
2.  **Tzedaka Potential Filter:** Convert the `Tzedaka potential` input from a free-text search box to a dropdown menu. Aggregate all unique existing values from the database to populate the options.
3.  **Default Field Visibility:** Disable the visibility of the `Area` field by default.
4.  **Column Customization Cleanups:**
    *   Remove the standard `Area` field option from the **"Customize Columns"** settings panel.
    *   Add `Admin Area` as an available display column option within the **"Customize Columns"** settings panel.
5.  **Admin Area Integration:**
    *   Add `Admin Area` directly to the profile data display.
    *   Implement a new system filter allowing users to filter contacts by `Admin Area`.

---

## 🗺️ Area Management
*Target View: Single Area View Page (`/dashboard/areas/[id]`)*

1.  **Button Redundancy:** Remove the duplicate **"Add Activist"** button located on the right-hand side of the interface.
2.  **Add Activist Workflow:** Refactor the workflow so that clicking **"Add Activist"** opens a dropdown populated with all active `Shliach` contacts.
3.  **Add Building Workflow:** Refactor the **"Add Building"** feature to restrict dropdown selections exclusively to buildings located within the specific geographical polygon of that Area.

---

## 🏢 Apartments Management
*Target View: Apartments Directory Dashboard (`/dashboard/apartments`)*

1.  **Naming Structure:** Strip out any hyphen `"-"` concatenation artifacts from the naming rendering engine to properly display clean apartment names.
2.  **Advanced Filters:** Add three new distinct filtering capabilities to the main grid view:
    *   Filter by **Jewish Status**
    *   Filter by **Mezuzah** field status
    *   Filter by **Building** name

---

## 🛠️ Configuration & Permissions
1.  **Shliach Contact Permissions:** Introduce a new boolean configuration checkbox setting determining whether a `Shliach` has permission to view contacts.
2.  **Default State:** Ensure this new permission flag defaults to `false` across the system.
# Development Plan & Task Specification

## 📋 General Pre-requisites
*   **Mandatory Rule:** Create a detailed `plan.md` outlining the technical strategy, affected files, and regression testing approach *before* applying any fixes.

---

## ⚙️ General Requirements
1.  **Searchable Dropdowns:** Any `<select>` dropdown component displaying database data (`Apartments`, `Buildings`, `Shliach`, `Mekurav`) must be updated to a searchable select box, allowing users to type and filter options inline.
2.  **Hebrew Localization Update:** Update the database seeding/localization files to replace `“מצוות קהילה”` with `“מבצעים”` (applies to exactly 3 occurrences).
3.  **English Localization Update:** Update the database seeding/localization files to replace `“Community mitzvot”` with `“Mivtzoim”` (applies to exactly 3 occurrences).

---

## 🌐 Localization Bugs & Hardcoded Labels
1.  **Area View:** Resolve and localize the hardcoded label `areas.view_area`.
2.  **Dashboard Settings Localization:** Add the following Hebrew strings to the localization tables/seeding configuration:
    *   `“העלה לוגו”`
    *   `“לוגו הארגון”`
3.  **Map Hint Localization:** Locate the hardcoded string `“לחץ על המפה כדי לבחור את מרכז ברירת המחדל, או גרור את הסמן לכוונון.”` and replace it with the dynamic localization key `apm.start_hint`.

---

## 👥 Contacts (Mekurav) Management
*Target View: Single Shliach Profile Page (`/dashboard/contacts/[id]`)*

1.  **UI Cleanup:** Remove the following relationship sections/tabs from the single Shliach page:
    *   `Donations`
    *   `Interactions`
2.  **Tzedaka Potential Filter:** Convert the `Tzedaka potential` input from a free-text search box to a dropdown menu. Aggregate all unique existing values from the database to populate the options.
3.  **Default Field Visibility:** Disable the visibility of the `Area` field by default.
4.  **Column Customization Cleanups:**
    *   Remove the standard `Area` field option from the **"Customize Columns"** settings panel.
    *   Add `Admin Area` as an available display column option within the **"Customize Columns"** settings panel.
5.  **Admin Area Integration:**
    *   Add `Admin Area` directly to the profile data display.
    *   Implement a new system filter allowing users to filter contacts by `Admin Area`.

---

## 🗺️ Area Management
*Target View: Single Area View Page (`/dashboard/areas/[id]`)*

1.  **Button Redundancy:** Remove the duplicate **"Add Activist"** button located on the right-hand side of the interface.
2.  **Add Activist Workflow:** Refactor the workflow so that clicking **"Add Activist"** opens a dropdown populated with all active `Shliach` contacts.
3.  **Add Building Workflow:** Refactor the **"Add Building"** feature to restrict dropdown selections exclusively to buildings located within the specific geographical polygon of that Area.

---

## 🏢 Apartments Management
*Target View: Apartments Directory Dashboard (`/dashboard/apartments`)*

1.  **Naming Structure:** Strip out any hyphen `"-"` concatenation artifacts from the naming rendering engine to properly display clean apartment names.
2.  **Advanced Filters:** Add three new distinct filtering capabilities to the main grid view:
    *   Filter by **Jewish Status**
    *   Filter by **Mezuzah** field status
    *   Filter by **Building** name

---

## 🛠️ Configuration & Permissions
1.  **Shliach Contact Permissions:** Introduce a new boolean configuration checkbox setting determining whether a `Shliach` has permission to view contacts.
2.  **Default State:** Ensure this new permission flag defaults to `false` across the system.