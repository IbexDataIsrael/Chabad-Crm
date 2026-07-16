**Crucial Rule:** Write a detailed technical implementation plan to `fixes9-plan.md` outlining specific file edits, component changes, and database migrations **before** writing any functional code.


1. System Title Dynamic Configuration
Super Admin Configurations
Add two new configuration fields to the Super Admin settings panel:
System Title Template Field
Purpose: Controls the layout of the HTML `<title>` tag across all pages.
Default Seed Value: `"{public.organizations.name} CRM"`
Logic: - Replace the placeholder `{public.organizations.name}` with the actual organization's name if available.
Set the global HTML `<title>` tag on all frontend/backend pages to match this computed text.
Temporary/Fallback Name Field
Purpose: Acts as a fallback name when no organization name is defined.
Default Seed Value: `"Jewish Points CRM"`
Logic: - If `public.organizations.name` is null, empty, or unset, fallback to using this temporary name in the title template calculation.
---
2. New Entity: Admin Area (`admin_areas`)
A. Database Table Schema
Create a new database table named `admin_areas` with full CRUD capabilities.
Field Name	Data Type	Notes / Constraints
`id`	Integer / BigInt	Primary Key, Auto-increment
`name`	String / Varchar	Name of the administrative area
`comments`	Text	Optional notes or descriptions
Hebrew Display Label: אזור מנהל
B. UI & Navigation Adjustments
Menu Hierarchy: Inject the "Admin Area" / "אזור מנהל" CRUD management section into the main navigation menu. It must be positioned immediately before the existing "Areas" menu item.
C. Relationship Extensions (`mekurav_contact`)
Foreign Key Integration: Add an `admin_area_id` column to the `mekurav_contact` table.
Relationship Type: Many-to-One (Many contacts can belong to one Admin Area).
CRUD Forms Update: Modify the `mekurav_contact` creation and editing forms to include a dropdown or selection widget allowing users to link an `admin_areas` record to the contact.
---
3. New Fields for `mekurav_contact`
A. Financial/Charity Potential Field
Add the following attribute to the `mekurav_contact` model/table:
Field Key: `tzedaka_potential`
Data Type: `string`
Hebrew Display Label: `פוטנציאל לצדקה`
---
4. Localization & Internationalization
Requirement: Ensure all newly introduced strings, labels, and form field titles are appended to the system's global localization/translation table.
Dynamic Render: No hardcoded strings in the UI; pull labels dynamically from the localization records based on the user's active locale.