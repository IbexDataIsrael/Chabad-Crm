# fixes106 — GET /api/apartments: SQL pagination + gzip

## Problem
A 100-user load test: `GET /api/apartments` took ~26s and timed out at 30s; the backend used 2 GB RAM and swapped.

Root cause (investigated before any change):
- The handler `list_apartments` (`routers/apartments.py`) had **no pagination**. It called `.all()` on the whole org: **26,241 rows**, **10.8 MB** of JSON (not gzipped), ~2s of mostly-Python CPU and ~136 MB of Python allocations per call.
- Not N+1 (9 queries in total), not a missing index.
- The server is a single uvicorn process, and the sync handler runs in a 40-thread pool where only one thread can run Python at a time. So 100 calls queue behind each other (100 × ~2s ≈ 26s), and up to 40 in-flight × ~150–250 MB each = swap.
- In the real UI, admins only call it with `?building_id=` (largest building: 299 apartments). It is called unfiltered only by activists, and their results are limited to the apartments they cover. The paginated `/api/apartments/list` grid was not affected.

## Changes
- [x] **1. SQL pagination**: `limit` (default **500**, 1–1000) + `offset` (≥0) query params, applied as `ORDER BY apartment_name, id OFFSET … LIMIT …` before loading. The response shape is unchanged (a plain list), so all 4 frontend callers work as before. The 500 default is above the largest building, so `?building_id=` callers still get the whole building. `id` was added as a tiebreaker so pages are stable.
- [x] **2. GZip**: `GZipMiddleware(minimum_size=1000)` in `main.py`, for all endpoints. There are no streaming/SSE responses in the backend that it could break.
- [x] Tests: `tests/test_fixes106.py` (5): limit caps an unfiltered call; offset pages don't overlap and stay ordered; a building filter returns the whole building; limit/offset bounds → 422; large responses come back gzip-encoded.

## Evidence (local Docker, real ~26k-apartment org 1 data)
| | before | after |
|---|---|---|
| unfiltered admin call: rows | 26,241 | 500 |
| response size | 10,777,812 B | 204,230 B plain / **19,392 B gzip** |
| single-call time | 1.8–3.9s | 0.07–0.09s (warm) |
| `?building_id=50` | 299 rows | 299 rows (unchanged) |
| 100 parallel unfiltered calls | (load test: ~26s, timeouts, swap) | 100/100 HTTP 200, avg 2.8s, max 4.1s; backend container 212 MiB after |

The "before" 100-parallel numbers come from the user's load test, not a local rerun. The local backend runs `--reload` single-process on a dev machine, so it isn't a like-for-like comparison with the prod VPS.

- Full backend suite: 722 passed, 1 skipped (`test_models.py` excluded — it needs the separate local Postgres and doesn't touch this code).

## Not done / open
- **Activist picker over 500 apartments**: `ApartmentPicker.tsx:56` calls unfiltered for an activist and now gets at most 500. If an activist can cover more than 500, that picker should move to `/api/apartments/list` + search. Not changed in this round.
- **Multiple uvicorn workers** (`--workers N`): proposed as optional, not done (separate decision; memory per worker).
- **Prod load test rerun**: not done (not deployed).

## Commit
- b3b1f86 (not pushed)
