CHANGE REQUEST: campaigns grid + per-campaign field visibility + activist view fixes

A. /dashboard/shliach-config bug
1. The lock list does not show all fields. Lock means: the activist sees the field as READ-ONLY. It is not related to hide/show.
2. Fix: every apartment field, including custom fields, must appear in the lock list.

B. /dashboard/campaigns
1. Replace the display with a regular data grid of campaigns (like the contacts grid).
2. Add a page for a single campaign.
3. Delete and edit happen inline on the campaign page - no separate edit view.
4. Clicking a campaign name in the grid opens its campaign page.
5. Add a table for hide/show of apartment fields, per campaign (schema up to you: campaign + field key + visible flag).
6. The hide/show flags are edited on the campaign page, next to edit/delete.
7. One campaign is active at a time; activists always see the active campaign.

C. Activist view
1. Remove the stray field "mark done" from the apartment display. It is not the done-marking mechanism - that stays as the status-field flow, saved to the API.
2. Add a boolean field ToKnock on the APARTMENT. One-time migration: set ToKnock = true where Jewish status is Jew or unmarked, false otherwise. New apartments get the same default when their status is set.
3. Do not show the ToKnock field to activists.
4. A building is complete when all its ToKnock = true apartments are done. Only then fire the celebration (confetti + card). Buildings with no ToKnock apartments never fire it.
5. Every apartment field, including custom fields, is a display candidate; the active campaign's hide/show flags filter what the activist sees. Hidden fields are not displayed.
6. Remove the "Extra fields" section that is currently on display.

============================================================
CLOSEOUT (2026-09-29)
============================================================
Built locally on `main`; nothing pushed. Plan approved in advance (research
via 3 Explore agents + 1 Plan agent before writing any code) given the
scope — new table/migration, real business logic, three rewritten pages.

- [x] A.1/A.2 (shliach-config lock list) — frontend/app/dashboard/
      shliach-config/page.tsx now fetches the org's apartment custom
      picklists (`/api/picklists`, entity_type=apartment, minus the 4 fixed
      ones) and non-select custom fields (`useCustomFieldDefs("apartment")`)
      and appends them to the Edit Lock checkbox list, same convention
      street.tsx's own vis() calls already use for these two categories.
- [x] B.1-B.4 (campaigns grid + detail page) — frontend/app/dashboard/
      campaigns/page.tsx rewritten as a real table grid (display/navigate/
      delete only); new campaigns/[id]/page.tsx is the single-campaign page
      (inline-edit name/active/stats text, delete) — no separate /edit
      route, modeled on tasks/[id]/page.tsx.
- [x] B.5/B.6 (per-campaign field hide/show) — new `campaign_field_visibility`
      table (migration d4a7c9e21b3f) + backend/app/apartment_fields.py (the
      merged fixed/custom-picklist/custom-field catalog, apartment-scoped) +
      GET/PUT /api/campaigns/{id}/field-visibility, autosaved on the
      campaign detail page (checkbox per field).
- [x] B.7 (one active campaign at a time) — backend/app/routers/
      campaigns.py's create/update now deactivate every other org campaign
      when one is set active. Live-verified via direct API calls: creating
      two "active" campaigns back to back left only the second active, and
      every other pre-existing org-1 campaign also flipped off.
- [x] C.1 — nothing to remove; grepped the whole frontend, no "mark done"
      control/field exists anywhere (street2 already used root_id, not a
      separate field, from the fixes70 round).
- [x] C.2/C.3 (ToKnock auto-recompute, hidden from activists) —
      backend/app/routers/apartments.py's new `_sync_to_knock` runs from
      apartment create, batch-create, the versioned single-edit path (PUT +
      door-outcome), and bulk-update — matching backfill_to_knock.py's rule
      exactly, and guarded to only fire when Jewish status itself changed
      (protects a manual to_knock override from being stomped by an
      unrelated field edit). Live-verified via direct API PUTs against a
      real apartment: status->Jewish sets to_knock true, a manual override
      to false survives an unrelated notes edit, and re-submitting the
      status recomputes it. `to_knock` is excluded from
      apartment_fields.list_apartment_field_keys (so it can't even be
      configured visible via a campaign) and hard-filtered out of street2's
      custom-field list regardless.
- [x] C.4/C.5/C.6 (completion rule + unified campaign-filtered fields) —
      street2/page.tsx: building completion now requires every to_knock
      apartment (not every apartment) to be done, computed at the building
      level before/after each save so a non-to-knock edit can never
      re-trigger it; a zero-to-knock building never satisfies the
      `required.length > 0` guard. The old always-shown fixed rows + the
      separate "Extra fields" section are replaced by one flat row list,
      every field (fixed and custom) gated by the active campaign's
      visibility map (frontend/lib/campaignFieldVisibility.ts) instead of
      the old global field-settings vis(); this also required gating the
      door-tile's Jewish-status quick-glance headline, found live when a
      hidden-field check unexpectedly matched — a real gap the sheet-only
      gate had missed. street.tsx is untouched throughout.
  Live-verified end to end against real org-1 data (Playwright, staff
  login, phone viewport, ~4min full-org load — same cost as every prior
  street2 round): a campaign hiding Jewish status correctly hides it from
  both the sheet and the door tile; `to_knock`/"לדפוק" never appears; the
  old "Extra fields" heading is gone; a building with only a to_knock=false
  apartment does NOT celebrate when edited; a building whose sole apartment
  is to_knock=true and previously undone DOES celebrate (confetti + quote)
  the moment it's completed, and does not refire on reload. `npx tsc
  --noEmit` clean throughout. All temp test accounts/campaigns cleaned up.
