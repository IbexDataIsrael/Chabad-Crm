# UI & Feature Enhancements: Shliach & Admin Views

This document specifies frontend, backend, and localization updates across the Shliach display, Admin Contacts dashboard, and Buildings management dashboard.

make plan.md before you write code

---

## 1. Changes to Shliach Display

### Task 1.1: Dynamic Header Title with Localization
* **Requirement:** Append the phrase `תצוגת פעילים` immediately following the organization name in the main header title.
* **Implementation Details:**
    * Update the header template component to pull dynamically: `"{organization_name} {localized_shliach_display_suffix}"`.
    * **Localization Rule:** The suffix string (`תצוגת פעילים`) must be abstracted into the system's global localization keys. It must be manageable, translatable, and editable via the `dashboard/localization` management page.

### Task 1.2: Contact Create/Edit Field Visibility
* **Requirement:** Clean up form architecture for the Shliach role during contact interactions.
* **Implementation Details:**
    * When creating or editing a contact, completely hide or omit the "Buildings" dropdown/selection elements from the UI layout.
    * Limit the "Apartments" selector field to only populate and display apartment records that are explicitly owned by or associated with the currently authenticated Shliach (`user_id`).

---

## 2. Changes to Admin Display

### Module A: Contacts List View (`dashboard/contacts`)

#### Task 2.1: Owner Column Mapping
* **Requirement:** Add an "Assigned User" column to the data table layout.
* **Implementation Details:** Fetch and resolve the companion user profile name by matching the contact record's underlying `assigned_user_id` GUID with the corresponding system user account.
add creeation date to display
#### Task 2.2: Advanced Filtering Logic
* **Requirement:** Introduce granular user tracking filter components.
* **Filter Options:**
    * Filter by a specifically selected **Assigned User Name**.
    * View **All Users** combined.
* **Default State Filter:** Upon initial page load, automatically default the filter selection to only display contact records assigned to the *currently logged-in admin user*.

#### Task 2.3: Sorting Behavior
* **Requirement:** Introduce robust column sorting mechanisms.
* **Sorting Options:**
    * **Alphabetical Order** (by Contact Name).
    * **Creation Date**.
* **Default State Sorting:** Automatically default the list presentation sorted by **Creation Date** descending.

---

### Module B: Buildings Management Dashboard (`dashboard/buildings`)

#### Task 2.4: Coordinates Input Refactoring
* **Requirement:** Consolidate geo-coordinate data input fields in Building Edit mode.
* **Implementation Details:** Remove the separate standalone entry inputs for *Longitude* and *Latitude*. Replace them with a single integrated text box mapping values in a unified format string: `longitude,latitude` (e.g., `35.2137,31.7683`). Parse out the string back into independent numeric field values upon submission.

#### Task 2.5: Map Layer Overlays
* **Requirement:** Enhance visual context on the integrated dashboard map canvas.
* **Implementation Details:** Force the map widget component to render all registered regional geo-fenced polygons overlaid simultaneously along with the singular pinning markers designating individual building coordinate locations.

#### Task 2.6: Filter Defaults
* **Requirement:** Default the view context switcher or list selection filter wrapper to display **All Buildings** (`הכל`) implicitly on initialization.

#### Task 2.7: Multi-line Boundary Validation & Localization Integration
* **Requirement:** Clean up boundary mismatch alerts triggered when someone attempts to append or move a building coordinate target situated completely outside of their designated geo-fenced zone bounds.
* **Implementation Details:** Extract all 3 structural text string segments of the warning notification bubble directly out of hardcoded layouts and integrate them cleanly into the system's global localization tables so they can be modified dynamically via the management panel. 
* **The 3 exact localized message strings to map:**
    1. `⚠ אזהרה: הכתובת שנבחרה נמצאת מחוץ לתחום האזור שנבחר!`
    2. `בדוק את הכתובת או בחר אזור אחר.`
    3. `שמור בכל זאת`

    * **any hebrew word added to view should be in localisation table!! **