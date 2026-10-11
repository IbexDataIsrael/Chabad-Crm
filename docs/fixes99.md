# fixes99 — deleting an image removes it from Cloudinary

Requested 2026-10-11: "when user deletes images they should be removed from
cloudinary".

## Before
Only deleting a whole organization (superadmin, fixes91) removed images from
Cloudinary. Removing/replacing the logo, dropping a gallery photo or
editing/deleting an announcement only changed the database row — the image
stayed in Cloudinary forever.

## Now
- [x] `PUT /api/organizations/me` (logo replace/clear, gallery photo removed,
      public-page footer edited) and announcement edit/delete
      (`/api/shliach-messages/announcements/{id}`) snapshot the org's image
      URLs before the change; after it's saved, every image no longer used is
      deleted from Cloudinary in a background task (never fails the request).
- [x] "No longer used" = not in the org's logo, gallery, any announcement or
      the public-page footer(s), and not used by any other organization
      (clones share URLs). Footer images now also count for the org-delete
      cleanup.
- [x] Same safety switch as fixes91: only when
      `CLOUDINARY_DELETE_ON_ORG_DELETE=true` (Render only) — the Cloudinary
      account is shared with local/dev, whose data points at prod images.
- [x] Only our own cloud's `image/upload` URLs are touched.
- Tests: `backend/tests/test_fixes99.py` (9 tests).

## Not done / caveats
- The image picker's library (all images ever uploaded to the org's
      announcements folder) still has no "delete" button; an image that was
      uploaded but never used in an announcement stays in Cloudinary.
- Images uploaded and then abandoned (picked, never saved) aren't cleaned.
- Restoring an org backup taken before an image was removed brings back
      its URL, but the image itself is gone from Cloudinary.
- Logo files saved on the server's disk (fallback when Cloudinary is down)
      are not deleted.
