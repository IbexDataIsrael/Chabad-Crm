# Feature Specification & Implementation Plan: Report Numbers, History, & Architectural Adjustments

## Instructions for Claude CLI
1. **CRITICAL REQUIREMENT:** You must generate `docs/fixes19-plan.md` outlining your exact architecture, schema changes, and route designs *before* making any code changes.
2. Implement all requirements end-to-end against the running Docker/Python/Frontend stack.
3. Ensure all backend tests pass, updating or adding test cases to guarantee coverage for the new logic.

---

## 1. Database Schema Migrations (Alembic)

### New Table: `report_number` (מספר דוח)
* **Fields:**
  * `id`: Integer/UUID (Primary Key)
  * `name`: String / Text
* **Localization Requirement:** All frontend labels/headers for this table must utilize keys mapped inside the system's localization table.

### New Many-to-Many Bridge Table: `report_number_contact_shliach`
* Connects `report_number` and `contact_shliach`.
* **Fields:**
  * `id`: Primary Key
  * `report_number_id`: Foreign Key referencing `report_number.id` (on cascade delete/appropriate behavior)
  * `contact_shliach_id`: Foreign Key referencing `contact_shliach.id`

### Table Dropping & Clean Up
* Drop the existing table `contact_shliach_apartment`.
* Completely clean up related model definitions and relationships in the codebase.

### Modifications to `apartments` Table
* Add `is_display`: Boolean (defaults to `true`).
* Add `last_edit`: DateTime (nullable or defaults to current timestamp).
* Add `editor_id`: Foreign Key linking to `contact.id` (or user identity system).
* Add `report_number_id`: Foreign Key referencing `report_number.id`.

### Modifications to `buildings` Table
* Add `is_town_house`: Boolean (Label: "Town house" / "בית פרטי").

---

## 2. Admin System Extensions & Refactoring

### Report Number CRUD
* Provide an isolated full CRUD interface for `report_number` accessible **only** by users with the Admin role (`require_admin` check on backend).

### `contact_shliach` Adjustments
* **Remove Relation:** Remove all structural associations between `contact_shliach` and `apartments`.
* **New Association:** Associate `contact_shliach` directly to `report_number` instead.
* **UI Clean-up:**
  * Remove `contact_shliach_apartment` assignments from the Shliach creation/edit forms.
  * Delete the section **"Apartments covered by the activist"** from the `contact_shliach` detail/display views.

---

## 3. Apartment Versioning & History Tracking

### Edit Lifecycle & Soft Immutability
* When an update is performed on an apartment:
  1. Do **not** overwrite the existing row. Set its `is_display = false`, `last_edit = NOW()`, and `editor_id = [Current User Contact ID]`.
  2. Insert a **new** row representing the active version with `is_display = true`, updated field values, and current metadata.

### Scoped Display & Role-Based Access
* **`Contact_MEKURAV` View:** Must **only** fetch and see the current version where `is_display = true`. Historical records must remain hidden.
* **Admin View:** Provide a comprehensive History View (similar to Wikipedia revisions).
  * Render a select dropdown containing the list of previous updates formatted as: `[Editor Name] + [Date/Time]`.
  * Selecting a historical option loads a read-only snapshot of the apartment properties at that specific point in time.

### Report Number Assignment
* In the Apartment creation and modification screens, supply a searchable/filterable dropdown menu allowing selection from the `report_number` data entries.

---

## 4. Building Automation Logic (Town Houses)

### Creation Pipeline Interceptor
* When saving/inserting a new `building`:
  * Evaluate the boolean status of `is_town_house`.
  * **If Checked (`true`):**
    1. **Bypass Floor Generation:** Completely skip any background logic that splits the building out into multi-tier floors.
    2. **Auto-Generate Single Unit:** Programmatically spawn exactly **one** record in the `apartments` table. 
    3. **Naming Convention:** Set the name/identifier of this single apartment unit to: `[Building Contact Name]-th`.

---

## 5. Configuration & Visibility Scopes

### `Contact_MEKURAV` Visibility Toggle
* By default (and during initial system seeding), the entire `Contact_MEKURAV` layout area must be set to **invisible**.
* Expose an explicit control toggle inside the system's global **Configuration Section** enabling administrators to dynamically show/hide this interface block.