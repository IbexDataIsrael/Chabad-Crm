# Implementation Plan: Apartments Dashboard Improvements

This plan outlines the changes required to upgrade the filters and add bulk editing capabilities to the Apartments display page.

## 1. Create Reusable Filter Component
Create a new reusable multi-select search filter component.
* **File Location**: `components/ui/MultiSelectSearchFilter.ext` (or appropriate UI folder)
* **Features**:
  * Multi-select checkbox list.
  * Internal text search box to filter options dynamically.
  * Accessible design with scrollable container for high volume records.

## 2. Update Filters in `/dashboard/apartments`

### Building Filter
* Replace current single-select or standard filter with the new `MultiSelectSearchFilter`.
* **Conditional Logic**: If any `Report_number` items are selected, dynamically filter the available Building options. Only display buildings containing at least one apartment that matches the selected `Report_number` values.

### Report Number Filter
* Replace current filter with the new `MultiSelectSearchFilter`.
* Populate options with all available report numbers.

## 3. Implement Bulk Editing in `/dashboard/apartments`

### UI Changes
* Add a **"Bulk Edit"** button near the filters.
* This button is only enabled/active when apartments are visible under the current filter criteria.

### Bulk Edit Modal
* Trigger a modal on button click.
* The modal will apply changes to **all apartments currently matching the active filters**.
* **Form Fields**:
  * `Report_number` (Input/Select to update report number)
  * `apartment_notes` (Textarea to update notes)

### Backend / API Update
* Create or update the API endpoint to accept the current filter parameters, a new `Report_number`, and new `apartment_notes`.
* Execute a bulk update query in the database for the matching records.
* Refresh the dashboard data upon successful submission and close the modal.