# Change Request Specification

## 1. Contacts – Visits UI
- Implement design updates and selection ordering for **Mivtsoim** items checked during a visit.
- **Checked Items Sorting:** Automatically reorder checked items to display at the top of the list.
- **Visual Distinction:**
  - Increase font weight/size for selected items to make them easily distinguishable.
  - Accentuate checked item selection colors (e.g., intensify shade to a vibrant pink).

---

## 2. Active User Creation Without Email (Manual Users)
- **Use Case:** Enable registering activist users who do not require digital system login access.
- **Email Requirement Logic:**
  - Keep the **Email** input field as required by default.
  - Add a **"Manual User"** checkbox positioned beneath the email input field.
  - Checking **"Manual User"** dynamically bypasses/disables the email validation requirement and marks the user appropriately in the database payload.

---

## 3. Filter Dropdown Performance & Behavior Fixes
- **Building Filter Performance (2 Instances):**
  - Fix performance lag/freezing caused by rendering large default lists of buildings.
  - Limit the initial render state to the top 100 buildings.
  - Dynamically update and fetch building list results via live user search input.
- **Dropdown Item Order:**
  - Fix filter component state preservation so selecting an item does not jump or move that item to the top of the dropdown list.
  - Maintain consistent, static item ordering upon selection.

---

## 4. PDF Page Numbering Scoped to Report ID
- **Per-Report Page Counters:** Reset page numbers for each individual `Report ID` rather than using a global aggregate document page count.
- **Batch Document Formatting:** When generating/printing multi-report batch PDFs, format headers/footers to display isolated counters per report instance (e.g., `Report #100 - Page 1 of 2`).

---

## 5. PDF Header Row Consistency
- **Table Header Enforcement:** Guarantee table headers render exactly once at the top of every generated PDF page.
- **Mid-Page Break Fix:** Fix layout rendering defects where pages starting mid-section (or mid-building/property block) render without repeating the required table header row.

---

## 6. Dynamic PDF Header Font Sizing
- **Responsive Header Typography:** Implement dynamic text scaling for PDF table column headers.
- **Text Wrapping Protection:** Automatically reduce header font size when column widths shrink to avoid single-character vertical text wrapping.CH