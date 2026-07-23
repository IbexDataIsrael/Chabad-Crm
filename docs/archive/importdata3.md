# Development Plan: XLSX Data Import Workflow

## 1. Overview & Constraints
* **Purpose:** Process and import hierarchical data from an uploaded Excel (`.xlsx`) file into the application database.
* **Execution Order:** Records must be processed sequentially, exactly following the order in which they appear in the `.xlsx` file.
* **Architecture:** Implement an upsert pipeline for parental relationships (Reports, Buildings, Floors) before creating the final child entities (Apartments, Contacts).
make importdata3-plan.md first
source file : docs/data3.xlsx
---

## 2. Row Processing Logic & Data Mapping

For every row in the spreadsheet, execute the following steps in sequence:

### Step 1: Report Lookup / Creation
* **Source:** Column A (`Report ID Name`)
* **Logic:** 
  * Check if a report record already exists matching this identifier/name.
  * If it **does not** exist, create a new record for this report number.
* **State Management:** Cache and save the `report_number_id` for use in Step 8.

### Step 2: Building Lookup / Creation
* **Source:** Column B (`Street Name`) + Column C (`Street Number`)
* **Logic:** 
  * Perform a composite check to see if a building record already exists matching both this exact street name and street number.
  * If it **does not** exist, create a new `Building` record.
* **State Management:** Cache and save the `building_id` for use in Step 8.

### Step 3: Floor Lookup / Creation
* **Source:** Column D (`Floor`)
* **Logic:** 
  * Check if a floor record exists for this specific floor number (scoped within the current building context if applicable, or global depending on schema design).
  * If it **does not** exist, create a new floor record.
* **State Management:** Cache and save the floor tracking `id` for use in Step 8.

### Step 4: Extract Apartment Metadata
* **Source:** Column E (`Apartment Name`)
* **Logic:** Parse and capture the string to be saved as `apartment_name`.

### Step 5: Extract Jewish Status
* **Source:** Column F (`Jewish Status`)
* **Logic:** Parse and map the value to the `jewish_status` field.

### Step 6: Extract Language
* **Source:** Column G (`Language`)
* **Logic:** Parse and map the value to the `language` field.

### Step 7: Extract Apartment Notes
* **Source:** Column I (`Notes`)
* **Logic:** Parse and map the value to the `apartment_notes` field.

### Step 8: Apartment Entity Creation
* **Action:** Instantiate and insert a new **Apartment** record using the mapped fields and relational foreign keys accumulated in the previous steps:
  ```json
  {
    "building_id": "Saved from Step 2",
    "report_number_id": "Saved from Step 1",
    "floor": "Saved from Step 3",
    "apartment_name": "Extracted from Step 4",
    "language": "Extracted from Step 6",
    "jewish_status": "Extracted from Step 5",
    "apartment_notes": "Extracted from Step 7"
  }