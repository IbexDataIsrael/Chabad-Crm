# fixes88 — street2: tap to edit, autosave (no pencil, no Save/Cancel)

Requested 2026-10-01: in street2 every field must be editable by a click on
it (lose the pencil), and the Save/Cancel buttons go — use autosave.

- [x] Every apartment-card field opens with a tap on its row (`role=button`,
      keyboard Enter/Space too). Pencils removed. Locked fields keep the lock
      icon and never open.
- [x] Text fields (name, phone, email, notes, custom fields): the editor
      opens focused; it saves when focus leaves it, or on Enter (single-line);
      Esc drops the change. Validation errors stay inline with the field open.
- [x] Single-choice picklists (jewish status, campaign status, mezuzah,
      custom picklists): tapping a chip saves at once. Clearing is an explicit
      "נקה ערך" chip, so an accidental tap never wipes a value (keeps the
      fixes72 intent). Tapping outside / Esc closes unchanged.
- [x] Language (multi-choice): toggle chips, saves when you tap outside the row.
- [x] Nothing is saved when the value didn't change (every save creates a new
      apartment version and marks the door done).
- [x] A field tapped while another is still saving opens right after that
      save lands (on the new apartment version) — no lost taps, no edits
      against a stale version.
- [x] Phone / email values stay tel: / mailto: links: tapping the number
      itself calls; tapping elsewhere on the row edits.

Verified live (local, a real activist's card, 390px): 0 pencils, 0
Save/Cancel; unchanged + tap away → 0 PUTs; change + tap away → 1 PUT; Esc → 0;
Enter → 1; mezuzah chip tap → 1 immediately; language toggle → 0 until tapping
outside → 1. `tsc --noEmit` clean. Not committed or pushed.
