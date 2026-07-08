# Development Tasks: System Updates & Role Permissions

This document outlines the required architectural updates, entity changes, and authorization enforcement rules for the platform.

make plan.md before you write code

---

## 1. Super Admin System

### Task 1.1: Cascading Deletion for Organizations
* **Requirement:** Ensure all relevant nested data is purged when an organization is deleted to prevent orphaned records in the database.
* **Implementation Details:**
    * Implement cascading deletes or a database trigger at the database level for tables linked via foreign keys to the `organizations` table (e.g., `contacts`, `campaigns`, `settings`).
    * If using soft deletes, ensure the soft-delete state propagates downstream recursively.

### Task 1.2: Double-Verification UI Safeguard
* **Requirement:** Prevent accidental deletion of an organization by implementing a two-step confirmation process.
* **Implementation Details:**
    * **Step 1:** A standard confirmation modal asking: *"Are you sure you want to delete this organization? This action is irreversible."*
    * **Step 2:** A secondary explicit text-matching input field requiring the admin to type the exact name of the organization or the word `DELETE` to enable the final submission button.

---

## 2. Changes to Contact Entity

### Task 2.1: Schema Migration (`assigned_user_id` to GUID)
* **Requirement:** Change the data type of the `assigned_user_id` column in the `contacts` table from an integer (`INT`) to a Globally Unique Identifier (`GUID`/`UUID`).
* **Implementation Details:**
    * Create a database migration script. 
    * Ensure appropriate casting if migrating live production data, mapping existing integer relationships to new corresponding GUID identifiers.

### Task 2.2: Automated Assignment on Creation
* **Requirement:** Automatically track ownership of newly added contacts.
* **Implementation Details:**
    * For every application flow where a contact is created, intercept the payload and automatically populate `assigned_user_id` with the authenticated `user_id` context extracting from the JWT token or session.

### Task 2.3: Historical Data Patching (Organization 1)
* **Requirement:** Run a one-time data migration patch specifically for **Organization 1**.
* **Implementation Details:**
    * Identify the creator/admin user ID responsible for the contacts inside Organization 1.
    * Execute an update query to backfill and set `assigned_user_id = [admin_user_guid]` for all existing contact records associated with this specific organization.

---

## 3. Changes to Shliach Display & Role Restrictions

### Task 3.1: API Endpoint Security (IDOR Prevention)
* **Requirement:** Strictly enforce multi-tenant isolation across all backend endpoints.
* **Implementation Details:**
    * Audit all API endpoints to ensure they validate that the requesting user's organization context matches the resource scope being requested (preventing Insecure Direct Object Reference (IDOR) vulnerabilities).
    * Ensure a Shliach or regional admin cannot arbitrarily view or alter another user's or organization's records by changing ID parameters in requests.

### Task 3.2: Configuration & Menu Protection
* **Requirement:** Protect underlying configuration and settings endpoints.
* **Implementation Details:**
    * Apply the same authorization middleware to backend configuration/metadata pages to block unauthorized parameter tampering or horizontal privilege escalation.

### Task 3.3: Contact CRUD Permissions
* **Requirement:** Allow the Shliach role full Create, Read, Update, and Delete capabilities over their own contact data.

### Task 3.4: Forced Ownership Context
* **Requirement:** When a user with the Shliach role adds a contact, the backend must force `assigned_user_id` to be equal to that specific Shliach’s `user_id`.

### Task 3.5: Data Isolation (View Restrictions)
* **Requirement:** Limit data visibility for the Shliach role.
* **Implementation Details:**
    * Append an explicit tenant filter to database query reads for this role: 
      `WHERE assigned_user_id = current_user_id`
    * The Shliach must only be allowed to see and manage contacts they explicitly created.

### Task 3.6: Backend UI & Role-Based Access Control (RBAC)
* **Requirement:** Prevent the Shliach role from seeing or querying the "Admin Area" section.
* **Implementation Details:**
    * Enforce a backend role check blocking access to any endpoints routing to administrative tools or operational analytics.

### Task 3.7:  Navigation & UI Clean-up
* **Requirement:** Remove the "Admin Area" module visually from the frontend navigation menu when a user logs in with Shliach privileges.