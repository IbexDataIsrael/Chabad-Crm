# Project Task List & System Updates

## 🐛 Bug Fixes
* **Contact Creation Error**: Adding a contact under the *Shliach* role throws an error. This does not happen under the *Admin* role.
* **Mekurav Special Dates**: Adding a *Mekurav* contact should automatically enable the option to add special dates.
* **Special Date Title**: The system does not allow inserting a title when adding a new special date.

---

## 🏗️ Major Structural Changes

### Localization & Configuration
* **No Hardcoding**: Move all Hebrew terms to the localization table. Do not hardcode Hebrew strings.
* **Editable Fields**: Ensure all localization fields are fully editable from the system configuration page.
* **Picklist Editing**: Enable editing for all picklists (including default system picklists) inside the configuration section. 
  * *Hebrew translation for this action*: `עריכת תיבת בחירה`
* **System Fields Definition**: "System fields" refer to the default fields that come packaged with a new system installation.
* **Fallback Rule**: For existing system picklists where the English or Hebrew name/value is unknown, leave it blank for the admin to update later.

### Inputs & Validation
* **Phone Component**: Create a reusable Next.js component for phone number inputs.
* **Geographic Validation**: Validate phone numbers to ensure they are either a valid USA/Canada number or a valid Israeli number.
* **Instant Validation**: Validate both email and phone inputs on-the-spot (as the user types). Currently, validation only triggers upon sending the form.

### Database & Picklist Schema Changes
* **Picklist Table Structure**: Update the picklist schema to include:
  * `System_name`
  * `Hebrew_Display_name`
  * `English_display_name`
  * *(In addition to existing fields)*
* **Picklist Value Table Structure**: Add the following fields:
  * `Hebrew_Value`
  * `English_Value`
* **Table Consolidation**: Migrate all default system picklists into the custom picklist table if not already done.

### New System Picklists
1. **Jewish Status**
   * `System_name`: "Jewish_status"
   * `Hebrew_Display_name`: `יהדות`
   * `English_display_name`: "Jewish status"
   * `Values`: `/ , יהודי, יהודי מעוניין ביהדות, יהודי וגוי, יהודי מעוניין וגוי, יהודי שתומצ`
2. **Affiliation**
   * `System_name`: "affiliation"
   * `Hebrew_Display_name`: `השתייכות דתית`
   * `English_display_name`: "affiliation"
   * `Values`: `/ , חבד, חרדי, דתי לאומי, רפורמי, קונסרבטיבי`
3. **Language**
   * `System_name`: "language"
   * `Hebrew_Display_name`: `שפה`
   * `English_display_name`: "language"
   * `Values`: `/ , עברית, אנגלית, רוסית, יידיש`

---

## ➕ System Additions & Adjustments

### New Modules (CRUD)
#### 1. Visit History (`היסטורית ביקורים`)
* **Purpose**: Keep records of contact visits. Each contact can have multiple ($n$) visit fields.
* **Schema**:
  * `Id` (GUID)
  * `Date` (datetime)
  * `Notes` (text)

#### 2. Donation History (`היסטורית תרומות`)
* **Purpose**: Keep records of donations. Restricted to **Admin only**. Each contact can have multiple ($n$) donation fields. Some donation entries may not be linked to any contact.
* **Schema**:
  * `Id` (GUID)
  * `Contact_id` (GUID) -> *Display as a clickable link to the contact page* (`איש קשר`)
  * `Date` (datetime) -> (`תאריך`)
  * `Sum` -> (`סכום`)
  * `Is_ongoing` -> (`האם הוראת קבע`)
  * `Number_of_payments` -> (`מספר תשלומים`)
  * `Notes` (text) -> (`הערות`)

### Maps & Polygons
* **Polygon Page** (`/dashboard/areas`): Change the Hebrew text label from `שלוחים` to `פעילים`.
* **Map Default Center**: Move the map's starting coordinate settings to the configuration dashboard. It is currently hardcoded to Sheepshead Bay.
* **Coordinates Display**: When rendering latitude and longitude lines:
  * Disable manual editing.
  * Use a minimal display format: `x,y`.

### Contacts & User Roles
* **Contacts Page** (`/dashboard/contacts`): Filter this view to only show *Mekurav* contacts.
* **New Shluchim Page**: Create a new page displaying only *Shliach* contacts. 
  * Restricted to the **Admin view only**.
  * Add a menu item logically named "Shluchim". The Hebrew display text must be `פעילים`.
* **Multi-Area Selection**: Enable selection of more than one area on the page: `/dashboard/contacts/new-shliach`.

### Apartment Management
* **Shliach Workflow**: Users under the *Shliach* role will add **Apartments** instead of contacts. An apartment may or may not contain a contact.
* **Contact Association**: Provide an option to associate an existing contact when creating a new apartment.
* **Apartment List Page**: Add a display page and sidebar menu option for both *Shliach* and *Admin* roles to view the apartment list.

### Email Templates & Automation
* **Admin Triggers**: Automatically send an email notification when an Admin creates a new `shliach_contact`.
* **Template Requirements**:
  * Create responsive HTML templates using the official website color scheme.
  * Use the branding logo from this source: `https://cdn-icons-png.flaticon.com/128/1767/1767033.png`
  * Store the files inside an `/HTML` root directory.
* **Template 1 (`hello_shliach.html`)**: Sends access links to new Shluchim.
  * *Text (Keep in English for now)*: 
    > "Hello {first_name} {last_name} here is your link to the system {url_to_sytsem} . use your email {shliach_email}"
* **Template 2 (`hello_shliach.html` - Duplicate/Tenant Variant)**: For new tenants registering into the system.
  * Embed all specific registration form data variables into the body.
  * Include the mandatory email approval confirmation link.

