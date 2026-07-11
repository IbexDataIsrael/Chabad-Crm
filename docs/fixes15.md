# System Requirements & Bug Fixes Specification

This document details the precise system requirements, bug fixes, and feature enhancements requested for the CRM system across multiple modules.

make plan.md before you start./
---

## 1. General System Enhancements

### 1.1 Global Pagination
* **Requirement:** Add consistent pagination (paging) to all list views and data tables across the entire system to ensure fast loading times and manageable data presentation.

### 1.2 State Retention & Filtering
* **Requirement:** The system must remember filter and sorting selections for all modules (Contacts, Apartments, Buildings, etc.).
* **Implementation:** Store filter configurations in the browser's `localStorage` so that when a user navigates away (e.g., to view a single contact) and returns, the previous state is completely restored instead of resetting to defaults.

---

## 2. Super Admin Module

### 2.1 Rich Text HTML Templates
* **Requirement:** Convert Super Admin notification/email templates into customizable HTML templates.
* **WYSIWYG Integration:** Integrate a WYSIWYG (What You See Is What You Get) editor within the admin interface so these templates can be easily modified without writing raw code.
* **Seeding:** Seed the default database templates with the exact HTML structure currently used to send registration/welcome emails to a new *Shliach* user.

### 2.2 Shliach Deletion Logic
* **Validation Check:** Before deleting a *Shliach*, check if there is any dependent or connected data in the system. If connected data exists, display a descriptive information modal specifying the data ties.
* **Confirmation Modal:** When a user clicks delete, open a confirmation modal box asking "Are you sure?" (Hebrew translation: `בטוח ?`).
* **Localization:** This confirmation text and all related modal copy must be mapped through the system's localization table.

---

## 3. Users Module

### 3.1 Redirection Bug Fix
* **Bug:** When deleting a user, the system incorrectly redirects the administrator to the *Contacts* module.
* **Fix:** Correct the redirect path so that upon successful deletion, the user is redirected back to the *Users* management page.

### 3.2 Feature Additions
* **Pagination:** Implement standard paging for the users table.
* **Filters & Sorting:** Add robust sorting capabilities, including:
  * Alphabetical sorting (A-Z / Z-A)
  * Date created/added sorting
* **Approval Workflow:** Send an automated approval/welcome email when adding a new user, utilizing the same underlying logic and workflow triggered when a new *Shliach* is created.

---

## 4. Shluchim Module (`/dashboard/shluchim`)

### 4.1 Dashboard & List Features
* **Sorting:** Add comprehensive date and alphabetical sorting to the main Shluchim list view.
* **Multi-Select Building Filter:** Add a building filter dropdown with multi-select capabilities, allowing administrators to filter Shluchim tied to multiple specific buildings simultaneously.
* **Multi-Select Area Filter:** Add an area filter dropdown with multi-select capabilities, allowing filtering by multiple geographical areas at once.

### 4.2 Single Shliach Profile View
* **Bug:** The detailed view page of a single Shliach incorrectly pulls and displays standard, general contact data.
* **Fix:** Modify the profile view (similar to the layout reference at `dashboard/contacts/11`) to strictly render data fields specific to a *Shliach* contact.
* **Relationship Sub-Grid:** Display an embedded list showing all apartments explicitly assigned to or belonging to that particular Shliach.

---

## 5. Mekurav / Contacts Module

### 5.1 Filters & Customization
* **Advanced Filtering:** Add a comprehensive filtering mechanism identical to the one implemented within the *Apartments* display module.
* **Layout Customization:** Add a configuration section that lets users customize which data columns appear on the main table screen. 
  * *Current layout:* Defaults to Name, Phone, and Assigned To.
  * *New layout:* Allow users to swap or append fields like "Areas" or any other custom attribute directly on the primary grid.
* **Mitzvot Filter:** Add a dedicated quick-filter checkbox to display only contacts where `Community Mitzvot` is marked as `TRUE` (e.g., positive indicators for Tzedakah/Charity and other community deeds).

### 5.2 Quick Actions & Bulk Communication
* **Individual Quick Actions:** Add prominent, single-click buttons for each contact row to execute quick phone calls, launch WhatsApp web/app messages, or trigger emails.
* **Bulk Email Communication:** Add a button to send a mass email to all contacts currently visible in the active list (respecting any applied filters, search terms, and sorting criteria).
* **Protocol Integration:** The system should invoke the user's native email client using the standard `mailto:` protocol, passing the filtered email addresses as BCC to respect privacy.

---

## 6. Manager Area Module

### 6.1 View Capabilities
* **Requirement:** Implement full sorting and filtering options within the Manager Area view to bring feature parity with other primary entity dashboards.

---

## 7. Buildings & Apartments Modules

### 7.1 Buildings View Enhancements
* **Sorting Features:** Integrate robust column sorting capabilities across the module, shifting it from filter-only to a fully sortable layout.
* **Multi-Select Area Filter:** Add multi-select capabilities to the Area filter inside the Buildings and Areas views, ensuring a consistent user experience with how the Apartments view currently handles multi-area filtering.

### 7.2 Apartments View Customization
* **Configuration Controls:** Similar to the Contacts module, add a configuration panel for the Apartments view allowing users to self-define and toggle which specific fields or technical attributes are visible on the primary screen layout.