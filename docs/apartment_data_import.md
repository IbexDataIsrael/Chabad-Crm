# Data Import Specification: Apartment Import Script
make apartment_data_import_plan.md before import
explain in this file where did you find the custon / picklist fields!

## Where the custom / picklist fields were found

Full detail + every ambiguity resolution is in `docs/apartment_data_import_plan.md`. Summary of where each mapped field lives in the app:

- **Jewish Status (Column H)** → picklist `apartment.Jewish_status` (`backend/app/picklist_utils.py` `PICKLIST_FIELDS`, options seeded in `backend/app/seed.py`; org 1 already has a `gentile` option added by the earlier `data3` import). Set via `picklist_utils.set_value(db, org_id, "apartments", apartment.id, "apartment.Jewish_status", value)`.
- **Languages (Column I)** → picklist `apartment.language`, which is **multi-value** (`PicklistDefinition.allow_multiple=True`, fixes51) — each comma-separated language segment is set via `picklist_utils.set_multi_values(...)`, one link per language. There is no separate `apartment_languages` table (the spec's Step 8 wording) — the generic `picklist_links` table is where every apartment's selected picklist values live.
- **Mezuzah Notes (Column M)** → **did not already exist** as a field. The only pre-existing Mezuzah-related thing is `apartment.mezuzah_status`, a status picklist (`checked`/`needs_check`) that doesn't fit free text like `'אב פ"ה - בעלה לא היה...'`. Checked every org's `custom_field_definitions` table and the frontend (`ApartmentEditor.tsx`, `lib/picklists.ts`) — confirmed nothing named "Mezuzah notes" exists anywhere. Per the user, created new: a `CustomFieldDefinition` (`entity_type="apartment"`, `field_type="text"`, `field_key="mezuzah_notes"`) using the app's existing generic custom-fields engine (fixes35 — any entity × any field type), values stored via `CustomFieldValue` keyed on `entity_table="apartments"`.
- **Resident Names (Column J)** → `Apartment.name` (already exists — "שם דייר").
- **Notes (Column K)** → `Apartment.apartment_notes` (already exists).

## Overview
Automated ETL script to parse, transform, and import apartment and structural data from an Excel spreadsheet into the database.

---

## 1. Source & Global Context
* **File Path:** `docs/data_to_import.xlsx`
* **Header Row:** Row 1 (Skip headers; process data starting from Row 2).
* **Global Tenant Context:** All inserted records must set `organization_id = 1`.

---

## 2. Row Processing Logic

For each row in `docs/data_to_import.xlsx`, execute the following steps in sequence:

### Step 1: Report Number (Column A)
* Look up `report_number` in the `report_number` table.
* If it does not exist, insert a new record for `report_number`.
* Store `report_number_id`.

### Step 2: Area (Column B)
* Look up area name (`Column B`) in the `areas` table where `area_name = Column B`.
* If it does not exist, insert a new record with `area_name = Column B`.
* Store `area_id`.

### Step 3: Extract Building Metadata (Columns C, D, E)
* **Column C:** Building Type (Hebrew text).
* **Column D:** Street Name.
* **Column E:** Street Number.

### Step 4: Building Record (Lookup & Creation)
* Construct full address string: `{Column D} {Column E}`.
* Check if a record exists in the `buildings` table matching `building_address = {full address}`.
* If non-existent, create a new record in `buildings`:
  * `area_id` = `area_id` (from Step 2)
  * `building_address` = `{Column D} {Column E}`
  * `longitude` & `latitude` = Geocoded via Google Geocoding API using full address
  * `created_at` = `NOW()`
  * `is_town_house` = `TRUE` if `Column C` **!=** `"בניין"`, else `FALSE`
* Store `building_id`.

### Step 5: Floor (Column F)
* Look up floor in the `floors` table matching `building_id = building_id` AND `name = Column F`.
* If non-existent, create a new floor record.
* Store `floor_id`.

### Step 6: Extract Apartment Details (Columns G–M)
* **Column G:** Apartment Number (`apartment_name`).
* **Column H:** Jewish Status (Hebrew text).
* **Column I:** Languages (Hebrew text, comma-separated e.g., `"אנגלית, רוסית"`).
* **Column J:** Resident Names (Hebrew text).
* **Column K:** Notes.
* **Column L:** Contact Information (Phone / Email).
* **Column M:** Mezuzah Notes.

### Step 7: Create Apartment Record
Insert a new record into the `apartments` table using:
* `building_id` = `building_id` (from Step 4)
* `apartment_name` = `Column G`
* `floor` = `Column F` (or `floor_id` depending on table FK requirements)
* `apartment_notes` = `Column K`
* `email` = Parsed email from `Column L` (if valid format)
* `phone` = Parsed phone from `Column L` (if valid US phone format)
* `report_number_id` = `report_number_id` (from Step 1)
* `created_at` = `NOW()`
* Store `apartment_id`.

### Step 8: Related Entities & Extended Fields
Map remaining row data to associated picklists and extended entities for the newly created `apartment_id`:
* **Jewish Status:** Resolve picklist ID/value matching Hebrew text from `Column H` and associate with the apartment.
* **Languages:** Split `Column I` string by comma (`,`), trim whitespace, map each segment to its respective `language_id`, and insert into the `apartment_languages` table.
* **Mezuzah Notes:** Save text from `Column M` to the designated Mezuzah notes entity/field.
* **Resident Names:** Save text from `Column J` to the designated Resident Names entity/field.

---

## Result (2026-08-24)

Ran to completion and committed to org 1 (שליחות בשיפסיידביי) on local Docker Postgres only — no prod/Neon writes. Dry-run (`backend/scripts/import_apartment_data.py --org-id 1 --xlsx /tmp/data_to_import.xlsx`) and the real `--commit` run produced identical stats, and post-commit DB counts matched baseline + reported deltas exactly (no drift):

| Entity | Before | Created | After |
|---|---:|---:|---:|
| Apartments | 1,139 | 24,659 (+482 rows merged into existing apartments) | 25,798 |
| Buildings | 14 | 8,278 (+1,127 rows matched to a pre-existing `data3` building) | 8,292 |
| Areas | 4 | 216 | 220 |
| Floors | 94 | 1,698 | 1,792 |
| Report numbers | 33 | 607 | 640 |
| `mezuzah_notes` custom field | — | created (1 definition, 31 values) | — |

Rows processed: 25,141. `apartment.Jewish_status` picklist tally: jewish 1,231 / jewish_interested 3,329 / jewish_gentile 642 / jewish_interested_gentile 354 / jewish_shtumtz 572 / gentile 9,459. `apartment.language` tally: english 1,520 / russian 1,333 / hebrew 165 / yiddish 82.

Warnings (all low, all expected per the plan): 6 unparsed contact strings, 8 phones recovered from junk text, 3 Jewish-status prefix-matches (messy variants), floor-name-unrecognized on a handful of letter floors (L/A/C/D/E/F/G/H/I — cosmetic sort-order only, fixable later via the floor reorder UI). Zero unmapped Jewish-status or language values; zero rows missing street/number.

**Note on the first attempt:** the first run (unoptimized) was interrupted by the user for taking too long — it re-queried the two apartment picklist definitions and every picklist value on almost every one of the 25,141 rows instead of caching them once, adding on the order of 150–200k avoidable DB round-trips on top of the ~25k unavoidable apartment-insert flushes. `backend/scripts/import_apartment_data.py` was patched to pre-fetch/create `apartment.Jewish_status` and `apartment.language`'s definitions and all their values once up front, and to insert `PicklistLink` rows directly (skipping the redundant existing-link/value lookups) on the create-apartment fast path — the merge-duplicate branch (~2% of rows) still goes through `picklist_utils` normally since it needs real upsert semantics. Progress logging (every 2,000 rows) was also added so a long run doesn't look hung. Even after that fix the run took ~35–40 minutes end-to-end (dry-run + commit) — the remaining cost is per-row DB round-trip latency over Docker Desktop's networking on Windows, not query redundancy — so both runs were executed as background tasks rather than foreground-blocking.