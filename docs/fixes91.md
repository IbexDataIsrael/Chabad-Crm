# fixes91 — deleting an organization deletes its images from Cloudinary

Requested 2026-10-01.

## Findings

- An org's images on Cloudinary: its **logo** (`org_logos/…`, in
  `organizations.logo_url`), **public-page gallery** photos and
  **announcement** images (`orgs/<id>/gallery|announcements/…`; announcement
  images are `<img src>` inside `shliach_announcements.message_content`).
- **Every environment uses the same Cloudinary account** (cloud `m5c2…`), and
  local data is a copy of prod, so it holds the **same image URLs**. Folder
  `orgs/<id>/` means different orgs in different environments.
- **Clones reuse their source's logo:** prod org #11 shares org #1's logo file.

## Done

- [x] `app/core/cloudinary_assets.py`: on org delete, delete by **reference**,
      never by folder — only the org's own logo / gallery / announcement image
      URLs on our cloud, **skipping any image another org still uses**.
- [x] Runs only when `CLOUDINARY_DELETE_ON_ORG_DELETE=true` (new setting,
      **default off**), so a local delete can never remove a production image.
- [x] Planned before the rows are deleted, executed only after the DB delete
      committed; a Cloudinary failure is logged and never fails the delete.
- Tests: shared logo kept, own gallery + announcement images deleted;
  disabled → no Cloudinary call. 27 passed (superadmin + fixes10).
- Real Cloudinary self-test (throwaway image in `fixes91-selftest/…`):
  uploaded → parsed id matched → deleted → Cloudinary returns 404.

## To do on deploy

- [ ] Set **`CLOUDINARY_DELETE_ON_ORG_DELETE=true` on Render (production
      backend) only**. Without it, deletion keeps working but images stay.

Not committed or pushed.
