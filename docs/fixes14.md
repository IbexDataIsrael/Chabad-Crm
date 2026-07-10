# System Issue Tracking & Feature Requests

This document outlines urgent bugs and required feature modifications regarding the **Shliach (User), Contact, and Organization Management** modules. 

make plan.md before you write code

---

## 🐛 Bug Fixes

### 1. Shliach Email Edit Failure
* **Issue:** When editing a Shliach's profile, updating the email address does not properly reflect or update the corresponding `email` field in the `users` table.
* **Expected Behavior:** Any email change initiated on a Shliach record must accurately update the associated record in the `users` table to maintain authentication consistency.

### 2. Duplicate Email Restriction Per Organization
* **Issue:** The system currently allows creating multiple Shliach records with the same email address under the same organization.
* **Expected Behavior:** Implement a unique constraint/validation rule preventing the duplication of an email address **per organization**. The same email *can* exist across different organizations, but must be unique within a single organization context.

### 3. User & Contact Synchronization Breakdown
* **Issue:** There is a visible desynchronization between the `contacts` table and the `users` table. Updates to one are not properly propagating or linking to the other.
* **Expected Behavior:** Review the relationship, foreign keys, or sync hooks between `users` and `contacts` to ensure absolute data integrity.

---

## 🛠️ Requested Changes & New Features

### 1. Multi-Organization Login Selection Screen
* **Context:** Some users/emails are linked to multiple independent organizations.
* **Requirement:** * When a user logs in or views the Shliach display, check if their email is associated with more than one organization.
  * If multi-tenant associations exist, intercept the login flow and display a selection interface showing all connected organizations.
  * Allow the user to explicitly select which organization they wish to access.
  * **Only after explicit selection** should the system initialize the session and log the user into that specific organization's CRM.

### 2. Dynamic Navbar User Profiling
* **Requirement:** Update the main navigation bar display.
* **Specification:** Dynamically pull and display the user's **Full Name** instead of a generic username or email. This data must be fetched directly from the linked record in the `contacts` table.

### 3. Authentication & Entry Audit Logging
* **Requirement:** Create a robust log/audit table to track system access.
* **Database Schema Specifications:** Create a new logging table (e.g., `system_access_logs` or `entry_logs`) with the following fields:
  
  | Field Name | Data Type | Description |
  | :--- | :--- | :--- |
  | `date` | Date | The calendar date of the attempt |
  | `time` | Time / Timestamp | The precise time of the attempt |
  | `username` | String / VarChar | The identifier/email entered by the user |
  | `status` | String / Enum | Access status outcome (e.g., `SUCCESS`, `FAILED_INVALID_PASSWORD`, `FAILED_NO_USER`) |

* **Functional Requirement:** Every successful or unsuccessful entry/login attempt to the system must write a corresponding row into this table immediately.