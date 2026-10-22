"""SQLAlchemy engine, session factory, declarative Base, and the request-scoped
`get_db` dependency used by routers.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

# Normalize the URL: some managed providers hand out `postgres://`, but SQLAlchemy
# requires the `postgresql://` (or `postgresql+psycopg2://`) scheme.
db_url = settings.database_url
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

# fixes107 — connection budget (30 in total, unchanged), split in two pools:
#
# * request pool (25): only `get_db` sessions — one per request, held until
#   the response is sent and its background tasks ran (FastAPI's default
#   "request" dependency scope).
# * side pool (5): every session opened outside `get_db` — activity log,
#   background-task emails, error logging, the scheduler, diagnostics. Each
#   of those runs one short operation and never waits on a request, so they
#   can't form a wait cycle with requests.
#
# core/concurrency.py admits at most REQUEST_POOL_SIZE API requests at once,
# so a request can always get its connection without waiting. Before this,
# 40 worker threads competed for 30 connections that requests kept while
# waiting for a thread again: under load every thread waited on the pool and
# every connection holder waited on a thread (measured: CPU 0%, 30 sessions
# "idle in transaction", nothing completing until 30s pool timeouts fired).
REQUEST_POOL_SIZE = 10
REQUEST_POOL_OVERFLOW = 15
REQUEST_CONNECTIONS = REQUEST_POOL_SIZE + REQUEST_POOL_OVERFLOW
SIDE_POOL_SIZE = 2
SIDE_POOL_OVERFLOW = 3
# Requests never wait here when the gate holds; a 5s timeout only matters if
# the budget is broken, and then it fails fast instead of parking a thread.
REQUEST_POOL_TIMEOUT_SECONDS = 5
# Side work only waits for other short side operations — no cycle — so a
# longer wait is safe and keeps e.g. a welcome email from being dropped.
SIDE_POOL_TIMEOUT_SECONDS = 15
# How long a request may wait for an API slot before a fast 503.
API_QUEUE_TIMEOUT_SECONDS = 15

if db_url.startswith("sqlite"):
    # SQLite needs check_same_thread=False to be used across FastAPI's threadpool.
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    side_engine = engine
else:
    # PostgreSQL (and other server DBs): pooled connections with liveness checks.
    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=REQUEST_POOL_SIZE,
        max_overflow=REQUEST_POOL_OVERFLOW,
        pool_timeout=REQUEST_POOL_TIMEOUT_SECONDS,
    )
    side_engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=SIDE_POOL_SIZE,
        max_overflow=SIDE_POOL_OVERFLOW,
        pool_timeout=SIDE_POOL_TIMEOUT_SECONDS,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# For any session opened outside a request's `get_db` (see above).
SideSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=side_engine)
Base = declarative_base()


def get_db():
    """Yield a database session, ensuring it is closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
