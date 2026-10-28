"""FastAPI application entrypoint.

Phase 1: database models are wired in and tables are created on startup. Auth
and the CRM routers are added in subsequent phases (see docs/plan.md).
"""
import json
import logging
import os
import sys
from contextlib import asynccontextmanager

from alembic import command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import exc as sa_exc, inspect

from app import models  # noqa: F401 — ensures models register on Base.metadata
from app.config import settings
from app.core.concurrency import ApiConcurrencyLimit
from app.database import API_QUEUE_TIMEOUT_SECONDS, REQUEST_CONNECTIONS, SessionLocal, engine

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

# fixes101 §2b: every `logger.exception(...)` under "app" is also written to
# error_logs and emailed (errors that were caught, not just unhandled 500s).
from app.core.error_log import install_background_error_handler  # noqa: E402

install_background_error_handler()


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
    activity,
    activist_messages,
    admin,
    admin_areas,
    ai_query,
    apartments,
    areas,
    assistant,
    assistant_apartments,
    auth,
    backups,
    buildings,
    campaigns,
    contacts,
    custom_fields,
    dashboard,
    donations,
    instinct,
    field_settings,
    localization,
    logs,
    metadata,
    organizations,
    picklists,
    preferences,
    public,
    report_numbers,
    search,
    shliach_messages,
    street_activity,
    tasks,
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

# Middleware (CORS, the fixes107 request gate, gzip) is added at the end of
# the middleware section below, after the @app.middleware functions — the
# last one added is the outermost.

app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(metadata.router)
app.include_router(localization.router)
app.include_router(picklists.router)
app.include_router(users.router)
app.include_router(organizations.router)
app.include_router(custom_fields.router)
app.include_router(dashboard.router)
app.include_router(field_settings.router)
app.include_router(admin_areas.router)
app.include_router(report_numbers.router)
app.include_router(shliach_messages.router)
app.include_router(activist_messages.router)
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
app.include_router(assistant.router)
app.include_router(assistant_apartments.router)
app.include_router(campaigns.router)
app.include_router(tasks.router)
app.include_router(street_activity.router)
app.include_router(public.router)
app.include_router(instinct.router)
app.include_router(logs.router)
app.include_router(activity.router)

# fixes25 §6: locally stored uploads (logo fallback when Cloudinary is
# unavailable) are served straight from the data volume.
os.makedirs(settings.upload_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.middleware("http")
async def _uploads_nosniff(request, call_next):
    """Security hardening: user-supplied files served from our own origin
    should never be MIME-sniffed by the browser into something executable."""
    response = await call_next(request)
    if request.url.path.startswith("/uploads/"):
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.middleware("http")
async def _request_context_and_activity(request: Request, call_next):
    """fixes102: (A) remember whose request this is (`current_user_id`) so a
    caught+logged error knows its org; (B) record successful data changes
    in the activity log of orgs that have it turned on."""
    from app.core import activity_log
    from app.core.error_log import _user_id_from_request, client_ip

    user_id = _user_id_from_request(request)
    ctx = activity_log.current_user_id.set(user_id)
    try:
        response = await call_next(request)
    finally:
        activity_log.current_user_id.reset(ctx)

    path = request.url.path
    if (
        user_id is None
        or not (200 <= response.status_code < 400)
        or not activity_log.should_track(request.method, path)
    ):
        return response
    org_id = await run_in_threadpool(activity_log.enabled_org_for_user, user_id)
    if org_id is None:
        return response

    route = getattr(request.scope.get("route"), "path", None) or path
    entity_id = activity_log.entity_id_from(request.scope.get("path_params") or {})
    # A create has no id in the URL — read it from the (JSON) response body.
    if entity_id is None and request.method == "POST" and response.headers.get(
        "content-type", ""
    ).startswith("application/json"):
        body = b"".join([chunk async for chunk in response.body_iterator])
        try:
            data = json.loads(body)
            if isinstance(data, dict) and isinstance(data.get("id"), int):
                entity_id = data["id"]
        except ValueError:
            pass
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        response = Response(
            content=body,
            status_code=response.status_code,
            headers=headers,
        )
    await run_in_threadpool(
        activity_log.write,
        organization_id=org_id,
        user_id=user_id,
        kind="action",
        action=f"{activity_log.describe(route)}.{activity_log.VERBS[request.method]}",
        method=request.method,
        route=route,
        entity_id=entity_id,
        ip=client_ip(request),
    )
    return response


# Order, outermost first (the last added is the outermost):
#   GZip > CORS > request gate > the two @app.middleware functions above > routes
# fixes107: the gate wraps the activity-log middleware, so its threads and
# side-pool sessions run inside an admitted request; CORS wraps the gate, so
# the browser can read the gate's 503.
app.add_middleware(
    ApiConcurrencyLimit,
    limit=REQUEST_CONNECTIONS,
    queue_timeout=API_QUEUE_TIMEOUT_SECONDS,
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
# fixes106: large JSON lists (apartments, contacts) are highly repetitive and
# compress ~8-10x; small responses (<1 KB) are passed through untouched.
app.add_middleware(GZipMiddleware, minimum_size=1000)


def _is_pool_timeout(exc: BaseException) -> bool:
    """True when `exc` (or what it wraps) is SQLAlchemy's QueuePool timeout."""
    seen = 0
    while exc is not None and seen < 10:
        if isinstance(exc, sa_exc.TimeoutError):
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


@app.exception_handler(Exception)
async def _unhandled_error(request: Request, exc: Exception):
    """fixes75 §4/§9: every unhandled error (a 500) is written to the
    error_logs table and emailed to the org's Errors Admin Emails list."""
    from app.core.error_log import record_error

    # fixes107: DB pool exhausted = overload, not a bug. Writing the error log
    # would need yet another connection (and a worker thread) from the same
    # exhausted pool — that wait used to double every stall. Answer 503 fast.
    if _is_pool_timeout(exc):
        _app_logger.warning("DB pool exhausted: %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=503,
            content={"detail": "Server is busy, please try again"},
            headers={"Retry-After": "5"},
        )
    error_id = await run_in_threadpool(record_error, request, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error", "error_id": error_id},
    )


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
