# importdata — alias

This path is referenced by a session goal, but the import spec itself is
maintained as **`docs/importdata3.md`** (third import round; rounds 1–2 are in
`docs/archive/`). Treat that file as the authoritative content of this one.

**Spec summary:** process `docs/data3.xlsx` sequentially, upserting Report
Numbers (col A) → Buildings (cols B+C) → Floors (col D), then inserting
Apartments (cols E–J) per row.

**Status: executed 2026-07-20** against the local DB (`crm_local_dev`), org 1
«שליחות בשיפסיידביי», via `backend/scripts/import_data3.py` — 1087 apartments,
9 buildings, 70 floors, 31 report numbers, 1 area, 2 picklist options; zero
warnings, DB- and API-verified. Full decisions and run evidence:
`docs/importdata3-plan.md`.
