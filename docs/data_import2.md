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