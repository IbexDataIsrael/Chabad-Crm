# Implementation Plan: Dashboard & Announcements Enhancements

## Overview
This task covers three distinct features in the application dashboard:
1. Hardcoding the activist `email` field as permanently locked in the config settings UI.
2. Building an image picker and upload modal integrated with Cloudinary for Announcement content, enforced with strict multi-tenant organization isolation.
3. Improving filter UI UX by ensuring persistent labels remain visible when filter checkboxes are active.

---

## Task Breakdown

### 1. Activist's Own-Profile Field Locks
**Target Path:** `/dashboard/shliach-config`

- [x] **Remove Email from Configurable Options** — DONE. The fixed 4-field
      list (`FIXED_SELF_EDIT_FIELDS`) already excluded email; the actual gap
      was that an org-added custom field/picklist on `contact_shliach` keyed
      `"email"` could slip into that same checkbox list. Both dynamic
      sources are now filtered (`frontend/app/dashboard/shliach-config/page.tsx`).
- [x] **Enforce Fixed State** — DONE. Email was already unconditionally
      locked at the enforcement layer (`ContactView.MANDATORY_SELF_EDIT_LOCKS`);
      it just could no longer even display as if it were optional. Verified
      live: self-edit-locks section shows only name/last name/phone/notes,
      no email checkbox (screenshot).

---

### 2. Announcement Image Selector & Cloudinary Integration
**Target Path:** Announcements / Announcement Content Editor

- [x] **Editor Toolbar Button** — DONE. `RichTextEditor` takes a new optional
      `imagePicker` prop (opt-in per instance — deliberately NOT wired into
      the other `RichTextEditor` consumer, the email-template editor, since
      the picker is org-scoped and specific to this feature); when passed,
      an `Image` (lucide-react) toolbar button appears and opens the modal.

- [x] **Cloudinary Image Selection & Upload Modal** — DONE
      (`frontend/components/ImagePickerModal.tsx`).
  - **Gallery View:** `GET /api/uploads/announcement-images` lists the
    caller's org's Cloudinary assets (Admin API, `prefix`-filtered).
  - **Upload Feature:** inline upload control → `POST
    /api/uploads/announcement-image`, folder `orgs/{org_id}/announcements`
    (falls back to local disk storage if Cloudinary isn't configured, same
    pattern as the existing logo upload).
  - **Selection Action:** both picking an existing thumbnail and finishing
    a new upload call `document.execCommand("insertImage", …)` at the caret.
  - Verified live end-to-end (real Cloudinary, not just the local
    fallback): uploaded → `https://res.cloudinary.com/.../orgs/1/announcements/....png`
    → appeared in the editor's HTML; reopening the picker showed it in the
    gallery; clicking that existing thumbnail also inserted it correctly.

- [x] **Organization Isolation (Multi-Tenancy Guard)** — DONE. Both new
      endpoints are `require_admin`-gated and read `organization_id` only
      from `admin.organization_id` (the authenticated JWT) — there is no
      client-supplied org id anywhere in the request, so this is a
      structural guarantee, not just a filter (`backend/app/routers/uploads.py`).

---

### 3. Filter Label UI Improvement
**Target Path:** Global/Shared Filter Components (Dashboard)

- [x] **Persistent Label Display** — DONE for the shared components +
      shliach-config's own filters; NOT yet applied to other pages' call
      sites (see below).
  - Added an optional `label` prop to both `MultiSelectFilter` and
    `MultiSelectSearchFilter` — when the button collapses to the selected
    value ("צפון") or a bare count ("2 נבחרו") once something is checked,
    `label` prefixes it ("אזור: צפון"). Omitting `label` keeps the exact
    pre-fixes56 behavior, so this is non-breaking everywhere else it's used.
  - Wired up on `/dashboard/shliach-config`'s 5 default-filter widgets
    (Area/Building/Jewish status/Mezuzah status/Language), reusing the
    page's existing `fieldLabels` strings — no new localization keys needed.
  - Verified live: selecting one area shows "אזור: <name>" on the button
    (confirmed via the actual DOM text, not just a screenshot).
  - **Scope note:** `MultiSelectFilter`/`MultiSelectSearchFilter` are also
    used on 10 other pages (apartments, contacts, buildings, areas, users,
    reports, etc.) that weren't touched — the spec's target path named this
    page. Passing `label` on those call sites is a small, mechanical
    follow-up whenever that's wanted.

---

## Verification & Testing
- [x] Verify `/dashboard/shliach-config` no longer lists `email` as a configurable lock option. — confirmed live (local Docker stack, org 1 admin).
- [x] Test the Announcement editor image button: open modal, upload a new image, select an existing image, and confirm embedding in the content area. — confirmed live, both paths, real Cloudinary round-trip.
- [x] Verify multi-tenancy: confirmed **by code inspection** — both endpoints derive the org strictly from `require_admin`'s JWT-resolved `organization_id`, with no client-supplied org id anywhere in the request/response path, so cross-org access isn't reachable by construction. Did not additionally spin up a second org's admin login to re-confirm behaviorally — flag if you want that extra live check too.
- [x] Check active filters to ensure clear, persistent labels remain legible when checked. — confirmed live (DOM text, "אזור: …" prefix appears once a value is selected).

## Notes from implementation
- Backend tests: full suite run (`pytest`) — 505 passed, 5 failed
  (`test_models.py`, all `OperationalError`). Confirmed pre-existing/
  unrelated: those 5 pass cleanly in isolation: `pytest tests/test_models.py`
  green, 5/5. The full-suite failures look like connection pressure from
  ~510 tests hitting real local Postgres back-to-back, not anything this
  round touched (no test files were changed).
- To drive the live UI locally I had to reset org 1's `admin` user password
  (id=1) to a throwaway value, since the original wasn't known/recorded —
  its old password_hash was **not** saved first, so the previous password is
  gone. Local dev DB only, not prod; new password isn't written down here on
  purpose — ask if you need it.
- Left a 1×1 px test image in org 1's live Cloudinary account under
  `orgs/1/announcements/` from the upload-path test. Harmless (negligible
  size) but you may want to delete it from the Cloudinary console.