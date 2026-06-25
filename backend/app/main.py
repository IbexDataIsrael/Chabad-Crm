"""FastAPI application entrypoint.

Phase 1: database models are wired in and tables are created on startup. Auth
and the CRM routers are added in subsequent phases (see docs/plan.md).
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect

from app import models  # noqa: F401 — ensures models register on Base.metadata
from app.database import Base, SessionLocal, engine
from app.routers import (
    apartments,
    areas,
    auth,
    buildings,
    contacts,
    custom_fields,
    interactions,
    metadata,
    organizations,
    picklists,
    users,
)
from app.scheduler import start_scheduler, stop_scheduler
from app.seed import seed_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create any missing tables on startup (MVP — migrations come later if needed).
    Base.metadata.create_all(bind=engine)
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

# Allow the Next.js frontend (host port 3001) to call the API during local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(interactions.router)
app.include_router(metadata.router)
app.include_router(picklists.router)
app.include_router(users.router)
app.include_router(organizations.router)
app.include_router(custom_fields.router)
app.include_router(areas.router)
app.include_router(buildings.router)
app.include_router(apartments.router)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    """Liveness probe used by smoke checks."""
    return {"status": "ok"}


@app.get("/api/_diagnostics/tables", tags=["health"])
def list_tables() -> dict[str, list[str]]:
    """Temporary Phase 1 diagnostic: list the tables created in the database.

    Lets you visually confirm the schema exists. Removed once the CRM routers land.
    """
    inspector = inspect(engine)
    return {"tables": sorted(inspector.get_table_names())}
