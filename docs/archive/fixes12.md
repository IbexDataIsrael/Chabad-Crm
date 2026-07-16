# Feature Request & Bug Fix Specification: CRM Enhancements

This document outlines the required tasks, bug fixes, and architectural adjustments for the CRM system. Please implement these changes across the frontend views, routes, backend controllers, and database seeds as specified.

---

## 1. System HTML Title Tag (Regression & Fallback Fix)
*Note: This feature was previously implemented but is currently broken. Please inspect, refactor, and fix.*

### Requirements:
- **Super Admin Configurations:**
  - **System Title Template Field:** A configuration field for the application's `<title>` tag.
    - **Database Seed:** Default to `"{ public.organizations.name} CRM "`
  - **Temporary System Name Field:** A configuration field for a fallback application name.
    - **Database Seed:** Default to `"Jewish Points CRM"`
- **Title Rendering Logic:**
  - Dynamically replace the `{ public.organizations.name }` placeholder in the template with the actual active organization's name.
  - **Fallback:** If no organization name is configured/set for the environment, fallback and use the **Temporary System Name** instead.
  - Apply this parsed text dynamically to the `<title>` HTML tag across **all pages** of the site.

---

## 2. Apartments Management (`/dashboard/apartments`)
Refactor the apartment management workflow into distinct, dedicated routes and views to allow modularity and deep-linking.

### Requirements:
1. **Index View (`/dashboard/apartments`):**
   - Change default display behavior to **Show All** apartments upon page load.
2. **Add View (`/dashboard/apartments/add`):**
   - Create a standalone dedicated view for creating an apartment.
   - *Purpose:* This view needs to be independent so it can be reused/embedded cleanly within the Building management context.
3. **Edit View (`/dashboard/apartments/edit/{id}`):**
   - Create a standalone dedicated view for editing an existing apartment.
   - *Purpose:* This view needs to be independent so it can be reused/embedded cleanly within the Building management context.
4. **Detail/Read View (`/dashboard/apartments/{id}`):**
   - Create a standalone, clean read-only view for a single apartment.
   - *Purpose:* This URL will be used to send to users or external parties as a direct reference link.

---

## 3. Buildings Management (`/dashboard/buildings`)

### 3.1. Localization & UX Fixes
1. **Apartment Deletion Warning:**
   - **UI Change:** Replace the standard browser JavaScript `alert()` / `confirm()` box with a clean, application-styled UI modal alert.
   - **Localization:** Move the Hebrew warning text into the system localization/translation table. Currently, Hebrew text displays even when the user language is set to English.
2. **Show / Hide Apartments Toggles:**
   - **Localization:** The "Show apartments" and "Hide apartments" labels are currently hardcoded in Hebrew. Extract these strings and place them into the localization/translation tables so they change properly based on active locale.

### 3.2. Single Building Detail View (`/dashboard/buildings/{id}`)
- Create a dedicated standalone display page for a single building.
- Include a prominent **"Edit Building"** button that navigates directly to the edit page.

### 3.3. Main Buildings List Page
- Implement server-side or client-side **paging/pagination** to handle large sets of buildings efficiently.

### 3.4. Edit Building Workflow (`/dashboard/buildings/edit/{id}`)
Create a separate, dedicated page for editing building information and associated apartments.

#### Specifications:
- **Core Fields:** Enable full editing capability for all standard building fields on this form.
- **Associated Apartments Management:**
  - **Editing an Apartment:** Clicking edit on an apartment within this page must route the user to the independent `/dashboard/apartments/edit/{id}` view.
  - **Adding an Apartment:** Clicking add an apartment must route the user to the independent `/dashboard/apartments/add` view.
  - **Post-Apartment Actions & Redirection:**
    - When a user saves the apartment (either during an add or an edit action), they must be seamlessly redirected back to the `/dashboard/buildings/edit/{id}` page they came from.
    - **Optimization Preference:** If viable/possible within our current tech stack, perform these transitions or modal views "secretly" (e.g., using background AJAX components, iframes, or modal rendering) without explicitly altering the main browser window URL. If that violates simplicity or state management, standard clean redirects with return parameters are acceptable.
  - **Deletion:** Maintain a clear and functional button option to safely delete an apartment directly from this interface (triggering the localized modal mentioned in 3.1).