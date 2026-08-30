"""FastAPI application entrypoint.

Phase 1: database models are wired in and tables are created on startup. Auth
and the CRM routers are added in subsequent phases (see docs/plan.md).
"""
import logging
import os
import sys
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect

from app import models  # noqa: F401 — ensures models register on Base.metadata
from app.config import settings
from app.database import SessionLocal, engine

# Ensure our `app.*` loggers actually reach stdout at INFO. Uvicorn configures
# only its own loggers, so without this our diagnostic logs (seed outcome,
# email send result, admin actions) were silently dropped in production.
_app_logger = logging.getLogger("app")
if not _app_logger.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    _app_logger.addHandler(_handler)
_app_logger.setLevel(logging.INFO)
_app_logger.propagate = False


def _run_migrations() -> None:
    """Bring the database up to the latest Alembic revision on startup.

    Replaces the old Base.metadata.create_all: a fresh DB (e.g. a new Neon
    instance) is built entirely from the migration history, and an existing DB
    is a no-op. env.py reads the connection URL from app settings.
    """
    backend_dir = os.path.dirname(os.path.dirname(__file__))  # /app
    cfg = AlembicConfig(os.path.join(backend_dir, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
    command.upgrade(cfg, "head")
from app.routers import (
    admin,
    admin_areas,
    ai_query,
    apartments,
    areas,
    auth,
    backups,
    buildings,
    contacts,
    custom_fields,
    donations,
    field_settings,
    localization,
    metadata,
    organizations,
    picklists,
    preferences,
    report_numbers,
    search,
    shliach_messages,
    uploads,
    users,
    visits,
)
from app.scheduler import start_scheduler, stop_scheduler
from app.seed import seed_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Apply schema migrations (Alembic) before seeding.
    _run_migrations()
    # Seed admin, localization labels, and sample data (all idempotent).
    db = SessionLocal()
    try:
        seed_all(db)
    finally:
        db.close()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Bilingual Mini CRM API",
    description="Backend for the bilingual (Hebrew/English) Mini CRM MVP.",
    version="0.2.0",
    lifespan=lifespan,
)

# Allowed origins: explicit list from CORS_ORIGINS (localhost + any custom
# domains) PLUS a regex scoped to this project's own Vercel deployments, so
# preview URLs keep working without a CORS update on every deploy. The regex
# used to accept *any* "*.vercel.app" origin — since allow_credentials=True
# forbids a "*" wildcard, that effectively let every Vercel-hosted site (a
# free, self-service domain anyone can register) make credentialed requests
# to this API; narrowed to just this project (see config.py).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.cors_vercel_preview_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(metadata.router)
app.include_router(localization.router)
app.include_router(picklists.router)
app.include_router(users.router)
app.include_router(organizations.router)
app.include_router(custom_fields.router)
app.include_router(field_settings.router)
app.include_router(admin_areas.router)
app.include_router(report_numbers.router)
app.include_router(shliach_messages.router)
app.include_router(areas.router)
app.include_router(buildings.router)
app.include_router(apartments.router)
app.include_router(visits.router)
app.include_router(visits.all_router)
app.include_router(donations.router)
app.include_router(uploads.router)
app.include_router(admin.router)
app.include_router(backups.router)
app.include_router(preferences.router)
app.include_router(search.router)
app.include_router(ai_query.router)

# fixes25 §6: locally stored uploads (logo fallback when Cloudinary is
# unavailable) are served straight from the data volume.
os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    """Liveness probe used by smoke checks."""
    return {"status": "ok"}


if settings.enable_diagnostics:
    # Code review hardening: these routes are unauthenticated by design (the
    # superadmin one exists to confirm a seed ran without reading Render
    # logs, before you could even log in) — off by default in every
    # environment. Only registered at all when ENABLE_DIAGNOSTICS=true.

    @app.get("/api/_diagnostics/superadmin", tags=["health"])
    def superadmin_status() -> dict:
        """Whether a platform superadmin exists + its login-relevant flags
        (returns no password/email)."""
        db = SessionLocal()
        try:
            user = (
                db.query(models.User)
                .filter(models.User.role == "superadmin")
                .first()
            )
            if user is None:
                return {"superadmin_exists": False}
            return {
                "superadmin_exists": True,
                "username": user.username,
                "is_active": user.is_active,
                "email_verified": user.email_verified,
                "org_active": user.organization.is_active if user.organization else None,
            }
        finally:
            db.close()

    @app.get("/api/_diagnostics/tables", tags=["health"])
    def list_tables() -> dict[str, list[str]]:
        """List the tables created in the database — lets you visually
        confirm the schema exists."""
        inspector = inspect(engine)
        return {"tables": sorted(inspector.get_table_names())}
