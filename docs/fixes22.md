# Development Plan: Settings Regression & Shliach Editing with History Tracking

Review this plan and confirm implementation logic before modifying any files.

## 🚨 1. [CRITICAL REGRESSION] Settings Dashboard Logo Bugs
These issues were not resolved in the previous batch and require immediate attention.

- [ ] **Organization Logo Not Saving**: Fix the underlying backend, API, or database save failure preventing the organization logo from persisting upon form submission.
- [ ] **Header Logo Missing**: Ensure the successfully saved Organization Logo is accurately fetched from the system and rendered properly inside the global application header component.

## 🏢 2. Shliach Apartment Editing & Version History
Expand the capabilities of the `shliach` role using the project's existing history framework.

- [ ] **Enable Shliach Edit Permissions**: Update the access control layer (RBAC/policies) to allow users with the `shliach` role to edit the apartments assigned to them.
- [ ] **Integrate Version Tracking**: Ensure all apartment edits made by a Shliach hook into the already implemented versioning/history infrastructure to log changes automatically.
- [ ] **Admin History & Restore View**: 
  - [ ] Build/update an administrative view where users with the `admin` role can inspect the chronological history of edits for any apartment field.
  - [ ] Implement a "Restore" function allowing Admins to roll back data to a previous state on a per-field basis.
