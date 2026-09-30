# fixes87 — clone for demos: activists with tasks drive what's cloned

Requested 2026-10-01 (spec; open questions below, nothing implemented yet).

## Request (as given)

- Copy activists. Before cloning, ask **how many activists**.
- Only clone activists **that have a task** (the clone is for demo purposes).
- The apartments cloned **must be the apartments in those activists' tasks**.
- If those tasks hold more apartments than the apartments number asked for,
  clone them anyway and tell the user, e.g. "214 apartments cloned!".
- If more activists have tasks than asked for, take the activists with the
  **most apartments**.
- Tasks of activists that are not part of the clone are not cloned.

## Facts (prod org 1, read-only, 2026-10-01)

Tasks reach apartments via report numbers (`task_report_numbers` → apartments
with that `report_number_id`). Every task needs a campaign (`campaign_id` NOT
NULL) and is assigned to an activist's login (`volunteer_user_id` → users).
Clone currently copies neither campaigns nor users.

| activist | tasks | task apartments | buildings |
|---|---|---|---|
| קישון מענדי (31) | 3 ACTIVE/COMPLETED | 171 | 64 |
| שמואל אסייג (41) | 1 COMPLETED | 164 | 1 |
| פעיל טסט (16) | 3 ACTIVE | 157 | 109 |
| Raices Menachem mendel (38) | 1 ACTIVE | 61 | 2 |
| Srulik Traxler (35) | 1 ACTIVE | 48 | 1 |
| (no activist) | 8 ACTIVE/AVAILABLE | 557 | 142 |

## Open questions

1. ~~Logins for cloned activists~~ **DECIDED (b):** made-up demo logins
   (e.g. `activist1@demo.local`) with one password typed on the clone page —
   the real people never see the demo org; the presenter can log in as an
   activist to demo street2.
2. **DECIDED:** the user gives N activists + a target number of apartments.
   The system picks the N activists (with tasks) whose task apartments add up
   **closest to the target**, and clones exactly their task apartments
   (no whole-building rounding; buildings/areas/report numbers follow).
3. **DECIDED:** take as many apartments as those activists' tasks hold, even
   above the target.
4. **ASSUMED (recommendation, not answered):** tasks with no activist are not cloned.
5. **ASSUMED:** ACTIVE, AVAILABLE and COMPLETED tasks all count as "has a task".
6. **ASSUMED:** only the campaigns of the cloned tasks are cloned.

## Flow (decided)

- Clone page asks: number of activists, target apartments, demo password.
- "המשך" shows a **preview**: "המערכת תשכפל N פעילים ו-X דירות" + the chosen
  activists (name, tasks, apartments). The user **approves or cancels**;
  nothing is cloned before approval.
- After cloning, the message states the real counts.

## Answers received later

- 3: OK as built (take as many apartments as the tasks hold). The preview lets
  the user change the activist count / target and recalculate before approving.
- 4: don't copy tasks with no activist (as built).
- 5: all task statuses count (as built).
- 6: copy the campaigns (as built).
- 7: clear out contact emails and phone numbers; put demo data instead.

## Closeout (all done, not committed)

- [x] `POST /api/admin/organizations/{id}/clone-plan` → the N activists (with
      tasks) whose task apartments are closest to the target (exhaustive
      search when small, greedy + swaps otherwise); nothing is written.
- [x] Clone with `demo_activist_user_ids` + `demo_password`: demo logins
      `activistN@org<id>.demo`; their activist cards/snapshots (user_id → demo
      login); their tasks (volunteer → demo login), task↔report numbers,
      campaigns (+ campaign_field_visibility); exactly their task apartments
      (every version), those buildings, their areas, the report numbers.
      Other activists' cards and tasks are not copied.
- [x] §7: every clone replaces emails/phones in contacts, activist snapshots
      and apartments with demo values (`personN@org<id>.demo`, `050-000000N`),
      one real value → one demo value; the activists' cards get their demo login.
- [x] Clone page: activists / target / demo password → "המשך — חישוב" →
      preview ("המערכת תשכפל N פעילים ו-X דירות" + table) with recalculate →
      approve → result ("187 דירות שוכפלו! 2 פעילים, 2 משימות") + demo logins.
      The fixes86 whole-building path remains in the API (no activists).
- [x] **Bug found + fixed:** deleting an org with tasks failed
      (ForeignKeyViolation tasks → users); the delete list was hand-kept and
      missed 10 tables. `_delete_organization_cascade` now derives the order
      from the schema. Verified on real Postgres: both demo clones deleted.
- Tests: 4 new (plan choice, exact copy, bad input, demo identities);
  98 passed across superadmin/clone/signup/users/logs suites. `tsc` clean.
- Live-verified locally: full UI flow; a demo activist logged in and saw 134
  assigned apartments + the campaign with report numbers 34, 35, 36;
  0 real emails/phones in a real-Postgres demo clone (33 values checked).
