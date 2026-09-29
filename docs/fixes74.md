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
