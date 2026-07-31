"""fixes38b/c — full-data backup of the production Neon database, taken
immediately before investigating/cleaning up a Mivtzoim field/picklist
entity-type data issue on production.

Dumps every row of every table in the `public` schema to one timestamped
JSON file (table -> list of rows). This is a DATA backup (for rolling back
row-level changes), not a schema/DDL backup — no migrations are planned here,
only investigating/correcting `entity_type` on stray picklist/custom-field
definitions.

Run with DATABASE_URL pointing at Neon (see backend/.env.production):

    python scripts/fixes38_full_backup.py --out backups/
"""
import argparse
import datetime
import decimal
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


def json_default(o):
    if isinstance(o, (datetime.datetime, datetime.date, datetime.time)):
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, uuid.UUID):
        return str(o)
    return str(o)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="backups", help="output directory")
    args = parser.parse_args()

    with engine.connect() as conn:
        table_rows = conn.execute(
            text(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                "ORDER BY tablename"
            )
        )
        tables = [r[0] for r in table_rows]
        print(f"found {len(tables)} tables in public schema")

        dump: dict[str, list[dict]] = {}
        total_rows = 0
        for table in tables:
            result = conn.execute(text(f'SELECT * FROM "{table}"'))
            rows = [dict(r._mapping) for r in result]
            dump[table] = rows
            total_rows += len(rows)
            print(f"  {table}: {len(rows)} rows")

    os.makedirs(args.out, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(args.out, f"fixes38_full_backup_{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(dump, f, ensure_ascii=False, indent=1, default=json_default)
    print(f"\nwrote {path}")
    print(f"total: {len(tables)} tables, {total_rows} rows")


if __name__ == "__main__":
    main()
