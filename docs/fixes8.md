# Feature Specification: Building Management & Performance Optimization

 **Crucial Rule:** Write a detailed technical implementation plan to `fixes7-plan.md` outlining specific file edits, component changes, and database migrations **before** writing any functional code.



## 1. Building Structure, Floors, and Sort Order

### A. Default Initialization
* **Requirement:** Every new building created in the system must automatically be initialized with a baseline configuration of **8 floors** by default.
* **Implementation Note:** Ensure the creation logic/API payload populates the floor sequence `[1, 2, 3, 4, 5, 6, 7, 8]` automatically unless explicitly overridden.

### B. Post-Creation Editing Flexibility
* **Requirement:** Provide users with the ability to dynamically add or remove floors from any specific building after its initial creation.
* **UI/UX:** This capability must be accessible directly via the building's **Edit Screen**. Altering floors should be intuitive and independently manageable per building to accommodate custom structural layouts.

### C. Apartment Display Page Sorting
* **Requirement:** Integrate robust sorting functionality into the primary apartment display page grid/view.

### D. Default Sorting Hierarchy
* **Requirement:** Establish a dual-level default sorting mechanism for displaying apartments. 
* **Hierarchy:**
  1. **Primary Sort:** Sorted by **Floor** (e.g., ascending/descending depending on view configuration).
  2. **Secondary Sort:** Within each individual floor, apartments must be sorted internally by **Apartment Number**.

---

## 2. Page Load Speed Optimization via Built-in Initial Filtering

> **Context:** The system handles massive datasets. To prevent performance bottlenecks, unmitigated full-table scans, and catastrophic DOM slowdowns, the following data-loading patterns must be strictly enforced.

### A. Default Pre-Filtering
* **Requirement:** Prevent the simultaneous loading of all global data when a user lands on the page. 
* **Behavior:** Upon initialization, the system must automatically apply a default filter targeting the **first region** available in the system (or fallback to the **first building** if no region is present). The view will instantly render only this subset of data.

### B. On-Demand Fetching (Lazy-Loading)
* **Requirement:** Restrict data fetching exclusively to the apartments and buildings belonging to the currently active filter.
* **Behavior:** The application must **not** eager-load other regions/buildings in the background. A new server/database query should only trigger when the user explicitly and actively modifies the filter via the UI dropdown component.

### C. Client-Controlled Pagination
* **Requirement:** Introduce server-side pagination to further restrict data payloads.
* **Configuration:** The client interface must provide a dropdown to choose the page volume. The supported page sizes are:
  * **20** items per page
  * **50** items per page
  * **100** items per page

---

## 3. Authentication & Deep Linking (Protected Routes)

### A. Conditional Redirect Behavior
* **Requirement:** If an unauthenticated user attempts to access any protected view or explicit URL within this module, they must be gracefully intercepted.
* **UX Flow:** 1. Intercept the unauthenticated request.
  2. Persist the requested target URL path (e.g., via state or query parameters like `?redirect=/buildings/edit/4`).
  3. Redirect the user to the **Login Page**.
  4. Upon successful authentication, immediately route the user back to their originally intended destination page instead of the generic dashboard.