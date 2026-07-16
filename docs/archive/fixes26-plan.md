# fixes26 Implementation Plan — Report Headers, Inline Editing, Shliach Login Recovery

Source spec: `docs/plan26.md`. Four areas: PDF report page headers, Google-style
inline editing (contacts + visits) with a visit read-only mode, shliach email
display, and user-administration repairs (delete failure + login recreation).

## Interpretation decisions (spec ambiguities, resolved)

1. **Reports are client-side jsPDF** (fixes24), not a backend template engine.
   The spec's Weasyprint/`@page` CSS section maps to the one real generator:
   `frontend/app/dashboard/reports/create/page.tsx`. The header (org name +
   logo) is drawn on every PDF page after layout; there is no backend change.
   Org name/logo come from the session (`useAuth().user.organization`).
2. **"Mekurav page" banner is the shliach contact page.** Only shluchim have
   logins; the suspended-login banner + "צור משתמש מחדש" button belong on
   `/dashboard/contacts/[id]` when `contact_type === "shliach"`.
3. **Phone/email backend work is already done** (phone optional + validated
   only when non-empty; email optional + format-checked, `ContactBase` since
   the data import). The remaining gap is the *frontend* `required` flag on
   the contact form's phone input, and the fact that a single-field
   `shliach` patch **wipes** report numbers/areas (ShliachData defaults
   applied unconditionally) — that must be fixed before per-field autosave.
4. **PATCH endpoints**: `PUT /api/contacts/{id}` and the visit PUTs already do
   `exclude_unset` partial updates; PATCH is registered as an alias of the
   same handlers so the autosave calls read naturally.
5. **User deletion failure root cause**: `user_preferences.user_id` is a
   NOT-NULL FK with no `ondelete` and no cleanup in `delete_user` — any user
   who ever logged in (saved locale/columns prefs, fixes17) cannot be deleted
   (FK violation → 500). That matches `mkishon770@gmail.com` (a shliach who
   signed in). Fix: delete the pref rows inside `delete_user`. No soft-delete
   flag is introduced — `is_active` already exists and is honored by auth.
6. **Login status surfaced on the contact detail**: `ShliachOut.login_status`
   = `active` | `disabled` | `missing`, resolved like `core/shliach.py`
   (user_id link, else same-org email match).
7. **Inline editing scope**: `ContactView` becomes editable-in-place (per
   field, save on blur/Enter/change) when the page passes an `onPatch`
   callback; `ContactForm` remains for the create flows. For visits, a new
   `VisitDetails` component renders a visit read-only (`readOnly`) or with
   the same per-field autosave; `VisitForm` remains for creating new visits.
   Complex pickers (picklists, date, apartment, multi-selects) commit on
   change; text fields commit on blur / Enter (Escape reverts).

## §1 Report page headers (frontend only)

- `frontend/lib/pdfRtl.ts`: add `drawPdfHeaders(doc, {orgName, logoDataUrl,
  logoRatio})` — loops all pages, draws org name (bold, right, RTL) +
  logo (left, scaled to the band) + a hairline under the band.
- `reports/create/page.tsx`: fetch `organization.logo_url` → data URL
  (best-effort; failures skip the logo), start content below the header band,
  give autotable a `margin.top` equal to the band so page-flowed tables clear
  it, and call `drawPdfHeaders` after layout.

## §2 Inline editing + visit read-only + optional phone

Backend (`routers/contacts.py`, `routers/visits.py`):
- Register PATCH aliases for the contact update and both visit update routes.
- `update_contact`: apply `shliach` sub-payload with `exclude_unset` — only
  touch notes/report_number_ids/area_ids/password when the client sent them.

Frontend:
- New `components/ui/InlineEdit.tsx` — display node by default; click →
  editor; commits on blur/Enter (configurable), Escape reverts; disabled mode
  renders display only.
- `ContactView` + `contacts/[id]/page.tsx`: per-field autosave via
  `PATCH /api/contacts/{id}`; the Edit/Cancel toggle and in-page `ContactForm`
  are removed from the detail page.
- New `components/VisitDetails.tsx`: full read-only rendering (date, type,
  location, notes, Mivtzoim flags, torah thought, rebbe connection,
  interactions, custom fields) and, when not `readOnly`, per-field autosave
  (`PATCH /api/visits/{id}` or the per-contact route) — flags toggle-save,
  interactions add/delete save, custom fields save on change.
- `visits/page.tsx` rows get a "הצג" (view) action → `VisitDetails readOnly`;
  the edit action opens the inline-editing `VisitDetails`.
  `VisitHistoryEditor` (contact page) gets the same pair.
- `ContactForm`: phone no longer `required` (empty valid, non-empty must pass
  the existing validator) — matches the backend.

## §3 Shliach email display

- Already present in the shluchim table; in `ContactView`'s shliach field list
  the email row becomes unconditional (it is the login identity), so a hidden
  `contacts.email` field-setting can no longer blank it — mirroring
  `ContactForm`, which always shows email for a shliach.

## §4 User administration

Backend:
- `delete_user`: delete the user's `user_preferences` rows before the hard
  delete (the FK that made deletion 500).
- `POST /api/users/recreate` (admin): body `{email}`. Requires a same-org
  shliach contact with that email; reactivates the same-org user with that
  email (sets `is_active=True`, role guarded to `shliach` if it was one) or
  creates a fresh `role="shliach"` user; re-links `ContactShliach.user_id`;
  returns the user.
- `ShliachOut.login_status` computed in `_build_detail`.

Frontend (`contacts/[id]/page.tsx`):
- For a shliach contact with `login_status !== "active"`: red banner
  `הכניסה למערכת הושעתה` + button `צור משתמש מחדש` (admins only) hitting the
  recreate endpoint, then re-fetching the contact.

## Localization (seed.py) — new keys

`users.login_suspended`, `users.recreate_user`, `users.user_recreated`,
`action.view`, `inline.click_to_edit`, plus visit-view labels reused from the
existing `visits.*` rows.

## Tests

`backend/tests/test_fixes26.py`: user-with-preferences delete succeeds;
recreate endpoint (reactivate + create + 404-no-contact); `login_status`
in the contact detail for linked/disabled/missing; single-field `shliach`
PATCH keeps report numbers/areas; PATCH alias parity for contacts + visits;
phone-less contact create/update.
