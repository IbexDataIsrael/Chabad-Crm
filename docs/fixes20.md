# Development Plan: Settings Dashboard, Contacts, Apartments, and Role Fixes

Before implementing any code changes, review this plan to ensure all requirements are understood and tracked.

## 🛠️ 1. Settings Dashboard & Bug Fixes
- [ ] **Organization Logo Save Issue**: Fix the bug preventing the organization logo from saving correctly in the backend/database.
- [ ] **Header Logo Display**: Ensure the successfully saved Organization Logo is properly fetched and displayed in the application header.

## 👥 2. Contacts (Mekurav & Shliach)
### Mekurav View
- [ ] **Missing Field**: On the single contact display page (`/dashboard/contacts/202`), fix the bug preventing the `admin_area` field from being visible.

### Shliach View & Fields Configuration
- [ ] **Default Field Hiding**: Update the contact display and edit modes (e.g., `/dashboard/contacts/233`) to hide the following fields by default during data seeding/initial load:
  - `Assigned to`
  - `Coordinates`
  - `Color`
- [ ] **Fields Toggle Settings**: Add configuration toggles for `Assigned to`, `Coordinates`, and `Color` into the `/dashboard/fields` settings page to allow users to unhide them.

## 🏢 3. Apartments Module
### Filters & Visibility (`/dashboard/apartments`)
- [ ] **Searchable Filter**: Add a searchable dropdown filter for `report_number` to the main apartments table.
- [ ] **Column Visibility**: Add `report_number` as an optional column within the "Visible Columns" selector.

### Name Concatenation Logic
- [ ] Update the apartment name display logic to dynamically concatenate **[Apartment Number] + [Floor]** across the following views:
  - [ ] Building details page (e.g., `/dashboard/buildings/2`)
  - [ ] Main apartments table (`/dashboard/apartments`)
  - [ ] Single apartment detail view (e.g., `/dashboard/apartments/128`)

## 🔐 4. Access Control & Role Bugs (Shliach Role)
- [ ] **Apartment Visibility Bug**: Investigate and fix the permissions/query logic where users with the `shliach` role cannot see any apartments.
  - *Context*: Even when a report number associated with an apartment is assigned to them, they see nothing.
  - *Test Case*: Verify using contact ID `234` (Email: `ibexdatateam@gmail.com`).
