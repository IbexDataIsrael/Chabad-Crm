"""Read-only investigation: find picklist/custom-field definitions whose
label suggests Mivtzoim content but whose entity_type isn't "visit"."""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402

MIVTZOIM_HINTS = [
    "תפילין", "tefillin", "צדקה", "tzedak", "נר", "candle", "מזוזה", "mezuzah",
    "עלון", "pamphlet", "torah", "תורה", "רבי", "rebbe", "mivtzo", "מבצע",
]


def hints(text_val):
    if not text_val:
        return False
    low = str(text_val).lower()
    return any(h.lower() in low for h in MIVTZOIM_HINTS)


with engine.connect() as conn:
    print("=== picklists (all rows, org + system) ===")
    rows = conn.execute(
        text(
            "SELECT id, organization_id, system_name, entity_type, is_system, "
            "hebrew_display_name, english_display_name FROM picklists ORDER BY id"
        )
    )
    for r in rows:
        d = dict(r._mapping)
        flagged = hints(d["system_name"]) or hints(d["hebrew_display_name"]) or hints(
            d["english_display_name"]
        )
        marker = "  <-- MIVTZOIM-ish name" if flagged else ""
        print(
            f"  id={d['id']:4d} org={d['organization_id']} sys_name={d['system_name']!r:35s} "
            f"entity_type={d['entity_type']!r:20s} is_system={d['is_system']} "
            f"he={d['hebrew_display_name']!r} en={d['english_display_name']!r}{marker}"
        )

    print()
    print("=== custom_field_definitions (all rows) ===")
    rows = conn.execute(
        text(
            "SELECT id, organization_id, field_key, entity_type, field_type, "
            "hebrew_label, english_label, is_active FROM custom_field_definitions ORDER BY id"
        )
    )
    for r in rows:
        d = dict(r._mapping)
        flagged = hints(d["field_key"]) or hints(d["hebrew_label"]) or hints(d["english_label"])
        marker = "  <-- MIVTZOIM-ish name" if flagged else ""
        print(
            f"  id={d['id']:4d} org={d['organization_id']} field_key={d['field_key']!r:30s} "
            f"entity_type={d['entity_type']!r:20s} type={d['field_type']!r} active={d['is_active']} "
            f"he={d['hebrew_label']!r} en={d['english_label']!r}{marker}"
        )

    print()
    print("=== field_settings (all rows) ===")
    rows = conn.execute(
        text(
            "SELECT id, organization_id, field_key, is_visible FROM field_settings ORDER BY id"
        )
    )
    for r in rows:
        d = dict(r._mapping)
        flagged = hints(d["field_key"])
        marker = "  <-- MIVTZOIM-ish key" if flagged else ""
        print(
            f"  id={d['id']:4d} org={d['organization_id']} field_key={d['field_key']!r:35s} "
            f"is_visible={d['is_visible']}{marker}"
        )
