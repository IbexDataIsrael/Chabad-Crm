"""One-shot data migration: copy every row from the SQLite DB into PostgreSQL.

Reads and writes both go through the app's SQLAlchemy models, so typed columns
(DateTime, Boolean, JSON) are converted correctly on each end — SQLite stores
these as text/ints, and SQLAlchemy's result/bind processors normalize them.

After loading, integer autoincrement sequences are reset to MAX(id) so the next
production insert doesn't collide with a migrated row (the classic post-migration
duplicate-key bug). Tables with UUID/string PKs have no sequence and are skipped.

Usage (defaults target the local docker-compose.local-db.yml Postgres):
    pipenv run python migrate_data.py
    # or inside the backend container:
    POSTGRES_URL=postgresql://crm_admin:local_secure_password@host.docker.internal:5432/crm_local_dev \
        python migrate_data.py
"""
import os
import sys

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.exc import IntegrityError

from app import models  # noqa: F401 — registers tables on Base.metadata
from app.database import Base

SQLITE_URL = os.getenv("SQLITE_URL", "sqlite:///./data/crm.sqlite3")
POSTGRES_URL = os.getenv(
    "POSTGRES_URL",
    "postgresql://crm_admin:local_secure_password@localhost:5432/crm_local_dev",
)

src_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
dest_engine = create_engine(POSTGRES_URL)


def main() -> None:
    print(f"Migrating  {SQLITE_URL}  ->  {POSTGRES_URL}")

    # Ensure the schema exists on the fresh target.
    Base.metadata.create_all(bind=dest_engine)

    tables = Base.metadata.sorted_tables  # dependency order: parents first

    with src_engine.connect() as src, dest_engine.begin() as dest:
        # Clear the target child-first so foreign keys never block a delete.
        for table in reversed(tables):
            dest.execute(table.delete())

        # Copy parent-first. _mapping yields a dict of typed Python values.
        # SQLite never enforced foreign keys, so the source may hold orphaned
        # rows that Postgres rejects. Try a fast bulk insert; if it trips an
        # integrity error, fall back to row-by-row (each in its own savepoint)
        # so we drop only the bad rows and report exactly what was skipped.
        for table in tables:
            rows = [dict(r._mapping) for r in src.execute(select(table))]
            inserted, dropped = 0, []
            if rows:
                try:
                    with dest.begin_nested():
                        dest.execute(table.insert(), rows)
                    inserted = len(rows)
                except IntegrityError:
                    for row in rows:
                        try:
                            with dest.begin_nested():
                                dest.execute(table.insert(), [row])
                            inserted += 1
                        except IntegrityError:
                            dropped.append(row)
            note = f"  {table.name}: {inserted} rows"
            if dropped:
                ids = ", ".join(str(r.get("id")) for r in dropped)
                note += f"  (DROPPED {len(dropped)} orphaned: id={ids})"
            print(note)

        # Realign integer autoincrement sequences with the data we just loaded.
        for table in tables:
            for col in table.primary_key.columns:
                seq = dest.execute(
                    select(func.pg_get_serial_sequence(table.name, col.name))
                ).scalar()
                if not seq:
                    continue  # non-serial PK (e.g. UUID string) — nothing to reset
                max_id = dest.execute(
                    text(f"SELECT MAX({col.name}) FROM {table.name}")
                ).scalar()
                if max_id is None:
                    # Empty table: next id should be 1 (is_called = false).
                    dest.execute(text("SELECT setval(:s, 1, false)"), {"s": seq})
                else:
                    dest.execute(
                        text("SELECT setval(:s, :v, true)"), {"s": seq, "v": max_id}
                    )

    print("Migration complete.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Migration failed: {exc}", file=sys.stderr)
        raise
