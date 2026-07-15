"""fixes25 §1 — pre-migration backup of contact-level data that the
visit-restructure migration moves and then destroys.

Dumps, per contact: interaction rows, the community checklist (Mivtzoim
booleans + notes + torah_thought), custom-field values, and
contact_mekurav.rebbe_connection — as JSON keyed by contact_id.

Run BEFORE deploying the fixes25 migration (locally and against Neon):

    docker compose exec backend python scripts/fixes25_backup.py
    # or, with DATABASE_URL pointing at Neon:
    python scripts/fixes25_backup.py --out backups/

Raw SQL on purpose: it works against the pre-migration schema even after the
ORM models have been rewritten.
"""
import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


def rows(conn, sql: str) -> list[dict]:
    result = conn.execute(text(sql))
    return [dict(r._mapping) for r in result]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="backups", help="output directory")
    args = parser.parse_args()

    data: dict[int, dict] = {}

    def entry(contact_id: int) -> dict:
        return data.setdefault(
            contact_id,
            {"interactions": [], "checklist": None, "custom_fields": [], "rebbe_connection": None},
        )

    with engine.connect() as conn:
        for r in rows(
            conn,
            "SELECT contact_id, category, note, created_by, created_at FROM interactions",
        ):
            e = entry(r["contact_id"])
            r["created_at"] = r["created_at"].isoformat() if r["created_at"] else None
            e["interactions"].append(
                {k: r[k] for k in ("category", "note", "created_by", "created_at")}
            )

        for r in rows(conn, "SELECT * FROM community_checklists"):
            r.pop("guid", None)
            contact_id = r.pop("contact_id")
            # Skip untouched checklists (all-false, no notes) to keep the dump lean.
            if any(v for k, v in r.items()):
                entry(contact_id)["checklist"] = r

        for r in rows(
            conn,
            """SELECT v.contact_id, d.field_key, v.checked, v.note
               FROM custom_field_values v
               JOIN custom_field_definitions d ON d.id = v.definition_id""",
        ):
            if r["checked"] or r["note"]:
                entry(r["contact_id"])["custom_fields"].append(
                    {k: r[k] for k in ("field_key", "checked", "note")}
                )

        for r in rows(
            conn,
            "SELECT contact_id, rebbe_connection FROM contact_mekurav"
            " WHERE rebbe_connection IS NOT NULL AND rebbe_connection <> ''",
        ):
            entry(r["contact_id"])["rebbe_connection"] = r["rebbe_connection"]

    os.makedirs(args.out, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(args.out, f"fixes25-pre-migration-{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, default=str)
    print(f"wrote {path}: {len(data)} contacts with contact-level data")


if __name__ == "__main__":
    main()
