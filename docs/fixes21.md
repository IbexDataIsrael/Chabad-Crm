# Development Plan: Shliach Permissions & Apartment Name Concatenation

Review this plan and confirm understanding before starting any implementation code.

## 🚨 1. [Unfixed Bug] Shliach Role Display Issues
- [ ] **Problem**: Users assigned the `shliach` role cannot view any apartments on their dashboard.
- [ ] **Context**: Even when a `report_number` associated with an apartment is properly assigned to a Shliach contact, the apartments table/view remains completely empty.
- [ ] **Reproduction / Test Case**: 
  - Log in as a user with the `shliach` role.
  - Use account email: `ibexdatateam@gmail.com` (Contact ID: `234`).
  - **Expected Result**: The user should see all apartments associated with their assigned report number.
  - **Actual Result**: Zero apartments are displayed.

## 🏢 2. Apartment Name Display Bug
- [ ] **Problem**: The apartment name formatting needs to consistently show both the number and floor.
- [ ] **Requirement**: Change the apartment name display logic to be a concatenation of **{apartment number}{floor}** (e.g., if number is "A" and floor is "2", it must display as **A2**).
- [ ] **Required Views to Update**:
  - [ ] **Building Detail View**: `/dashboard/buildings/2`
  - [ ] **Main Apartments Table**: `/dashboard/apartments`
  - [ ] **Single Apartment View**: `/dashboard/apartments/128`
