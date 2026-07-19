
# Specification: Shliach Role UI Restructuring & Inline Editing

This document outlines the modifications required to adapt the application UI for the **Shliach (Courier / שליח)** role. It covers hiding the Reports menu and transitioning the existing edit behaviors in both the **Building** and **Apartment** modules to inline editing.

make fixes30-plan.md first

---

## STATUS: code DONE and verified — UNCOMMITTED, awaiting the user's own commit/push

Plan: `docs/fixes30-plan.md` (written first, per the instruction above).
Evidence: 14/14 headless-Chrome checks, 320 backend tests, `tsc --noEmit`
clean. No backend code changes (both PUTs already accept partials); one new
seeded string (`buildings.address_required`).

**Git/deploy state (2026-07-17):** all changes live uncommitted in the
working tree (plus local safety branch `backup/fixes29-30-original`);
`origin/main` was reset back to the user's `34fa62e` at their demand — the
user commits and pushes themselves as **IbexDataIsrael** (Render/Vercel only
deploy commits from that account). Note: the Vercel production domain is
currently serving this build via an unauthorized CLI deployment (watcher
mishap, see conversation of 2026-07-17) — the user decides whether to roll
it back or let their own git push supersede it.

- **§1** `reportItems` empties for shliach in `app/dashboard/layout.tsx` — an
  empty NavMenu renders nothing. Drive-verified: admin sees דוחות, shliach
  nav shows only מקומות/עוד.
- **§2** Apartment detail page fields edit in place (InlineEdit, the contact
  page pattern): text fields save trimmed-or-null partials on Enter/blur,
  Escape reverts, selects (floor / picklists / report number / building)
  commit on selection; phone/email get the shared validation hints. Each
  save is a fixes19 versioned edit — the page follows the new active id
  (drive: 83→84 on rename, 84→85 on floor change; values persist across
  reload). The "ערוך" button is gone; historical (admin-viewable) versions
  render read-only. The `/apartments/edit/[id]` route stays for the
  buildings pages' `?return=` flows.
- **§3** Building detail page: name / address / area edit in place for
  admins (backend PUT is admin-only; non-admins keep plain text —
  drive-verified with a shliach session). Address rejects an explicit empty
  value inline. Floors, coordinates/map and apartment management stay on
  `/buildings/edit/[id]` (link kept).

---

## 1. Role-Based Navigation Restriction (Shliach)

### Goal
Hide the "Reports" menu item from the navigation system when the active session belongs to a user with the **Shliach** role.

### Implementation Requirements
* Locate the main application navigation/sidebar component.
* Check the current user's role context.
* Exclude the **Reports** menu/option link from being rendered if the user's role is `shliach`.

---

## 2. Inline Editing: Apartment Module

### Goal
Convert the existing edit flow for the **Apartment** module into an inline-editable interface.

### UI/UX Requirements
* **Triggers:** Replacing the current edit form or modal redirect with an in-place interaction. Clicking the target value (or an adjacent edit icon) switches the element into its active edit state.
* **Input Behavior:** Render an inline input field pre-populated with the current value.
* **Save Conditions:**
  * Pressing `Enter` or loss of focus (`onBlur`) saves the value by calling the existing update logic.
  * Pressing `Escape` cancels the edit and restores the original value.
* **Visual States:** Provide a subtle visual indicator (such as a border change or hover highlight) to show the element is editable.

---

## 3. Inline Editing: Building Module

### Goal
Convert the existing edit flow for the **Building** module into an inline-editable interface.

### UI/UX Requirements
* **Triggers:** Clicking the building identifier or field triggers the transition from static text to an editable state.
* **Input Behavior:** Render an inline input field pre-populated with the current building value.
* **Save Conditions:**
  * Pressing `Enter` or losing focus (`onBlur`) saves the change using the current edit/update execution path.
  * Pressing `Escape` aborts changes and resets to the previous value.
* **Visual States:** Distinguish the editable field with clear hover and active-input states to maintain usability.