# Data Import Plan — data1.xlsx → PostgreSQL (real-schema revision)

Source: `docs/data1.xlsx`, sheet «מעקב אחרי אנשים שביקרתי» — 106 importable rows
(rows 2–1052, counting only rows with a name in column M; every data row has a
name, so nothing is orphaned). Draft spec: `docs/data_import.md`. **No data is
written until this plan is approved.**

## 1. Corrections vs the draft spec

The draft was written before inspecting the real schema and the real file. What
actually differs:

| Draft said | Reality |
| :--- | :--- |
| `contact_mekurav.name` | No such column. A person is a **`contacts` row** (name, phone, `contact_type='mekurav'`, `organization_id`) + 1:1 `contact_mekurav` row. |
| `connection_to_rebbe` | Real column is `contact_mekurav.rebbe_connection`. |
| `contact_mitzvot` / `has_[mitzvah]` | Real table is **`community_checklists`** (1:1 by `contact_id`): `tefillin`/`tefillin_notes`, `tzedakah`/`charity_note`, `shabbat_candles`/`shabbat_candles_notes`, `torah_pamphlet`/`torah_pamphlet_notes`, `torah_letter`/`letter_torah_notes`, `torah_thought`. |
| `torah_thought_status` = "נמסר" | `community_checklists.torah_thought` stores the **technical picklist value** — the option labeled «נמסר» is **`"given"`** (values stay English, labels drive presentation). |
| Column I = Admin Area | **Column letters shifted.** Real headers: I = **תפילין** (tefillin — not in the draft at all), L = **admin area**, M = name. F = עלון, K = ביקור ראשון (also absent from the draft). |
| `admin_areas(id, name)` | Real table also requires **`organization_id`** (+ guid). Lookup/create must be org-scoped. |
| — | **`contacts.phone` is NOT NULL and unique per org (DB constraint)** — the sheet has no phone column, so placeholder phones must be synthesized. |

## 2. Real column → table mapping (per named row)

| Excel | Header | Target | Rule |
| :--- | :--- | :--- | :--- |
| M | first name | `contacts.name` | Trimmed. 106 rows; «ווינר» appears twice (rows 37–38) → imported as **two separate contacts**. |
| — | — | `contacts.phone` | **Synthesized placeholder** (no phone in sheet; column is NOT NULL + unique): sequential `000-000-NNNN`, collision-checked against the org. |
| — | — | `contacts.contact_type` | `'mekurav'`. |
| L | admin area | `admin_areas` lookup/create (org-scoped, by trimmed name) → `contact_mekurav.admin_area_id` | 22 distinct values (a mix of addresses & names — imported verbatim). 1 row (105) has none → NULL. |
| J | tzedaka_potential | `contact_mekurav.tzedaka_potential` | Text column (fixes9); values are '1'/'2' (61 rows). Stored as text. |
| C | REBBE | `contact_mekurav.rebbe_connection` | Direct text (1 row). |
| B | recommendation | `contact_mekurav.recommendations` | Direct text (6 rows). |
| A | Background | `contact_mekurav.background` | Direct text (18 rows). |
| K | ביקור ראשון | ??? | **Open question** — holds *parashah names* («שלח», «קורח»/«קרח»), but `contact_mekurav.first_visit` is a DateTime. See Q3. |
| D | Letter in a Torah | `community_checklists.torah_letter` + `letter_torah_notes` | Non-empty → `TRUE`; the cell text goes to notes **unless it is the bare marker `1`**. |
| I | תפילין | `community_checklists.tefillin` + `tefillin_notes` | Same rule (8 rows, all `1` → TRUE, no note). |
| H | Tzedakah | `community_checklists.tzedakah` + `charity_note` | Same rule (6 rows). |
| G | Shabbat candles | `community_checklists.shabbat_candles` + `shabbat_candles_notes` | Same rule (1 row). |
| F | עלון | `community_checklists.torah_pamphlet` | **Open question** — draft says force `FALSE`, but 2 rows have `1`. See Q4. |
| E | Torah thought | `community_checklists.torah_thought` | Non-empty (16 rows) → `"given"` (label «נמסר»). Cell texts that aren't bare markers (`שיעור`, `לימוד`, `הרשי,חיים,שבתי`) have **no notes column** on torah_thought — they will be appended to `background` as `דבר תורה: <text>` so nothing is lost. |

Every imported contact also gets an (empty-by-default) `community_checklists`
row — matching what the app does on contact creation.

## 3. Import mechanics

* **Script:** `backend/scripts/import_data1.py` (openpyxl + the app's SQLAlchemy
  models — no raw SQL, so guid/defaults/relationships behave exactly like the app).
* **Parameters:** `--org-id <n>` (required), `--xlsx <path>`, `--commit`
  (default is **dry-run**: prints per-row actions + summary, writes nothing).
* **Transaction:** one transaction for the whole file — all 106 contacts land
  or none do.
* **Re-run safety:** the script aborts if the org already has any contact with
  a `000-000-…` placeholder phone (i.e. the import already ran), unless
  `--force-rerun` is passed.
* **Environment:** run inside the backend container against the target
  `DATABASE_URL`. Recommended sequence: dry-run locally → `--commit` locally →
  eyeball in the UI → run against production (Neon) with the production org id.

## 4. Approved decisions (user, 2026-07-08)

1. **Target:** local Docker Postgres first (dry-run → commit → UI verification),
   then production (Neon) with the live org id.
2. **Phones:** **`contacts.phone` becomes nullable** (schema change, no
   placeholders). New Alembic revision; the `(organization_id, phone)` unique
   constraint stays — Postgres/SQLite treat NULLs as non-conflicting. API +
   form validation change to "optional, but validated & unique when provided".
   Imported contacts get `phone = NULL`.
3. **Column K (ביקור ראשון):** each of the 31 marked rows creates a row in
   **`visit_history`** linked to the contact. `visit_date` is NOT NULL, so the
   parashah maps to its 2025 Shabbat date — שלח → 2025-06-21, קורח/קרח →
   2025-06-28 — with `notes = "ביקור ראשון — פרשת <name>"` preserving the
   original text (visit_type left NULL).
4. **Column F (עלון):** honored — the 2 marked rows get `torah_pamphlet=TRUE`.

*Execution: phone-nullable migration + API/UI updates land first (with tests),
then the import script runs dry-run → commit locally; the production run uses
the same script against the Neon `DATABASE_URL`.*
