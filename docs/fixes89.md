# fixes89 — street2 menu for activists only; campaign manager shown as "restricted"

Requested 2026-10-01.

## 1. Hide /dashboard/street2 from campaign manager and restricted user

- [x] The street2 menu item ("דירות") is now shown to activists (`shliach`)
      only (`layout.tsx`). Live-verified locally: campaign manager → no
      street2; restricted (staff) user → no street2; activist → still there.
- Not changed: the admin / campaign-manager "view this activist" link
  (`/dashboard/street2?activist=<id>`, fixes74) still opens street2. Say if
  that should be blocked too.

## 2. Bug: a campaign manager appears on the Users page as "משתמש מוגבל"

**Cause:** the Users list folded every role other than admin/shliach into
`"staff"` when building its rows; the single-user page's label + role select
had no campaign-manager case either. The stored role was correct.

- [x] `users/page.tsx`: campaign_manager kept as its own row role (label,
      role filter and the row's role select now show "מנהל קמפיינים").
- [x] `users/[id]/page.tsx`: "מנהל קמפיינים" badge + role-select option.
- Live-verified: campaign manager #187 — list row select = campaign_manager,
  detail badge "מנהל קמפיינים", detail select = campaign_manager.

`tsc --noEmit` clean. Not committed or pushed.
