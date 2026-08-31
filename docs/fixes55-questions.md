# fixes55 — Campaigns & Tasks: understanding + open questions

Working doc for the brainstorm before I write `fixes55.md` proper. Fill in
your answers under each `> ANSWER:` line (delete the `> ANSWER:` placeholder
text and type over it) and let me know when it's ready — I'll read it back
in and we'll continue from there.

---

## What I understand the feature to be

An admin assigns report numbers to an activist. Those assignment *events*,
when close together in time (default 10 min, configurable), bundle into one
**Task** — a work batch. The activist's own apartment list shows dividers
between tasks. Within a task, the activist checks off which specific
apartments they actually visited; unchecked ones are flagged so nobody
re-does the same apartment. The task as a whole gets a status — completed /
partial / not completed — chosen by the activist, but **"Completed" is
blocked (alert modal) unless every apartment in the task is checked off
first**. Editing *any* field on an apartment while its task is open
automatically checks that apartment off (a "dirty form = visited" rule) —
the activist doesn't have to remember to tick it by hand if they've already
done real work reflecting a visit.

All of this optionally belongs to a named **Campaign** (e.g. "Hanukkah
2026") so it can be reviewed later — including which Mivtzoim got
accomplished during it.

## Relevant facts about the current system (so the spec doesn't contradict reality)

- An activist is assigned **report numbers**, not apartments directly
  (`ReportNumberContactShliach`, many-to-many). Every apartment belongs to
  exactly one report number. The activist's apartment list today is
  derived from their assigned report numbers (plus assigned geographic
  areas).
- Assigning report numbers to an activist is a **replace-all** operation
  today — the admin form always sends the activist's complete desired list;
  the backend deletes every existing link and recreates from scratch. There
  is no existing "just add one more" action. Detecting "a report number was
  *newly added*" (for task-bundling purposes) means diffing the new list
  against what was there immediately before the save.
- There's already a **"Report completed" self-service action** (3-way
  status: completed / not_completed / partial + a free-text comment,
  `ShliachReportCompletion` table) that an activist submits from their own
  page today — but it's a generic blob, not tied to which report numbers or
  apartments it's about. Per your answer, the new Task's own status+comment
  replaces this — the tri-state concept survives, it just moves from
  "generic, floating" to "belongs to one task."
- **Mivtzoim** (tefillin, candle-lighting, etc.) are boolean custom fields
  logged per **Visit** (a Visit belongs to a mekurav contact, not directly
  to an apartment — an apartment's "resident" is a linked contact). There's
  no campaign/task tagging on a Visit today.
- There's no existing per-organization numeric-settings mechanism — the one
  generic settings table that exists is platform-wide (superadmin only),
  the wrong place for a per-org "grouping window minutes" value. This would
  need a new home (my instinct: fold it into the org's existing
  `shliach_view_config` settings blob, surfaced on `/dashboard/shliach-config`
  — but flagging it in case you'd rather it live somewhere else).

## Decided so far

- One active campaign at a time — an admin flips a single "current
  campaign" toggle; every task created while it's active auto-tags to it.
- Per-apartment status inside a task: binary done / not-done (a checkbox),
  not a 3-way state.
- A "done" apartment blocks re-visiting **for the active campaign only** —
  it clears automatically once a new campaign starts (so next Hanukkah,
  everything's open again).
- The new Task system **replaces** the old generic "Report completed"
  action. The tri-state status (completed/partial/not_completed) +
  free-text comment now live **on the task**, not as a standalone
  submission.
- "Completed" cannot be selected unless every apartment in the task is
  checked off — a blocking alert modal explains why if the activist tries
  anyway.
- Auto-check trigger: **any saved field edit on the apartment record**
  (while its task is open) automatically checks that apartment off — "if
  the form is dirty, the apartment was visited."

## Open questions

**1. Task creation/merging mechanics.**
Given the replace-all assignment behavior above, detecting "a report number
was added" means diffing old vs. new on every save.
- (a) If an activist already has an *open* task (created within the last X
  minutes) and an admin assigns them more report numbers, should the new
  ones merge into that same open task?
> ANSWER:

- (b) If an admin *removes* a report number from an activist mid-task, does
  anything happen to the task, or is removal simply ignored for task
  purposes (only additions matter)?
> ANSWER:

**2. One activist per task, or can several share one?**
Your schema had `activist_task` as its own join table (many-to-many
capable), but everything else you described reads as personal — one
activist per task. Is there ever a real case where two activists share the
same task, or is that just future-proofing? If it's always one activist, a
plain `contact_shliach_id` column directly on `task` is simpler than a
whole join table.
> ANSWER:

**3. Old completion submissions already in the database.**
Leave the existing `ShliachReportCompletion` rows alone as historical/
legacy data (my instinct — there's no reliable way to know which report
numbers/apartments they were actually about, since that link never
existed), or should something backfill them into the new Task structure?
> ANSWER:

**4. Mivtzoim history — how literal?**
Cheap/minimal: tag each Visit with which task/campaign it happened under
(one new column), so "what Mivtzoim happened during campaign X" is just a
normal filtered query over existing Visit data. Literal: an explicit
before/after snapshot per apartment per campaign (e.g. "mezuzah: missing →
present") — a bigger, separate feature. Which do you want?
> ANSWER:

**5. The activist's own "History" section — history of what?**
Past completed tasks (campaign, date, apartments, status)? Mivtzoim
accomplishments over time? Both? All-time, or scoped to the currently
active campaign only?
> ANSWER:

**6. Admin side — what do you want to look at?**
My guess: a new "Campaigns" admin page — list campaigns (create one, mark
it active), drill into a campaign to see its tasks, each task showing the
activist, its report numbers, status, and the per-apartment checklist.
Should admins be able to manually create/edit a task by hand, or is it
purely system-generated from assignment events (admin can view, maybe
override status, but not hand-create one)?
> ANSWER:
