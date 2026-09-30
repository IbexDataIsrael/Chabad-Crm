
UX BUG - AREAS SELECT DROPDOWN ON SINGLE-USER PAGE

On /dashboard/users/[id], the multi-select "אזורים באחריות הפעיל" opens its dropdown detached from the field, about 6x the field width, clipped at the screen edge, and partially covered by the Save button.
Root causes (frontend/components/ui/MultiSelectSearchFilter.tsx and MultiSelectEditor.tsx):
a. The dropdown panel (line ~199) is absolute z-30 mt-1 min-w-[14rem] - a minimum width but no width matching the trigger and no maximum width, so the longest option label stretches the whole panel. Option labels have truncate, but truncate does nothing while nothing constrains the panel width.
b. The panel has no left/right/start anchor class, so in RTL it grows leftward past the field and gets clipped by the screen edge. This is the "detached" look.
c. The Save button in MultiSelectEditor has z-index 50, so it paints over the z-30 dropdown where they overlap.
Fix: make the panel the same width as the trigger (w-full, keep the minimum width), anchor it to the start side directly under the trigger, cap it within the screen on small screens, and put it above the Save button. Long labels should then ellipsis correctly. This component is shared (contacts, users list, tasks, apartments) - verify the fix does not break those pages.


GENERAL REQUEST - ALL MULTISELECT COMPONENTS
The flaws above live in the shared MultiSelectSearchFilter/MultiSelectEditor, so the same bug can appear anywhere a MultiSelect is used. Audit every MultiSelect-family component in the system (search the frontend for "MultiSelect" in components and pages) and apply the same fix pattern everywhere: panel matches the trigger width, anchored directly under the trigger, capped to the screen, stacked above surrounding buttons, long labels ellipsis. In your final report, list every MultiSelect component and every page you checked and what you changed in each.

---

## Closeout (2026-09-30) — DONE locally, live-verified, NOT committed

Verified live against local Docker (localhost:3001) with Playwright's bundled Chromium at 1366x800 and 390x844 (mobile). For each open panel the drive measured: panel inside the screen, gap under the trigger (4px everywhere), start edge aligned with the trigger (or shifted back from a screen edge), nothing painting over the panel (elementFromPoint), and long labels ellipsized. `/api/areas` was intercepted so one area has a ~90-char name to test long labels. `npx tsc --noEmit` is clean.

### Bug — areas dropdown on /dashboard/users/[id]
- [x] a. Panel width = trigger width (`w-full`, with the minimum width kept: `min-w-[min(14rem,100vw-1rem)]`, `max-w-[calc(100vw-1rem)]`). Evidence: users/134 panel 718px = trigger 718px on desktop, 308 = 308 on mobile; the long area label ellipsizes.
- [x] b. Anchored `start-0 top-full` directly under the trigger. New `components/ui/useKeepInViewport.ts` moves the panel sideways, only when needed, so it stays inside the screen and inside any ancestor that clips overflow (the apartments table's scroll frame clipped 16px before this).
- [x] c. Stacking: the panel is `z-40`, and MultiSelectEditor's Save button is no longer `relative z-50`, so the panel paints over Save. Evidence: `covered []` on every editor.
- [x] Knock-on fix: now that the panel covers Save, Esc has to close only the panel. Before, Esc bubbled up to InlineEdit and cancelled the whole edit. Esc is now caught on the picker root while the panel is open. Evidence: apartments/1 language editor — first Esc closes the panel and keeps the editor; a second Esc cancels as before. users/134: Save is visible after Esc.

### General — every MultiSelect-family component
Components:
- `components/ui/MultiSelectSearchFilter.tsx`: panel width/anchor/clamp/z-40; trigger is a flex row, so the selected summary now truncates (before, the `truncate` sat on an inline span and did nothing); `title` tooltips; root `max-w-full`; Esc handled on the root.
- `components/MultiSelectFilter.tsx` (older sibling): same panel contract (min 12rem); option labels and trigger summary truncate with `title`; new `className` prop; Esc handled on the root.
- `components/ui/MultiSelectEditor.tsx`: Save button z-index removed (point c).
- `components/AreaMultiSelect.tsx`: new `className` pass-through.
- `components/ReportNumberMultiSelect.tsx`: checked; no change needed (it only wraps MultiSelectSearchFilter). Nothing renders it right now.
- In-form pickers are now full width like the fields around them: `ContactForm` (areas), `TaskQuickCreateForm` (report numbers), `ApartmentEditor` (language). Before, they were content-width (e.g. 83px), which made the panel look detached.

Pages checked live (desktop + mobile), all passing:
- Filter bars: contacts (5), apartments (6), tasks (2), users (4), buildings (2), areas (1), shliach-config (5).
- Inline editors: users/[id] areas (the reported bug), users list areas cell (column forced visible through an intercepted prefs response; the admin's saved prefs were not changed), tasks/[id] report numbers, contacts/[id] areas (ContactView), apartments/1 language, apartments list language cell.
- Forms: contacts/new-shliach, apartments/edit/1, the new-task modal, reports/create (both "by report number" and "by apartments" modes; the second waits for all ~25k apartments to load).
- Not driven separately: contacts/new (same ContactForm; the areas field only appears for shliach). Its code is the same as new-shliach.

Known limit (not changed): inside the new-task modal the panel runs below the modal's bottom edge. The modal form scrolls, so the rest of the list is reachable by scrolling the form. Keeping a dropdown inside a scrolling modal would need a portal/popover rewrite, which this spec didn't ask for.
