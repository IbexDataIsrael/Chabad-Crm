dashboard/picklists
1. when deleting a picklist value, check if that value is attached to existing data? Only if not allow delete. If value is attached to data tell user where it is

2. Ux bug -jewish_interested_gentile   text overlapping in desktop mode 
3. when saving edit of picklist value there should be indication / toast after data is saved 

/dashboard/street2
1. when editing language on apartment (or any other picklist field) add a Cancel button . 
2. when hitting “save”, if nothing was chosen, notify user and offer the cancel option

---

## Status (2026-09-29) — done locally, NOT committed/pushed

### dashboard/picklists

- [x] **1. Block delete of an in-use value + say where.**
  - Backend: new `picklist_utils.value_usage_locations()` returns
    `[{entity, count, samples:[{id,label}]}]` over `PicklistLink` (contacts,
    contact_mekurav→contacts, apartments, visits, significant dates, and any
    unknown link table as unlabeled) plus the one direct FK
    `Task.custom_date_value_id`. `GET /api/picklists/{id}/usage` now returns
    `{count, locations}`. `DELETE /api/picklists/{id}?hard=true` → **409**
    with the same breakdown while in use. This reverses fixes48's
    "confirm, then purge" behavior.
  - Apartments are versioned: only the **active** version (`is_display`)
    counts. A value held only by retired versions can be deleted, and those
    history links are purged along with it.
  - Frontend: both delete buttons ("מחק" = deactivate, and "מחק לצמיתות")
    check usage first. If in use, they show a "לא ניתן למחוק את הערך" dialog
    listing each place (with counts, up to 5 linked sample records, and
    "ועוד N…"). Nothing is deleted.
  - **Decision:** the guard also applies to the soft "מחק" (deactivate).
    That's the button users see as "delete", and the spec says to allow
    delete only when the value is unused. The backend still allows a
    soft-deactivate via the API; only the UI blocks it.
  - Evidence: live drive at 1440px as a temp admin. Deleting
    `apartment.Jewish_status=jewish_interested_gentile` showed "דירות: 401"
    plus 5 linked addresses, and the value stayed active. An unused temp
    value deactivated, then hard-deleted after confirmation. Tests:
    `test_picklists.py::test_hard_delete_in_use_is_blocked_with_locations`,
    `test_fixes48.py::…test_value_hard_delete_blocked_while_in_use`, new
    `test_fixes72.py` (active version blocks, retired version doesn't).
- [x] **2. `jewish_interested_gentile` overlap.** The technical-value
  `<code>` had a fixed `w-28` and never wrapped, so long values ran under
  the Hebrew input. It now wraps, preferring a break after `_` (`<wbr>`).
  Evidence: at 1440px, the code box (x 1010–1122) no longer overlaps the
  input (ends at x 1002).
- [x] **3. Toast after save.** An option save shows "נשמר בהצלחה" (and an
  error toast on failure), and the Save button is disabled while saving.
  The same success/error toasts were added to the picklist-definition and
  custom-field row saves on this page, which were also silent. Evidence:
  toast seen in the live drive.

### /dashboard/street2

- [x] **1. Cancel button.** A Cancel button (ביטול) already existed in every
  street2 editor. It was a borderless pale-grey block next to the bold green
  Save, so it read as disabled. It's now an outlined white button with dark
  text (shared `street.module.css` `.cancelBtn`).
- [x] **2. Save with nothing chosen.** Before this fix, it silently sent a real `PUT` (a
  new apartment version, and the door counted as edited). Now it doesn't
  save. It shows a notice with **ביטול**, plus **נקה ערך** only when the
  field already had a value (to clear it deliberately). Picking a chip
  dismisses the notice. This applies to every picklist row (4 fixed + language
  + custom picklists). Evidence: live drive at 390px as a temp activist:
  empty save → notice, 0 PUTs → Cancel closes. Pick "עברית" → PUT
  `{"language":["hebrew"]}`. Deselect → save → notice with נקה ערך → PUT
  `{"language":[]}`.

New localization rows: `pl.in_use_title`, `pl.in_use_body`, `pl.usage_*`,
`pl.usage_and_more`, `street.nothing_chosen`, `street.nothing_chosen_clear`,
`street.clear_value`.

Full backend suite: 602 passed. `tsc --noEmit` clean.

### Found, not fixed (out of scope)

- **Deleting a shliach contact that has areas assigned → 500.**
  `contact_shliach_area.contact_shliach_id` FK has no `ON DELETE CASCADE`,
  while `contact_shliach` rows are removed by the DB-level cascade from
  `contacts` (`passive_deletes`), so the ORM `delete-orphan` never runs.
  `report_number_contact_shliach` does cascade. Fix = an Alembic migration
  adding `ondelete="CASCADE"` to that FK. Checked on local Postgres; prod
  not checked.
