# fixes16 — Backup & Restore Buttons (organization data)

Specification agreed on 2026-07-12. The goal is deliberately simple: **one
backup button, one restore button.** If an import (or any bulk change) goes
wrong, the admin restores the previous state themselves.

Make `docs/fixes16-plan.md` before you start implementing.

---

## 1. The Backup & Restore card

* **Location:** org settings (`/dashboard/settings`), a new "גיבוי ושחזור"
  card. Org admins only (`require_admin`); everything is org-scoped.
* **"צור גיבוי" (Create backup) button:** snapshots the organization's CRM
  data and saves it as a restore point. Optional free-text note (e.g. "לפני
  ייבוא"). Finishes with a success toast; the new point appears in the list.
* **What version gets backed up:** always the data **as it is at the moment
  the button is clicked** — the database holds only the current state, so
  that is the only thing a backup can capture. The *user* decides which
  versions exist as restore points by choosing when to click (before an
  import, before a bulk edit, after finishing good work). Nothing is backed
  up automatically except the pre-restore safety snapshot (§3).
* **Restore-points list:** date+time, who created it, note, contact count.
  Each row has:
  * **"שחזר" (Restore) button** — see §3.
  * a small **download** link (the snapshot as a JSON file) — nice-to-have.

## 2. Where snapshots live + retention

* Snapshots are stored **in the database** — a new `backups` table:
  organization_id, created_by, created_at, note, row-count summary, and the
  snapshot itself as a **compressed JSON blob**. No files on the server's
  disk (Render's filesystem is wiped on every deploy) and no external
  storage.
* **Retention: the last 10 restore points per organization.** Creating an
  11th deletes the oldest automatically. The limit is a single constant so it
  can be changed later.
* Size check: a few hundred contacts compress to tens of KB per snapshot —
  10 points per org is negligible for Neon.

## 3. What backup/restore covers

* **Snapshot contents (org-scoped CRM data):** contacts with mekurav/shliach
  details, checklists, custom-field definitions+values, significant dates and
  reminders, areas, buildings, floors, apartments, shliach coverage links,
  visits, donations, interactions, picklist definitions+values, field
  settings.
* **NOT included: user accounts / logins.** Restoring data must never change
  passwords, delete users, or lock anyone out. After a restore, links from
  contacts to users are kept where the user still exists.
* **Restore semantics — replace, not merge:** restoring deletes the org's
  current CRM rows and reinserts the snapshot's rows, all inside **one
  database transaction**. Any failure rolls the whole thing back, leaving the
  data exactly as it was. Success shows a toast and reloads.
* **Safety net:** immediately before a restore runs, an automatic restore
  point of the *current* state is created (note: "אוטומטי — לפני שחזור"), so
  a restore can itself be undone.
* **Confirmation:** the restore button opens a localized confirmation modal
  (fixes15 §2.2 pattern — states what will be replaced, asks "בטוח ?").

## 4. Localization & logging

* All new Hebrew copy (card title, buttons, modal, toasts, notes) is seeded
  through the localization table, per the house rule.
* Backup creation and restore execution are written to the access log.

## 5. Out of scope (recorded decisions)

* Whole-database dumps / an in-app whole-DB restore — Neon's built-in
  point-in-time restore is the disaster-recovery layer; org-level restore
  covers the actual day-to-day need.
* Scheduled/automatic periodic backups (only the automatic pre-restore
  snapshot from §3).
* Import-batch tracking / per-import undo — superseded by "create a backup
  before importing, restore if it went wrong".
