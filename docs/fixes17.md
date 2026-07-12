# System Enhancements, Feature Requests, and Bug Fixes

This document outlines outstanding tasks, architectural changes, and bug fixes required for the application. Use this as a structured specification for implementation.

add backup features from docs/fixes16.md i cant find the change on system 
make a plan.md before working
---

## 1. General System Improvements

### 1.1 Persistence & Localization
*   **Database-Backed Column Customization:**
    *   *Current Behavior:* The "Customize columns" configurations are saved in the browser's `localStorage`.
    *   *Required Change:* Migrate this persistence to the database so column preferences persist across different browsers and devices for the logged-in user.
*   *Database-Backed Language Preference:*
    *   *Required Change:* Save the user's selected system language/locale in the database instead of using session/local storage.

### 1.2 User Interface Enhancements
*   **Replace Native Alerts:**
    *   *Required Change:* Deprecate all native JavaScript `alert()` dialogs. Replace them with standard, accessible modal boxes consistent with the system's UI framework.

### 1.3 Communication & Email Seeding
*   **Dynamic Outbound Email Headers:**
    *   *Required Change:* All system-generated emails must dynamically set the `From` address and `From Name` to the respective organization's email address and organization name rather than a generic system default.
*   **Super Admin Email Templates Seeding:**
    *   *Required Change:* Seed the default database email templates for the super admin role. Use the existing HTML structure located in the `html` folder currently utilized for sending registration and welcome emails to new *Shliach* users.

---

## 2. Contacts Module

### 2.1 Communication Shortcuts
*   **Single Contact Action Triggers:**
    *   *Required Change:* Add UI controls on the single contact display view to directly initiate a **Mail**, **Phone Call**, or **WhatsApp** message.

### 2.2 Advanced Filtering Options
*   **Mitzvot Filters:**
    *   *Required Change:* Enable multi-select filtering via individual checkboxes for each of the following fields:
        *   Tefillin
        *   Tzedakah
        *   Shabbat candles
        *   Torah pamphlet
        *   Letter in a Torah
*   **Tzedakah Potential Filter:**
    *   *Required Change:* Add a functional filter targeting the "Tzedaka potential" field.
*   **Localization Alignment (English View):**
    *   *Bug Fix:* The Mitzvot and Tzedakah filters are missing entirely from the English version of the application. Ensure these filters are fully rendered and translated in the English UI.

### 2.3 Dependent Filter Behavior
*   **Dynamic Building Filter:**
    *   *Required Change:* Implement dependent filtering logic. When an **Area** filter is actively applied, the **Building** filter dropdown must restrict its options to only show buildings associated with the selected areas.

---

## 3. Apartments Module

### 3.1 Display & Layout
*   **Apartment Title Concatenation:**
    *   *Current Behavior:* In read mode, the apartment title and floor fields are concatenated without a clean separator.
    *   *Required Change:* Insert a space-isolated hyphen (` - `) between the fields (e.g., `Apartment Name - Floor X`).
*   **Table Formatting:**
    *   *Required Change:* Explicitly add clear title headers to all columns corresponding to their field names.

### 3.2 Sorting Mechanisms
*   **Alphabetical Sorting Bug:**
    *   *Bug Fix:* The current alphabetical sorting by apartment name is malfunctioning. Fix the sorting logic/database query to ensure accurate alphabetical sequencing.
*   **Chronological Sorting:**
    *   *Required Change:* Implement sorting capabilities by the record's creation date (`created_at`).

---

## 4. Areas Module (Localization Bugs)

### 4.1 Missing Key-Value Resolutions
*   *Bug Fix:* The following functional UI labels are outputting raw keys/paths instead of populating correctly from the localization/translation matrix:
    *   `areas.view_area`
    *   `apm.no_boundary`
    *   `apm.start_draw`
    *   `apm.clear_boundary`
    *   `apm.start_draw` (Verify duplicate key contexts)
    *   `apm.redraw`
    *   `page.area_has_boundary`

---

## 5. Role Permissions & Visibility (Shliach Role)

### 5.1 Record Isolation & Ownership Bug
*   *Bug Fix:* Contacts added to the system by a user with the *Shliach* role are currently hidden from their own dashboard. These contacts are only visible when logging in via a global Admin account.
*   *Required Change:* Correct the data visibility/scoping query so that users under the *Shliach* role can seamlessly view, manage, and track all contact records they have personally added.