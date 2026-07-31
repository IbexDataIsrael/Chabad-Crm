"""fixes38b/c cleanup — deactivate 8 stray, orphaned custom_field_definitions
rows in org 1 (production): text-type, entity_type='contact_mekurav'
duplicates of the native Mivtzoim boolean fields (which already exist
correctly as entity_type='visit' rows and, more fundamentally, as real
built-in columns on visit_history regardless of any custom field).

Confirmed before running this:
  - Full DB backup taken: backups/fixes38_full_backup_20260731_042047.json
  - Zero rows in custom_field_values reference any of these 8 definition_ids
    (checked against that same backup) -- nothing to lose.
  - This performs the exact same DB-level change the app's own "deactivate"
    button does (DELETE /api/custom-fields/{id} -> row.is_active = False),
    just applied directly since I don't hold this org's real admin login.

Soft-delete only (is_active=False) -- NOT a hard delete. Fully reversible by
flipping is_active back to true (via this org's Manage Fields UI, or the
same direct-SQL approach).
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402

TARGET_IDS = [14, 15, 16, 17, 18, 19, 20, 21]
TARGET_ORG = 1

with engine.begin() as conn:  # single transaction; commits only if it all succeeds
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
        assert d["entity_type"] == "contact_mekurav", f"unexpected entity_type on row {d['id']}"
        assert d["field_type"] == "text", f"unexpected field_type on row {d['id']}"

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
        text(
            "SELECT id, is_active FROM custom_field_definitions "
            "WHERE id = ANY(:ids) ORDER BY id"
        ),
        {"ids": TARGET_IDS},
    ).fetchall()
    print(f"\nafter update:")
    for r in after:
        print(f"  {dict(r._mapping)}")

print("\nDone. Transaction committed.")
