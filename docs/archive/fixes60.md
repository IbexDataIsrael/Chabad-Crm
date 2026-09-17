

# Feature Implementation & Task Plan

This document outlines the detailed execution plan for system updates, map visual changes, filter enhancements, and PDF rendering improvements across the MiniCRM platform.

make fixes60-plan.md before coding 

---

## Task Overview Checklist

- [ ] **Task 1: Tasks Page Improvements (`/dashboard/tasks`)**
  - [ ] Add "Create Task" modal/action button directly on the Tasks page.
  - [ ] Include activist selection when creating a task.
  - [ ] Fix non-functional worker report column.
  - [ ] Split worker report column into **Status** (*Completed*, *Not Completed*, *Partially Completed*) and **Notes** (styled like "Messages from Workers").
  - [ ] Handle multiple reports per task by showing data from the **latest report only**.
- [ ] **Task 2: Report Numbers Page Updates (`/dashboard/reports`)**
  - [ ] Add inline task status toggle (*Active*, *Completed*, *Paused*) directly on the Report Numbers page.
- [ ] **Task 3: Tab Division Across Customization Pages**
  - [ ] Split **Contacts** and **Activists** into separate tabs on `/dashboard/custom-fields`.
  - [ ] Split **Contacts** and **Activists** into separate tabs on `/dashboard/fields`.
- [ ] **Task 4: Global Filter Enhancements**
  - [ ] Add a global "Clear All Filters" button across all system filters (resolving area/neighborhood filter persistence).
  - [ ] Pin selected/checked items to the top of all filter dropdown lists.
- [ ] **Task 5: Area Boundaries & Map Visuals**
  - [ ] Generate boundary polygons for areas using geo-location data of constituent buildings.
  - [ ] Update map marker icons: use **Building Icon** for apartment buildings and **Townhouse Icon** for townhouses.
- [ ] **Task 6: Apartments Page Column Customization (`/dashboard/apartments`)**
  - [ ] Fix issue where newly created custom fields cannot be reordered or toggled in "Customize Columns".
- [ ] **Task 7: Report Builder Settings (`/dashboard/reports/create`)**
  - [ ] Allow newly created custom fields (e.g., Hanukkah campaign fields) to be selected for inclusion in generated reports.
- [ ] **Task 8: PDF Generation Upgrades**
  - [ ] Add dynamic per-report page numbering (`Report #<id> - Page X of Y`).
  - [ ] Ensure main table header row renders only once at the top of each PDF page.
  - [ ] Optimize single-family/townhouse layout spacing (apply standard grouping/headers only when building contains 4+ apartments).

---

## Detailed Task Specifications

### 1. Tasks Page Improvements (`/dashboard/tasks`)
* **Task Creation:**
  * Add a **"New Task"** button triggering a task creation modal.
  * Form fields: Title, Description, Priority, Due Date, and an **Assign Activist** dropdown populated with active field workers.
* **Worker Reports Display Fix:**
  * Resolve data fetching/binding issue causing the worker report column to display blank/broken values.
* **Report Column Refactoring:**
  * **Report Status:** Renders status indicator (*Completed*, *Not Completed*, *Partially Completed*).
  * **Report Notes:** Renders worker commentary using the exact layout/styling from `/dashboard/activist-messages`.
* **Latest Report Logic:**
  * If a task has multiple submitted reports, sort by submission date descending and parse metadata from the **most recent report only**.

---

### 2. "Report Numbers" Page Inline Controls (`/dashboard/reports`)
* **Target:** `/dashboard/reports`
* **Feature:**
  * Convert static task status indicators into interactive inline dropdown toggles.
  * Enable fast status switching (*Completed*, *Active*, *Paused*) with immediate backend update calls.

---

### 3. Tabs Differentiation Across Dashboard Pages
* **Target Pages:**
  * `/dashboard/custom-fields`
  * `/dashboard/fields`
* **Implementation Details:**
  * Mirror the 5-tab architectural pattern used on `/dashboard/picklists`.
  * Separate field management views into distinct **Contacts** and **Activists** tabs to scope field definitions correctly.

---

### 4. Global Filter Enhancements
* **Clear All Filters:**
  * Implement a rapid reset trigger for all active filter parameters across table header toolbars.
  * Ensure hard resets resolve sticky/stale states (specifically on neighborhood/area multi-selects).
* **Selected Items Pinning:**
  * Update filter dropdown list sorters:
    ```typescript
    items.sort((a, b) => {
      const aSelected = selectedIds.includes(a.id);
      const bSelected = selectedIds.includes(b.id);
      if (aSelected === bSelected) return 0;
      return aSelected ? -1 : 1;
    });
    ```

---

### 5. Area Boundaries & Map Visual Changes
* **Area Polygon Generation:**
  * Extract building coordinates assigned to each area.
  * Compute area boundaries via convex hull algorithms (e.g., Turf.js `convex`) and overlay polygon shapes on map components.
* **Map Marker Icon Customization:**
  * Update map rendering layer to evaluate property building type:
    * **Building Icon:** Render for standard multi-unit apartment structures.
    * **Townhouse Icon:** Render for single-family or townhouse properties.

---

### 6. Apartments Page Column Management (`/dashboard/apartments`)
* **Target Component:** "Customize Columns" Drawer / Modal
* **Issue:** Newly added custom fields do not show up as selectable or reorderable columns.
* **Fix:** Sync dynamic custom field schema definitions into the table column configuration registry to enable visibility toggling and drag-and-drop column positioning.

---

### 7. Report Builder Settings (`/dashboard/reports/create`)
* **Target:** `/dashboard/reports/create`
* **Implementation:**
  * Fetch current dynamic field definitions during report configuration setup.
  * Ensure newly created campaign fields (e.g., Hanukkah fields) appear in field mapping selection lists for export/reporting.

---

### 8. PDF Generation Engine Upgrades
* **Page Numbering:**
  * Inject report-scoped page markers in header/footer layout templates: `Report #${reportNumber} - Page ${page} of ${totalPages}`.
* **Table Header Row Behavior:**
  * Render table headers using semantic `<thead>` elements styled with `@media print { thead { display: table-header-group; } }` so table headers render **once per page top** instead of repeating on every property sub-grouping.
* **Single-Family Homes Compact Spacing:**
  * **Rule:** Evaluate `apartment_count` per property entity.
  * **Threshold:**
    * `apartment_count >= 4`: Render full section breaks and header rows.
    * `apartment_count < 4`: Render continuously with compact spacing (like a single aggregated block) to optimize printable page space.
