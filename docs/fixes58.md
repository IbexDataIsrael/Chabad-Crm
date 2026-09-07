# Feature Specification: Campaign and Task Entities Refactor

> **Workflow Rule:** A detailed implementation plan (`plan58-plan.md`) must be prepared and approved before writing any code.

---

## 1. Executive Summary & Overview

This specification outlines a major architectural shift in how activists access and view apartments. Currently, activist access to apartments is based directly on **Report Numbers**. Under the new paradigm, access will be governed by **Tasks** and **Campaigns**.

Key highlights:
* **Activists** will only see apartments linked to a **Report Number** that belongs to an **Active Task** under an **Active Campaign**.
* **Access Control** is dynamically granted while a Task and its parent Campaign are active, and revokes automatically when paused or completed.
* **New Entities**: `Campaign` and `Task`.
* **New User Role**: `Campaign Manager`.
* **UI Updates**: New Admin pages, tab separations across management dashboards, quick-action buttons, inline editing, and updated status visualizers.

---

## 2. Database & Data Model Changes

New SQL tables and relational junction tables will be created to support the system logic.

```
+-------------------+          1:N          +-------------------+
|     Campaign      | <-------------------> |       Task        |
+-------------------+                       +-------------------+
| id (PK)           |                       | id (PK)           |
| name              |                       | campaign_id (FK)  |
| is_active         |                       | volunteer_id (FK) |
| custom_stats_text |                       | custom_date_id    |
| created_at        |                       | status            |
| updated_at        |                       | created_at        |
+-------------------+                       | updated_at        |
                                            +-------------------+
                                                      |
                                                      | N:M
                                                      v
                                            +-------------------+
                                            |  TaskReportNumber |
                                            +-------------------+
                                            | task_id (FK)      |
                                            | report_number_id  |
                                            +-------------------+
```

### 2.1 Table: `campaigns`
* `id` (Primary Key, UUID / Auto-increment)
* `name` (String, Required)
* `is_active` (Boolean, Default: `false`)
* `custom_stats_text` (Text, Template for dynamic display on activist homepage)
* `created_at` (Timestamp, Default: `NOW()`)
* `updated_at` (Timestamp, Default: `NOW()`)
* `deleted_at` (Timestamp, Nullable / Soft Delete support)

### 2.2 Table: `tasks`
* `id` (Primary Key, UUID / Auto-increment)
* `campaign_id` (Foreign Key -> `campaigns.id`)
* `volunteer_id` / `activist_id` (Foreign Key -> `users.id`)
* `custom_date_picklist_id` (Foreign Key -> `picklists.id`, Nullable)
* `status` (Enum / String: `'ACTIVE'`, `'COMPLETED'`, `'PAUSED'`, Default: `'ACTIVE'`)
* `volunteer_report_summary` (Text, Nullable - stores volunteer submission notes/status reports)
* `created_at` (Timestamp, Default: `NOW()`)
* `updated_at` (Timestamp, Default: `NOW()`)

### 2.3 Junction Table: `task_report_numbers`
* `task_id` (Foreign Key -> `tasks.id`, On Delete CASCADE)
* `report_number_id` (Foreign Key -> `report_numbers.id`, On Delete CASCADE)
* *Primary Key*: (`task_id`, `report_number_id`)

---

## 3. Detailed Feature Specifications

### 3.1 Campaign Entity & Management
* **Role Permissions**: `Admin` and `Campaign Manager` only.
* **New Page**: `/dashboard/campaigns`
* **Features**:
  * **CRUD Operations**: Create, Read, Update/Activate/Pause, and Delete campaigns.
  * **Status Toggle**: Easily set campaigns to **Active** or **Inactive**.
  * **Activist Home Display Customization**: Define a text template with dynamic data sync tags (e.g., `"{{count}} Jews received a Menorah"`).

### 3.2 Activist Access Logic & Homepage Display
* **Access Rule**:
  $$	ext{Access Granted} \iff (	ext{Task Status} = 	ext{'ACTIVE'}) \land (	ext{Parent Campaign Status} = 	ext{'ACTIVE'})$$
* If either the Task or the Campaign is paused, completed, or deactivated, access to the corresponding report numbers/apartments is immediately revoked.
* **Activist Homepage**: Display real-time dynamic counters formatted according to the Campaign's customized stats text.

### 3.3 Task Entity & Creation Workflow
* **Quick Action Button**: Located on the **User Management** page next to each activist's name (styled similarly to adding visits in Contacts).
* **Task Fields**:
  * **Creation Date**: Automatic (`NOW()`).
  * **Custom Date**: Picklist selector under the "Task" category (e.g., "First Candle of Hanukkah").
  * **Campaign Assignment**: Dropdown of currently active campaigns (selection required if multiple are active).
  * **Report Number Assignment**: Multi-select support for assigning 1 or more Report Numbers.
  * **Task Status**: Default set to `Active` (Options: `Active`, `Completed`, `Paused`).

### 3.4 Tasks Management Page (`/dashboard/tasks`)
* **Features**:
  * Full CRUD functionality with **Inline Editing**.
  * **Filters & Search**: Filter by `Status` or `Campaign`; quick search within tasks (similar to Apartments search).
  * **Sorting**: Sort by `Volunteer Name`, `Creation Date`, or `Report Number` (Ascending / Descending).
  * **Volunteer Feedback Integration**: Feedback/reports submitted by volunteers populate a dedicated **Volunteer Report** field rather than going solely to volunteer messages.
  * **Status Influence**: Admin / Campaign Manager can review volunteer feedback and update `Task Status` manually accordingly.

### 3.5 Report Numbers Page Updates (`/dashboard/report-numbers`)
* **Legacy Column Removal**: Remove the static volunteer assignment column.
* **New Campaign-Centric Columns**:
  * Dynamically render a column for **each active campaign**.
  * Display task status per report number with color coding:
    * 🟢 **Active Task**: Green
    * 🔵 **Completed Task**: Blue
    * 🔴 **Paused Task**: Red

### 3.6 Picklist, Field Management & Custom Fields UI Restructuring
Applies to:
* `/dashboard/picklists`
* `/dashboard/fields`
* `/dashboard/custom-fields`

**Changes**:
1. Separate combined fields into dedicated tabs:
   * **Contact / Mekurev Tab**
   * **Contact / Shliach (Activist) Tab**
2. Add a new dedicated **Tasks** category tab across all three configuration pages.
3. In `/dashboard/picklists`, add a new picklist category under **Tasks** for custom task dates.

### 3.7 New Role: Campaign Manager
* **Permissions Summary**:
  * ❌ **Forbidden**: Viewing/editing Contacts, Visits, and global System Settings.
  * ✅ **Allowed**: Full management of **Apartments**, **Tasks**, **Campaigns**, **Volunteers**, and the **Volunteer View Settings** page.

---

## 4. Implementation Requirements & Workflow

```
+-----------------------------------------------------------------------+
|                           MANDATORY STEP                              |
|                                                                       |
|  Draft comprehensive plan.md -> Request User Approval -> Code Phase  |
+-----------------------------------------------------------------------+
```

1. **Phase 1**: Architecture & DB Migration Plan (`plan.md`).
2. **Phase 2**: Database Schema Migration & Entity Models setup.
3. **Phase 3**: Backend APIs & Access Control Logic update.
4. **Phase 4**: Admin & Campaign Manager UI Implementation.
5. **Phase 5**: Activist UI & Homepage dynamic sync integration.
