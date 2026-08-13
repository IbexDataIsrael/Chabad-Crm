# 📋 Application Updates & Bug Fixes

## 1. Database Schema & Seeding (Mivtzoim Migration)
make fixes39-plan.md before
### 🚨 Critical Constraint
Organisation with `id=1` already contains these values. Ensure the script drops existing custom fields with `entity_type = 'visit'` and recreates them, or implements a conflict-check to ensure data is **never seeded twice**.

### 📉 Step 1: Table Cleanup
Remove the following hardcoded **Mivtzoim fields** from the `visits` table:
1. `tefillin`
2. `tzedakah`
3. `shabbat_candles`
4. `torah_pamphlet`

5. `letter_in_torah`
6. `connection_to_rebbe`

### 🌾 Step 2: Custom Fields Data Seeding
Instead of hardcoded columns, seed custom fields using the existing production database data where:
* `entity_type = 'visit'`
* `organisation_id = 1` (Set as default values for any new organisation created)

---

## 📊 2. Dynamic Visit Breakdown

When displaying visits in the **Single Contact view** or on the **Contacts / Visit-Summary page** (refer to `fixes38.md`), calculate the summary breakdown dynamically:

* **Query Logic:** Dynamically fetch all active custom fields where `entity_type = 'visit'`.
* **Aggregation:** Generate the summary count metrics based on these custom field data sets.
* **Localization:** Display the item names using their respective **Hebrew label / English label** configuration.

---

## 📱 3. Mobile Drag-and-Drop Configuration

### ⚠️ Current Issue
The current drag-and-drop implementation for sorting **Contacts columns** and **Apartments** looks broken and messy on mobile viewports. Because the target users primarily access the application via mobile devices, this requires a mobile-first overhaul.

### 🛠️ Solution Implementation
Integrate the **SortableJS** library to handle reordering seamlessly on touch screens. 

#### Core JS Initializer Snippet
```javascript
// Example implementation for standard lists/columns
new Sortable(columnsContainer, {
    animation: 150,
    ghostClass: 'sortable-ghost',   // Class name for the drop placeholder
    chosenClass: 'sortable-chosen',  // Class name for the chosen item
    dragClass: 'sortable-drag',      // Class name for the dragging item
    fallbackTolerance: 3,            // Allows for minor finger movement before triggering drag (crucial for mobile)
    delay: 300,                      // 300ms long-press delay to prevent accidental dragging while scrolling
    delayOnTouchOnly: true           // Apply long-press delay restriction exclusively to mobile/touch screens
});
```

#### Nested Structure Snippet (For Complex Layouts / Apartments)
When handling nested sortable blocks, apply these configuration properties to prevent layout breaking:
```javascript
new Sortable(nestedApartmentContainer, {
    group: 'nested',
    animation: 150,
    fallbackOnBody: true,    // Appends the cloned DOM element to the body during drag to prevent container clipping
    swapThreshold: 0.65      // Lower threshold allows for easier item evaluation on tight mobile viewports
});
```

---

## 📈 4. Reports Page Update

* **Feature Request:** Add a permanent **"Save" button** directly to the report page.
* **Behavior:** Clicking this button must explicitly persist all data inputs inserted by the user on the report screen.
