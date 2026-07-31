"""fixes38c cleanup, round 2 -- deactivate 6 custom_field_definitions rows in
org 1 (production) that duplicate the native visit_history Mivtzoim fields:

  id=2  Kesher_Larabi -> native connection_to_rebbe
  id=4  tfilin        -> native tefillin
  id=5  nerot         -> native shabbat_candles
  id=6  alon          -> native torah_pamphlet
  id=7  dvar_torah    -> native torah_thought (picklist checklist.torah_thought)
  id=9  ot            -> native letter_in_torah

Deliberately NOT touching id=8 (mezuzah) or id=10 (chinoch/education) --
neither has a native visit-level equivalent, per the user's explicit
confirmation to keep those two.

User explicitly confirmed deactivating all 6 including Kesher_Larabi, aware
that its two "checked=True" values (visits #92, #95) have no corresponding
value in the native connection_to_rebbe text field and will only be
recoverable via direct DB access once this field is hidden from the UI.

Soft-delete only (is_active=False), matching the app's own deactivate
button -- fully reversible, no values touched or deleted. Fresh backup taken
immediately before this: backups/fixes38_full_backup_20260731_050255.json
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402

TARGET_IDS = [2, 4, 5, 6, 7, 9]
TARGET_ORG = 1
EXPECTED_KEYS = {
    2: "Kesher_Larabi",
    4: "tfilin",
    5: "nerot",
    6: "alon",
    7: "dvar_torah",
    9: "ot",
}

with engine.begin() as conn:
    before = conn.execute(
        text(
            "SELECT id, organization_id, field_key, entity_type, field_type, "
            "hebrew_label, is_active FROM custom_field_definitions "
            "WHERE id = ANY(:ids) ORDER BY id"
        ),
        {"ids": TARGET_IDS},
    ).fetchall()
    print(f"before update ({len(before)} rows):")
    for r in before:
        d = dict(r._mapping)
        print(f"  {d}")
        assert d["organization_id"] == TARGET_ORG, f"unexpected org on row {d['id']}"
        assert d["entity_type"] == "visit", f"unexpected entity_type on row {d['id']}"
        assert d["field_type"] == "boolean", f"unexpected field_type on row {d['id']}"
        assert d["field_key"] == EXPECTED_KEYS[d["id"]], f"unexpected field_key on row {d['id']}"
        assert d["is_active"] is True, f"row {d['id']} was not active before this run"

    result = conn.execute(
        text(
            "UPDATE custom_field_definitions SET is_active = false "
            "WHERE id = ANY(:ids) AND organization_id = :org"
        ),
        {"ids": TARGET_IDS, "org": TARGET_ORG},
    )
    print(f"\nrows updated: {result.rowcount}")
    assert result.rowcount == len(TARGET_IDS), "row count mismatch -- aborting transaction"

    after = conn.execute(
        text("SELECT id, is_active FROM custom_field_definitions WHERE id = ANY(:ids) ORDER BY id"),
        {"ids": TARGET_IDS},
    ).fetchall()
    print("\nafter update:")
    for r in after:
        print(f"  {dict(r._mapping)}")

    # Confirm the values themselves are untouched (still present, just hidden via UI).
    values = conn.execute(
        text("SELECT COUNT(*) FROM custom_field_values WHERE definition_id = ANY(:ids)"),
        {"ids": TARGET_IDS},
    ).scalar()
    print(f"\ncustom_field_values rows still present under these definitions: {values}")

print("\nDone. Transaction committed.")
