# Development Plan: Settings Dashboard, Contacts, Apartments, and Role Fixes

Before implementing any code changes, review this plan to ensure all requirements are understood and tracked.
create a plan.md file 

# Implementation Plan: New Reports Page and Menu Restructuring

## Phase 1: Localization Setup
Add all new Hebrew and English strings under a new `"reports"` / `"דוחות"` section in the localization files.

```json
// locales/he.json
{
  "reports": {
    "menu_title": "דוחות",
    "create_reports": "יצירת דוחות",
    "report_numbers": "מספרי דוחות",
    "select_reports_placeholder": "בחר מספר דוח אחד או יותר",
    "generate_pdf": "הפק דוח PDF",
    "floor": "קומה",
    "apartment_name": "מספר דירה",
    "jewish_status": "מצב יהדות",
    "mezuzah_status": "מזוזה",
    "language": "שפה",
    "apartment_notes": "הערות",
    "no_data": "לא נמצאו נתונים עבור הדוחות שנבחרו",
    "pdf_title": "דוח ריכוז דירות"
  }
}

// locales/en.json
{
  "reports": {
    "menu_title": "Reports",
    "create_reports": "Create Reports",
    "report_numbers": "Report Numbers",
    "select_reports_placeholder": "Select one or more report numbers",
    "generate_pdf": "Generate PDF Report",
    "floor": "Floor",
    "apartment_name": "Apartment Number",
    "jewish_status": "Jewish Status",
    "mezuzah_status": "Mezuzah Status",
    "language": "Language",
    "apartment_notes": "Notes",
    "no_data": "No data found for the selected reports",
    "pdf_title": "Apartment Summary Report"
  }
}

```
## Phase 2: Menu & Navigation Restructuring

*   **Move Donations:** Relocate the "Donations" menu item to be a child under the "People" parent node.
*   **New Reports Menu Node:** Create a new navigation group named "Reports" ("דוחות").
*   **Move Report Numbers:** Relocate the existing "Report Numbers" page link under this new "Reports" parent node.
*   **Add Create Reports Link:** Register a route and menu item for "Create Reports" ("יצירת דוחות") under the "Reports" parent node.

## Phase 3: "Create Reports" Page ("יצירת דוחות")

### UI Layout
*   Create a new page component with RTL support enabled.
*   add MultiSelectFilter component populated with active report numbers.
*   Add a "Generate PDF" action button.

### Data Fetching & Filtering
*   Query all apartments linked to the selected `report_number_ids` where `is_display === true`.

### Data Aggregation Logic
*   Group apartments first by `report_number`.
*   Within each report number group, aggregate apartments by building address (parsed/cleaned to show only street name and number).

### PDF Generation (RTL)
*   Integrate a PDF generation library (e.g., `pdfmake` or `jspdf` with Hebrew font support).
*   Ensure right-to-left layout alignment for the PDF canvas.
*   Map the table columns to the required translated headers:
    *   **קומה** (Floor)
    *   **מספר דירה** (`apartment_name`)
    *   **מצב יהדות** (`jewish_status`)
    *   **מזוזה** (`mezuzah_status`)
    *   **שפה** (Language)
    *   **הערות** (`apartment_notes`)