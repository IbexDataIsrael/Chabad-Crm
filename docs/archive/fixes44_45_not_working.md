# CRM Task Specification: Users Module (`dashboard/users`) Fixes & Enhancements

## Overview
This specification addresses ongoing issues and missing features on the **Users** module (`dashboard/users`). The goal is to bring full feature parity between Users and Contacts, enable editing history, support dynamic column customization, and fix inline editing behavior.

---

## 1. Table Display & Parity with Contacts
- **UI Parity:** Ensure `dashboard/users` strictly mirrors the layout, styling, and grid functionality of `dashboard/contacts`.
- **Inline Editing:** 
  - Enable inline editing on user table cells matching the Contacts implementation.
  - **Unlinked Users Exception:** If a user does **not** have an associated contact record, display a dash (`-`) in missing field cells and **disable inline editing** for those fields/rows.

---

## 2. Dynamic Columns & Customization Fixes
- **Dynamic Column Support:** Ensure the Users table supports optional display for all existing columns as well as any custom fields/columns added dynamically in the future.
- **Customize Columns Modal / Drawer:**
  - Fix the existing "Customize Columns" feature on `dashboard/users`.
  - **Visibility Controls:** Display all available/optional columns in the configuration menu with toggle switches or checkboxes.
  - **Drag-and-Drop Reordering:** Enable drag-and-drop handles so users can reorder columns, persisting the custom order in local/user preferences.

---

## 3. User History & Audit Log
- **Single User View / Drawer:** When clicking into an individual user record, provide an **Audit / Edit History** log.
- **Parity with Apartment History:** Mirror the edit history timeline pattern currently used in the Apartment module, displaying timestamp, user/actor, field changed, previous value, and new value.