# fixes110 — Web image search for the public-page gallery

On the settings tab "Public page and signup" the photo gallery (org JSON field
`Organization.public_gallery`, max 24) could only be fed by file uploads.
Admins can now search the web for images related to the org name (Google
Programmable Search / Custom Search API, `searchType=image`), pick from ~7
candidates, and import them — the backend downloads each chosen image and
pushes it through the existing Cloudinary upload pipeline (local-disk fallback
included), so the gallery stores our own URLs, never hotlinks.

## Backend

- `config.py`: `google_search_api_key` / `google_search_cx` (empty by default →
  the search endpoint answers 503, mirroring `anthropic_api_key`).
- `routers/organizations.py`: `POST /api/organizations/public-image-search`
  (admin-only). Free-text `query` (blank → 400 `error.image_search_query_required`),
  `count` clamped 1..10. Calls `customsearch/v1` with `safe=active`, timeout 15s.
  Non-200/unreachable upstream → 502 `error.image_search_upstream` with a capped
  copy of the upstream `error.message` only. Defensive parse of `items[]` →
  `{results: [{url, thumbnail, width, height, title}]}`; missing `items` → `[]`.
- `routers/uploads.py`: `POST /api/uploads/gallery-image-url` (admin-only).
  SSRF guard — http/https only, hostname resolved with `socket.getaddrinfo` and
  every address must be globally routable (`ip.is_global`; literal IP hostnames
  checked directly, unresolvable refused) → 400 `error.image_url_not_allowed`.
  Download `stream=True`, `timeout=(5, 20)`, redirects followed by requests;
  `Content-Length` pre-check + streamed cap at 5 MB+1 → 413 (existing message);
  response `Content-Type` must be in the PNG/JPEG/GIF/WEBP allowlist → 415
  `error.image_url_not_image`; network/upstream failure → 502
  `error.image_download_failed`. Bytes then go through `_store_org_image` — the
  Cloudinary/local pipeline extracted unchanged from `_upload_org_image`, which
  now just validates + reads the UploadFile and delegates (same behavior for the
  existing file endpoint).
- `schemas.py`: `PublicImageSearchRequest {query, count=7}`, `GalleryImageUrlRequest {url}`.
- `error_localization.py`: the six new `error.image_*` codes (en + he), so they
  show translated and are editable on the translations page.

## Frontend

- `lib/types.ts`: `PublicImageSearchResult`.
- `lib/api.ts`: `searchPublicImages(query, count=7)` (apiFetch → localized errors)
  and `importGalleryImage(url)` returning our stored URL.
- `components/GalleryImageSearchDialog.tsx` (new): query box pre-filled with the
  org name, thumbnail grid (~7), click to toggle a selection (checkmark ring),
  title on hover, "לא נמצאו תמונות" on empty. "הוסף לגלריה (N)" imports the
  selection sequentially with per-item progress; results are deduped against the
  existing gallery. 503 → a Hebrew message telling the admin to set
  `GOOGLE_SEARCH_API_KEY`/`GOOGLE_SEARCH_CX` on the backend.
- `components/PublicPageSettingsCard.tsx`: captures the org `name` on load,
  adds the "חיפוש תמונות ברשת" button next to "הוספת תמונות" (disabled at 24
  photos) and renders the dialog; `onImported` only appends to the gallery
  state — persistence stays the form's existing PUT /api/organizations/me save.

## Evidence
- `backend/tests/test_fixes110.py` — 21 tests: admin gates (403), 503
  not-configured, happy-path parse, upstream 502 (status + unreachable), blank
  query 400, count clamp (500→10, 0→1, default 7); import gate, non-http scheme,
  5 private-host shapes + unresolvable host (400), oversized body (413),
  Content-Length pre-check (413), wrong type (415), upstream 404 (502), and the
  local-fallback roundtrip (URL under `/uploads/gallery/{org_id}/`, bytes on
  disk, served back). Full suite: green.
- `tsc --noEmit`: clean.
- Live smoke: health OK; both routes in `/openapi.json`; with an admin JWT and
  no keys configured the search endpoint returned 503
  `error.image_search_not_configured`.

## Deploy notes
- New optional env vars `GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`
  (docker-compose passes them through; set them on Render to enable the
  feature). The custom search engine must have "Image search" turned on.
- Nothing else: no migration (no schema change), no new routers. The new
  localization rows seed with the usual `seed_all` backfill on restart.
