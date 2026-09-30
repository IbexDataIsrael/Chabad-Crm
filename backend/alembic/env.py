from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make the app importable and pull the live config + metadata so migrations
# always target the same DB and schema the app uses.
from app.config import settings
from app.database import Base
from app import models  # noqa: F401 — registers every table on Base.metadata

config = context.config

# Drive the connection from the app's DATABASE_URL rather than alembic.ini, so
# there's a single source of truth (local Postgres now, Neon in production).
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
config.set_main_option("sqlalchemy.url", db_url)

if config.config_file_name is not None:
    # fixes75: the app runs migrations in-process at startup — the default
    # disable_existing_loggers=True silenced every app.* and uvicorn logger
    # from then on (no request, email or error lines in the Render log).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL without a DBAPI connection)."""
    context.configure(
        url=db_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
