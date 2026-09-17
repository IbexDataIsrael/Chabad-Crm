# Import Plan: docs/data2.xlsx

Same implementation logic as `docs/apartment_data_import_plan.md`, with one modification:

* **Column C Override:** Map Column C entries to `building_type_id = 'divided_town_house'` instead of standard building type rules.

---

 **Existing Records:** If a building from Column C already exists in the database, dont add it but make a note of it

---

## Result (2026-09-17)

Full reasoning in `docs/data_import2_plan.md`. Ran `backend/scripts/import_data2.py` (dry-run, then
`--commit`, identical stats both times) against org 1 on local Docker Postgres only — no prod/Neon
writes.

All 394 distinct addresses in `docs/data2.xlsx` (843 rows, sheet «תיקונים») already existed as
buildings, so **0 new buildings were created** — every row's building was matched by exact
`building_address` string (no fuzzy/normalized-key matches, no collision risk). The column-C override
(`building_type_id = "divided_town_house"`) was applied to the matched building in place:

| previous `building_type_id` | count | action |
|---|---:|---|
| `town_house` | 326 | reclassified → `divided_town_house` |
| `building` (never explicitly set) | 59 | reclassified → `divided_town_house` |
| `divided_town_house` | 9 | already correct, unchanged |
| any type with floors > 0 | 0 | none found — defensive guard never triggered |

843 apartments created (no in-file duplicate `(building, floor, apt)` rows, so 0 merges). Each of the
394 matched buildings already had exactly 1 pre-existing apartment — per the plan, that apartment was
left untouched and this run's apartment(s) were added alongside it (e.g. `Haring St 2125` went from 1
apartment to 3: the original pre-existing one plus new `"1"` and `"2"`).

`apartment.Jewish_status` tally: gentile 351 / jewish_interested 88 / jewish 56 / jewish_gentile 23 /
jewish_shtumtz 38 / jewish_interested_gentile 7. `apartment.language` tally: english 37 / russian 33 /
hebrew 8 / yiddish 4. One `contact_unparsed` warning (a single row's phone/email text didn't validate —
preserved verbatim in that apartment's notes, nothing dropped). Org 1 totals: buildings unchanged at
8,298; apartments 25,807 → 26,650.

---

## Result: production (Neon) run (2026-09-17)

After the local run above was verified, the user asked to push the same fix to production. Took a
pre-write `pg_dump` backup of the whole Neon DB first (`backend/backups/neon_backup_pre_data_import2_
20260917_051441.sql`, via a matched Postgres 18 client, same reasoning as the original apartment
import's Neon backup — Neon runs PG 18.4 and the local psql/pg_dump client is only 15), then dry-run,
then `--commit`, both verified directly against live Neon queries before/after (org 1 = "חבד שיפסד-ביי"
on Neon).

The dry-run against Neon produced **identical stats to the local run** — same 394 matched addresses,
same 385/9/0 reclassify split, same 843 apartments, same single `contact_unparsed` warning — confirming
Neon's pre-existing building state for these addresses mirrored local exactly, so the commit carried no
surprises.

| Entity | Before | Change | After |
|---|---:|---:|---:|
| Buildings (org 1) | 8,291 | 0 created; 385 reclassified `town_house`/`building` → `divided_town_house`; 9 already correct | 8,291 |
| Apartments (org 1) | 24,725 | +843 | 25,568 |

Spot-checked directly against Neon post-commit: `Haring St 2125` → `building_type_id='divided_town_house'`,
`is_town_house=True`, apartments `["1", "2", "Haring St 2125"]` (the original pre-existing apartment kept
alongside the two new ones, per the plan's "apartment dedup is in-file only" decision). This is now live
on the production site actually served by Render — not just local Docker Postgres.

---

## Follow-up: delete the redundant original apartment (2026-09-17)

The user flagged that leaving the old pre-existing apartment in place (e.g. `Haring St 2125` /
`Bedford Ave 4195`) alongside the new corrected units was wrong — it should be deleted now that the
real per-unit apartments exist. Scope: only the **385 buildings reclassified by this run**, not the 9
that were already `divided_town_house` beforehand (those already had their own correct multi-apartment
breakdown from earlier work, unrelated to this file).

For each of the 385, the "old" apartment was identified as the single `is_display=true` row whose
`apartment_name` equalled the building's display name (or that name + `-th`, for the 59 buildings that
predated the fixes63 `-th`-suffix cleanup) — 385/394 matched this cleanly; the other 9 (pre-existing
`divided_town_house`) didn't match and were correctly left alone.

Before deleting, checked every candidate for a linked contact (`ContactMekurav.apartment_id`) — **0 of
385** had one, so no contact record was at risk of being orphaned. Deletion reused the same logic as the
app's own `DELETE /api/apartments/{id}` endpoint (full version lineage + `PicklistLink` +
`CustomFieldValue` cleanup, not a raw `DELETE`).

**Known, accepted data loss:** ~109 of the 385 old apartments carried real free-text `apartment_notes`
from the original 2026-08 canvassing (e.g. "the building was locked, couldn't get in," "gentiles live
here"). The user was told this explicitly and chose to delete anyway rather than merge the notes into
the new apartments first — that text is now permanently gone, not migrated.

Ran on local first (dry-run then delete, 385/385 deleted, matched expectations), then identically
against Neon production (no fresh backup taken for this step — the `pg_dump` from the addition run
above already covers a full rollback point from before both today's writes). Verified directly on Neon
post-delete: `Bedford Ave 4195` (building id 9680) now shows only apartments `["1", "2"]`.

| Entity | Before | Change | After |
|---|---:|---:|---:|
| Apartments (org 1, local) | 26,650 | −385 | 26,265 |
| Apartments (org 1, Neon) | 25,568 | −385 | 25,183 |