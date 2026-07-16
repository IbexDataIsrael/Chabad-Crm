# Data Migration Plan: Excel to PostgreSQL 

This migration plan outlines the logical mapping and target database tables for importing contact data from the source Excel spreadsheet (`.xlsx`) into the PostgreSQL database. **No data import operations will be executed until this plan is formally approved.**

---

## 1. Target Tables & Schema Overview

Based on the import rules, the migration will interact with the following tables:

### A. `admin_areas`
Used to categorize contacts by their administrative or regional area.
* **Fields Updated/Inserted:**
    * `id` (Primary Key, Auto-incrementing)
    * `name` (Unique region/area name string)

### B. `contact_mekurav`
The primary table storing the individual contact details, administrative links, and qualitative fields.
* **Fields Updated/Inserted:**
    * `id` (Primary Key, Auto-incrementing)
    * `name` (String, from Column M)
    * `tzedaka_potential` (Numeric/String, from Column J)
    * `connection_to_rebbe` (Text, from Column C)
    * `recommendations` (Text, from Column B)
    * `background` (Text, from Column A)
    * `torah_thought_status` (String/Enum, mapped from Column E)
    * `admin_area_id` (Foreign Key referencing `admin_areas.id`)

### C. `contact_mitzvot` (or embedded boolean/text fields within `contact_mekurav`)
*Note: Depending on your exact schema design, these community mitzvot fields might live directly inside the `contact_mekurav` table as columns, or in a related 1:1 join table. For this plan, we assume they map to corresponding pairs of `has_[mitzvah]` (Boolean) and `[mitzvah]_details` (Text).*
* **Fields Updated/Inserted:**
    * `has_tzedakah` (Boolean) & `tzedakah_details` (Text, from Column H)
    * `has_shabbat_candles` (Boolean) & `shabbat_candles_details` (Text, from Column G)
    * `has_torah_pamphlet` (Boolean, explicitly set to `FALSE` per rules)
    * `has_torah_letter` (Boolean) & `torah_letter_details` (Text, from Column D)

---

## 2. Row-by-Row Execution Rules & Logic Flow

For each row in the Excel sheet (skipping Row 1 which contains titles), the script will perform the following sequential steps:

```
[Row Data Read]
       │
       ▼
1. Look up "admin area" (Column I) in `admin_areas`
       ├───> Found? ──────> Retrieve `admin_area_id`
       └───> Not Found? ──> INSERT into `admin_areas` ──> Save new `admin_area_id`
       │
       ▼
2. Parse Community Mitzvot Columns (H, G, D) & Torah Thought (E)
       │
       ▼
3. INSERT into `contact_mekurav` using all mapped columns + `admin_area_id`
```

---

## 3. Explicit Source Column to Target Field Mapping

| Excel Column | Column Title (Example) | Target PostgreSQL Table | Target Database Field | Transformation / Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Row 1** | *Header Titles* | — | — | **SKIP** (Do not import) |
| **Column M** | Name | `contact_mekurav` | `name` | Direct string import. |
| **Column J** | Tzedaka Potential | `contact_mekurav` | `tzedaka_potential` | Direct import (Numeric or Text). |
| **Column I** | Admin Area | `admin_areas` | `name` | **Lookup/Create:** Check if exists. If not, create and return generated ID. |
| **Column I** | Admin Area | `contact_mekurav` | `admin_area_id` | Assign the retrieved or newly created ID. |
| **Column H** | Tzedakah Mitzvah | `contact_mekurav` / `mitzvot` | `has_tzedakah`<br>`tzedakah_details` | If cell has text:<br>• Set boolean field = `TRUE`<br>• Store text in details field. |
| **Column G** | Shabbat Candles | `contact_mekurav` / `mitzvot` | `has_shabbat_candles`<br>`shabbat_candles_details` | If cell has text:<br>• Set boolean field = `TRUE`<br>• Store text in details field. |
| — | *Torah Pamphlet* | `contact_mekurav` / `mitzvot` | `has_torah_pamphlet` | **Explicitly set to `FALSE`** (or omitted based on rules). |
| **Column D** | Letter in a Torah | `contact_mekurav` / `mitzvot` | `has_torah_letter`<br>`torah_letter_details` | If cell has text:<br>• Set boolean field = `TRUE`<br>• Store text in details field. |
| **Column E** | Torah Thought | `contact_mekurav` | `torah_thought_status` | If cell has text, pick the explicit value: **"נמסר"** |
| **Column C** | Connection to Rebbe | `contact_mekurav` | `connection_to_rebbe` | Direct text import. |
| **Column B** | Recommendations | `contact_mekurav` | `recommendations` | Direct text import. |
| **Column A** | Background | `contact_mekurav` | `background` | Direct text import. |

---

## 4. Next Steps & Approval

* [ ] **Review Schema Mappings:** Please confirm if your community mitzvot fields are embedded inside the `contact_mekurav` table or if they exist in a separate table.
* [ ] **Provide Approval:** Reply with **"Approved"** or provide feedback to modify specific rules. 

*Once approved, the migration script (Python/SQL) will be generated following this structural blueprint.*