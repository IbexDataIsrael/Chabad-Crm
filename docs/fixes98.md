system emails 
When an activist registers to the system via the org's URL (org/sb for example) he should get a standard welcome email with link to the system  (org/sb for example)
also when an activist registers via barcode, an email should be sent
New task email
When assigning a task to an activist, send an email informing the activist “a new task has been assigned to you.” Translate this message to Hebrew, add both Hebrew text and English text to the email. The text for Hebrew and English can be edited from dashboard/shliach-config. (see below)
if this is not a text task , add the address of the first address of the task
Add the link in (1) to new task email too

Configuration section
The section is getting crowded; add tabs by topic

shliach-config
The section is getting crowded; add tabs by topic
Task email text - text for Hebrew and English can be edited from here (see emails section)


Make new tab “messages for activists”. For this, make a new SQL table. The required fields: text, language.
 display 2 lists: Hebrew and english 
Enable dynamic insertion of text to this list
create a new sql table with computed data (per org) : number_of_apartments, number_of_jews, organization_name
On system load, if the table has no data for this org, calculate this data and insert  (once)
Enable editing of this data in the configuration section
Add a button “recalculate” to recalculate data 
8. The first message should be seeded to the system as 
 "הידעת שבמערכת {organization_name} רשומים כבר {number_of_apartments}  אלף דירות ומתוכם {number_of_jews} יהודים" 
8. make the same seeded message in english
9. Leave the calculated field names and replace them on activist system



task
Add the option to have a “text task” rather than a report number. You should add text field to task entity on the database. when creating a new task admin can choose this option.




Activist system 
for every apartment that opens, add 
a close button on top 
swipe: if the user swipes left or right they should see the apartment before (left) or the apartment after (right)
for each building, add a button to sort all apartments from top to bottom . (right now its only bottom to top)
display of celebration text: the text should be displayed after finishing (at least 1 edit) 5 apartments. one time - show regular celebration text the second time - show a message from “messages for activists”. make sure to merge the 2 types of text to array on the client on first load


users 
should be able to change password without typing the old password

---

## Status — closeout (2026-10-11)

Committed ed5bc14 (not pushed). Migration `98a1b2c3d4e5` (applied locally).
Backend: `tests/test_fixes98.py` (14 tests). Frontend: `tsc --noEmit` clean,
`node --test lib/celebrationItems.test.mjs` (5 tests). Live-driven in
Playwright's bundled Chromium against local Docker (admin pages at desktop
width, street2 as activist #134 on a 390px touch viewport).

### System emails
- [x] Registration via the org page (`/org/<slug>`) → standard welcome email
      (`shliach_welcome` template, org logo), its link = `/org/<slug>`.
      Test `test_org_page_registration_sends_welcome_with_org_link`.
- [x] Registration via a task QR ("barcode") → same email.
      Test `test_qr_registration_sends_welcome`.
- [x] New-task email when a task is assigned to an activist — on create,
      bulk create (one email listing all the tasks) and reassign; not on
      other edits or on the activist's own QR claim. Hebrew + English text
      (both in the email), editable in shliach-config → "New-task email";
      defaults "שובצה לך משימה חדשה." / "A new task has been assigned to
      you.". Per task: campaign + the first address (first building by
      address), or the text of a text task. Same `/org/<slug>` link.
      Tests `test_assigning_a_task_emails_the_activist_with_first_address`,
      `test_task_email_text_comes_from_shliach_config`,
      `test_reassign_emails_but_unrelated_edit_does_not`,
      `test_bulk_assignment_sends_one_email`; rendered HTML checked visually.
- Note: emails are sent in a background task after the response; a failure
      is logged, never fails the assignment/registration.
- Not live-sent: local Docker has real SMTP credentials, so I didn't trigger
      these emails against real addresses — covered by tests + rendering.

### Configuration section (Settings)
- [x] Tabs: General · Public page & sign-up · Activist data · Backup &
      restore · Password (non-admins see only the password form). The
      chosen tab is remembered. Live-verified.

### shliach-config
- [x] Tabs: Apartments view · Activist profile · New-task email ·
      Home-page announcements · Messages for activists. Live-verified
      (save + reload keeps the tab and the saved text).
- [x] Task email text (Hebrew + English) edited here.
- [x] "Messages for activists" tab — new table `activist_messages`
      (`text`, `language`, + `sort_order`). Two lists (Hebrew, English); add /
      edit / delete; "insert field" chips put `{organization_name}` /
      `{number_of_apartments}` / `{number_of_jews}` at the caret.
      Live-verified (added "Great work! {number_of_jews}" via the chip).
- [x] New table `org_activist_stats` (per org: `organization_name`,
      `number_of_apartments`, `number_of_jews`). Computed once, the first
      time the org needs it (admin pages or the activist app loading);
      editable in Settings → Activist data, with a "Recalculate" button.
      `number_of_jews` = apartments with any Jewish status (same definition
      as the report-number/area "Number of Jews").
- [x] Seeded first message, Hebrew (as given) + English, created together
      with the stats row — once per org (deleting all messages doesn't
      bring them back).
- [x] Field names stay in the stored text and are replaced on the activist
      device. Live: "…רשומים כבר 26,241 אלף דירות ומתוכם 6,755 יהודים".
- ⚠️ **Open question:** the seeded sentence says "{number_of_apartments}
      **אלף** דירות" / "thousand apartments", but the computed value is the
      real count (26,241 locally) → "26,241 אלף דירות". Either edit the
      message (drop "אלף"/"thousand") or set the number in thousands in
      Settings → Activist data. I kept the text exactly as specified.

### Task
- [x] `tasks.task_text` column. New-task form: third option "Text task
      (instead of report numbers)" with a text box. A task can't have both
      (400). Tasks list shows the text; the task page edits it. Activists
      see their text tasks on their home page ("My tasks"). Live-verified
      (created a text task without an activist).

### Activist system (street2)
- [x] Close (X) button on top of the opened apartment (sticky).
- [x] Swipe left = apartment before, swipe right = apartment after (in
      on-screen order, across buildings; ignored while editing a field or
      for short swipes). Also ‹ › buttons + "n/N" for non-touch devices.
      Live-verified with real touch events.
- [x] Per building: "Top to bottom" / "Bottom to top" floor order toggle
      (remembered per user). Live-verified floors 1-4 → 4-1.
- [x] Celebration every 5 finished apartments (first edit): one list built
      on first load, alternating the regular celebration text (Rebbe quote)
      and the activist messages (in the activist's language). Live-verified:
      5th door → a quote, 10th door → the seeded message with values filled.
      If the 5th door also completes a building, the building celebration
      shows (carrying that item).
- Not done: `/dashboard/route` ("Jewish points BETA", a copy of street2)
      was not changed.

### Users
- [x] Change password without the old password (Settings → Password has
      only new + confirm). The API still rejects a wrong old password if
      one is sent. Test `test_change_password_without_current`.

### Also
- Migration also adds `organizations.public_footer_html_en` (guarded): the
      model already had the column from the public-footer work but no
      migration, which broke every organizations query against Postgres.
- Added 5 missing localization rows from that same footer work.
