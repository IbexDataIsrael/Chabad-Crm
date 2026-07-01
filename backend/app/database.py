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

if db_url.startswith("sqlite"):
    # SQLite needs check_same_thread=False to be used across FastAPI's threadpool.
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
else:
    # PostgreSQL (and other server DBs): pooled connections with liveness checks.
    engine = create_engine(
        db_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """Yield a database session, ensuring it is closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
