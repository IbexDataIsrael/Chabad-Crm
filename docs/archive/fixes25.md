# Implementation Plan: Data Restructuring and System Refinements
create a plan before working fixes25-plan.md file 

## 1. Pre-Migration Data Backup Script
*Create a temporary Node.js/Python script or database migration down/up function to preserve existing data before structural destruction.*

- [ ] **Extract Target Data**: Query all `contact_mekurav` records containing active values for Interactions, Mivtzoim fields, and custom additional fields.
- [ ] **Map to JSON/Temp Table**: Store mappings matching `contact_id` to their respective array of interactions and boolean Mivtzoim states.
- [ ] **Data Transformation**: Prepare a payload format ready to insert these data points into the `visit` table, defaulting the migration date to the current date or the contact's creation date.

## 2. Database Schema Migrations
*Execute alter statements carefully to shift ownership of relational arrays and transactional columns.*

- [ ] **Alter `visit` Table**:
  - Add fields for Interactions (e.g., JSONB array or string array).
  - Add Mivtzoim boolean flags: `tefillin`, `tzedakah`, `shabbat_candles`, `torah_pamphlet`, `letter_in_torah`.
  - Add text field: `torah_thought`.
  - Add custom/additional tracking columns: `hanukkah_party`, `connection_to_rebbe`.
- [ ] **Data Re-assignment Execution**: Run the transformation script to hydrate the updated `visit` table with the extracted historical contact data.
- [ ] **Destructive Clean-up**: Safely drop the deprecated interactions, Mivtzoim columns, and custom field structures from the `contact_mekurav` table.

## 3. Backend & API Adjustments
*Update the business logic layers, entity definitions, and endpoint validators.*

- [ ] **Entity Definitions**: Move properties from the Contact schema model to the Visit schema model.
- [ ] **Custom Fields Business Logic**:
  - Update `dashboard/custom-fields` controller.
  - Re-route dynamic field assignment to append metadata to the Visit entity instead of the Contact entity.
- [ ] **Validation Layer**: 
  - Locate the Contact schema validator (e.g., Joi, Zod, or Mongoose schema).
  - Change the `phone` field property to optional/nullable.
  - Add a conditional regex validator rule: run phone format validation *only* if the string length is greater than zero.

## 4. Frontend & UI Changes
*Reorganize layouts, form locations, and system routing.*

- [ ] **Navigation & Routing**: Remove or comment out the menu sidebar link mapping to `/dashboard/visits`. Verify that directly entering the URL still successfully serves the view layer.
- [ ] **Contact Filter Injection (`/dashboard/contacts`)**:
  - Code an active date picker component labeled "טווח תאריכי ביקור".
  - Wire the backend query wrapper to perform an inner join between `contacts` and `visits` to filter entries by the picked visit date range.
- [ ] **Form Restructuring**: 
  - Cut the Interaction selection UI blocks and Mivtzoim checkbox panels away from the Contact profile components.
  - Paste and integrate these UI elements seamlessly into the Visit creation and logging workflow modals.
- [ ] **Custom Fields Config UI**: Move or clone the dynamic custom field renderer blocks onto the Visit management interface.

## 5. Localisation & Internationalisation (i18n)
*Address hard-coded system elements and missing labels.*

- [ ] **Translation Key Management**:
  - Add Hebrew dictionary values matching the new visit fields.
  - Create a dedicated namespace section or block exclusively for `VISITS` inside the localization files.
- [ ] **Picklist Hard-Coding Audit**: 
  - Scan files rendering `/dashboard/picklists`.
  - Locate hardcoded strings (e.g., "סוג איש קשר").
  - Replace them with standard translation hook calls referencing `contacts.contact_type` or their respective locale keys to guarantee it switches correctly during English toggle mode.

## 6. Fixes & System Bugs
*Resolve underlying storage exceptions.*

- [ ] **Logo Upload Routing**:
  - Inspect the profile/settings file upload controller.
  - If Cloudinary configurations are broken or timeout, write a secondary local disk fallback code block.
  - Pipe the files to a safe static directory (e.g., `/public/uploads/logos`), return the absolute local server path asset string, and verify it updates the persistence entry.
