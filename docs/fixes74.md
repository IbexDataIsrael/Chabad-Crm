MINICRM - FIX LIST

Work in the existing minicrm repository. Read the current code first; the notes below describe behavior as last observed and may have changed. Make small commits. Do not push or deploy. When done, stop for review and report what changed by item number. If a fix needs a product decision that is not covered here, stop and ask before coding that part.

1. COPYABLE ASSIGNMENT LINK
In the Tasks page, next to the print button, show a copyable direct URL that assigns the task/report number. Today only a printed QR code exists. Reuse the QR target after checking its route; do not invent a different link.

2. "AVAILABLE" STATUS
Add the status "פנוי" (available). Unassigned task = פנוי. Assigned and active task = נלקח (taken) - this replaces "פעיל". Completed and paused stay as they are.

3. BULK TASK CREATION
Today selecting several report numbers saves them all on ONE task. Add a mode that creates one separate task per selected report number, or per number in a range (example: 10-40). Keep the existing one-task/many-reports option too. Skip numbers that do not exist. If a number in the range already belongs to a task, show a dialog with two choices: cancel everything, or skip the taken numbers and create the rest. Show the conflicting and eligible numbers before the user confirms.

4. MANUAL ASSIGNMENT MARKER
When a task is assigned manually (picking an activist in the Tasks table), record that it was taken manually, set its status to נלקח, and disable its assignment link.

5. RENAME "פעיל" TO "נלקח"
The active status label for an assigned task becomes נלקח. Check labels, filters, exports, translations, and saved records so old tasks still work.

6. PAPER ENTRY BUTTON
The button "הזנת נתונים מדף מודפס" should open the main Apartments view filtered to that task's report numbers. Delete the dedicated paper-entry page (example: /dashboard/tasks/15/paper-entry) and its route, and redirect old links to the filtered Apartments view.

7. TASK NUMBER COLUMN
Show the task number as the first column in the main Tasks table (rightmost in Hebrew RTL). Today it only shows on the task detail page.

8. ENGLISH PDF DIRECTION
Today the PDF code always reverses columns for RTL. Fix: English PDF = columns left-to-right, Hebrew PDF = right-to-left, based on the selected language. Open the actual PDF files and check them visually.

9. MORE PRINT COLUMNS
In Tasks > "עיצוב דף ההדפסה" today only 7 fixed columns are offered. Let the user choose from all relevant apartment/report columns (including report number), and set their order and width. Only selected columns appear in the PDF. Do not expose hidden or private fields.

10. FREEZE IN PRINT SETTINGS
Opening "עיצוב דף ההדפסה" freezes the page, on both computer and phone. The user must refresh or click somewhere unrelated to recover. Find the cause (heavy data processing, re-renders, large lists) and fix it. The dialog must stay responsive. Test on a real phone.

11. LINK REPORTS TO TASKS
Today an activist's completion report has no task ID, so a newer report can show up on an older task. Fix: each task shows the latest report sent AFTER that task was assigned. Add the task link in the report form/API/storage. Leave old unlinked reports untouched - do not guess which task they belong to.

12. ADMIN SEES ACTIVIST VIEW
From the admin side, open a selected activist's own street2 view - the admin sees the same work view the activist sees, with that activist's progress and a timestamped log of mark / unmark / building-complete events. Update when the activist's app syncs, and show the last sync time. This is not a live GPS tracker. Today admin navigation to street2 redirects to Apartments.

13. ORDER FIELDS IN ACTIVIST APARTMENT DETAIL
In "הגדרות לתצוגת פעילים" (activist view settings), let the admin order ALL visible fields in the street2 apartment detail - built-in fields and additional fields. Today built-in fields have a fixed order. Hidden fields stay hidden.

Relevant pages: /dashboard/tasks, /dashboard/street2, /dashboard/shliach-config.

---

## Closeout (2026-09-30)

Status: all 13 items implemented, committed locally, **not pushed / not deployed**.
Commits: 2e1734c (§1/§2/§4/§5/§7), 3659fba (§3), 69af64b (§6), 65ddf6b (§8/§9/§10), 5c6697a (§11), a0a3110 (§13), 3757c9d (§12).
Verification: `tests/test_fixes74.py` (17 tests) + the full backend suite; `tsc --noEmit` clean; every item driven live in Playwright's Chromium against local Postgres org 1 (desktop + phone emulation).
Migrations (run on local Postgres; **must run on Neon at deploy**): 74a1c9e2b301 → 74b2d0f3c412 → 74c3e1a4d523.

- [x] **1. Copyable assignment link** — link icon next to the print button on every Tasks row, plus the full URL with a Copy button on the task page. It is the same `/tasks/claim/<token>` the QR encodes (the API now returns `claim_token`). Live: clipboard held the exact claim URL.
- [x] **2. "פנוי" status** — new stored status `AVAILABLE`. Unassigned = פנוי, assigned = נלקח (ACTIVE). Create, QR claim, manual assign and paper assign all set נלקח; "return to pool" sets פנוי. Contradictory manual changes are refused (400). Migration moved existing unassigned ACTIVE tasks to AVAILABLE.
- [x] **3. Bulk task creation** — the New Task form has a mode switch: "one task for all" (the old behaviour) or "a separate task per number". The second mode takes picked numbers and/or a typed range ("10-40, 55"). Missing numbers are skipped and listed. Before anything is created, a dialog lists eligible / taken / missing numbers, with "cancel everything" or "skip the taken ones and create the rest". The server re-checks conflicts (409 without skip). Live: range 1-6 → created 1,3,5,6, conflict 2 (#45), missing 4.
- [x] **4. Manual assignment marker** — picking an activist in the table (or at creation) records `claimed_via='manual'`, sets נלקח and switches the claim link off: the link shows as disabled, the claim page says invalid, and the printed sheet has no QR. Returning the task to the pool turns the same link back on.
- [x] **5. "פעיל" → "נלקח"** — one shared label source (`lib/taskStatus.ts`) for the Tasks list, task page, create form, filter and Report Numbers status cells. A seed rename switches the DB label (only while it's still the old seed text). The stored value stays `ACTIVE`, so old tasks and the access rules keep working. There is no task CSV export, and the PDFs don't print the status.
- [x] **6. Paper entry button** — opens `/dashboard/apartments?report_number_ids=…` for the task's numbers. The page `/dashboard/tasks/[id]/paper-entry` is deleted. `next.config.js` 308-redirects old links to `/dashboard/apartments?task_id=<id>`, which the Apartments page resolves to the task's numbers. Live: both paths produced the filtered list request.
- [x] **7. Task number column** — `#id` is the first column (rightmost in RTL), linking to the task.
- [x] **8. English PDF direction** — task sheet and apartments report: Hebrew UI = RTL columns, English UI = LTR (text alignment and header mirrored too). Checked visually by rendering both real PDFs to PNG.
- [x] **9. More print columns** — the picker offers report number, building, area, floor, apartment #, resident, phone, email, Jewish status, mezuzah, campaign status, language, notes, plus every custom apartment picklist and custom field. It excludes fields hidden in field settings or by the active campaign, and the internal `to_knock`. The admin chooses the columns and sets order (▲/▼) and width; only selected columns print.
- [x] **10. Print-settings freeze** — **cause found:** not heavy processing. The dialog was a non-scrolling fixed overlay with no Escape/backdrop close. On a short screen it grew taller than the viewport and pushed both ✕ and "סגור" off-screen (measured on a 568px-tall phone: ✕ at y=−94, Close at y=650), so the page looked frozen until refresh. Its chips were also SortableJS drag handles, and a slightly jittery click was swallowed as a drag. Rebuilt as one scrollable list with a sticky header/footer, Escape/backdrop close and no drag library. Live on the same 568px phone: ✕ and Close visible, list scrolls, backdrop tap closes. ⚠️ Tested in phone *emulation* (Pixel 7, iPhone SE), **not on a physical phone** — please try it on a real one.
- [x] **11. Reports linked to tasks** — `shliach_report_completions.task_id` + `tasks.assigned_at`. The activist's report form asks which of their tasks it's about (preselected when they have one), and the API accepts only the activist's own task. Each task shows its latest linked report sent after it was assigned. Old reports stay unlinked and are not attributed to any task. The Messages-from-activists log shows the task #.
- [x] **12. Admin sees activist view** — `/dashboard/street2` for an admin shows an activist picker (no more redirect). There is also an "תצוגת הפעיל" action on activist rows in Users. `?activist=<id>` shows that activist's own apartments/fields, read-only, with progress (doors done / to-knock, buildings completed), the last-sync time and a timestamped log. The activist's app queues events and syncs them on each action, every 60s while open, and when back online; the admin view polls every 30s and reloads on a new sync. Not location tracking. Live: activist marked a door → admin saw it in 24s.
- [x] **13. Order fields in activist apartment detail** — new "סדר השדות בכרטיס הדירה של הפעיל" list in shliach-config covering all built-in and additional fields (▲/▼), saved as `street2_field_order`. street2 applies it; hidden fields stay hidden and are marked in the list. Live: moved report # + notes to the top → activist card showed them first.

### Decisions made (spec gaps)
- §3 "already belongs to a task" = a task **in the same campaign** (any status). Otherwise every number would conflict forever once used in any earlier campaign.
- §4 creating a task with an activist already picked also counts as a manual assignment. Existing assigned tasks were **not** back-filled as manual, so their printed links keep working.
- §6 the backend paper-entry endpoints/table are kept (existing history); only the page and its route are gone.
- §9 "hidden or private" = hidden in field settings, hidden by the active campaign (the sheet goes to activists), or internal (`to_knock`).
- §12 the admin view is read-only; an admin never writes into an activist's log or triggers their building completions.

### Needs your decision (not built)
- **§12 "unmark"**: street2 has no unmark action today. A door counts as done once it has been edited (fixes71), and nothing undoes that. The log and API accept `unmark` events, but nothing emits them. Do you want an explicit "unmark door" button in street2? If so, what should it do to the door's state?