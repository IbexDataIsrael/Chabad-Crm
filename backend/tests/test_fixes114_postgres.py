"""fixes114: concurrent apartment edits from the chat on real Postgres (row
locks) — SQLite serializes writers, so it can't show this race.

Runs only when FIXES114_PG_URL (or FIXES113_PG_URL) points at a THROWAWAY
database (the tables are created and dropped here), e.g.
    FIXES114_PG_URL=postgresql://crm_admin:...@host.docker.internal:5432/crm_fixes113_test
"""
import os
import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, or_
from sqlalchemy.orm import sessionmaker

from app import models
from app.core.security import create_access_token
from app.database import Base, get_db
from app.main import app
from app.routers import assistant_apartments

PG_URL = os.environ.get("FIXES114_PG_URL") or os.environ.get("FIXES113_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="FIXES114_PG_URL not set")

URL = "/api/assistant/apartments"


@pytest.fixture
def pg():
    assert "test" in PG_URL.rsplit("/", 1)[-1], "the URL must name a *test* database"
    engine = create_engine(PG_URL, pool_size=20)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    from app.seed import seed_building_types, seed_roles

    db = Session()
    seed_roles(db)
    seed_building_types(db)
    org = models.Organization(name="Assistant QA")
    db.add(org)
    db.commit()
    user = models.User(organization_id=org.id, username="qa", full_name="qa", role="admin", is_active=True)
    building = models.Building(organization_id=org.id, building_address="Herzl 10")
    db.add_all([user, building])
    db.flush()
    for i, value in enumerate(("jewish", "not_jewish", "unknown")):
        db.add(models.PicklistValue(organization_id=org.id, field_key="apartment.Jewish_status",
                                    value=value, hebrew_label=value, sort_order=i))
    apartment = models.Apartment(organization_id=org.id, building_id=building.id, apartment_name="3")
    db.add(apartment)
    db.commit()
    headers = {"Authorization": f"Bearer {create_access_token(subject=str(user.id), role='admin')}"}

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _get_db
    try:
        yield {"Session": Session, "headers": headers, "apartment": apartment.id}
    finally:
        db.close()
        app.dependency_overrides[get_db] = previous
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_concurrent_edits_of_one_version_write_exactly_once(pg, monkeypatch):
    """N edits pass every check together (barrier right before the claim),
    then race; the winner holds its row lock a while before writing."""
    values = ["jewish", "not_jewish", "jewish", "not_jewish", "jewish", "not_jewish"]
    n = len(values)
    barrier = threading.Barrier(n, timeout=20)
    seen = threading.local()
    real_views = assistant_apartments._views
    real_update = assistant_apartments._apply_versioned_update

    def views(*args, **kwargs):
        out = real_views(*args, **kwargs)
        if not getattr(seen, "waited", False):  # the read just before the claim
            seen.waited = True
            barrier.wait()
        return out

    def slow_update(*args, **kwargs):
        time.sleep(0.5)  # the claim's row lock is held here
        return real_update(*args, **kwargs)

    monkeypatch.setattr(assistant_apartments, "_views", views)
    monkeypatch.setattr(assistant_apartments, "_apply_versioned_update", slow_update)

    results = [None] * n

    def run(i):
        results[i] = TestClient(app).post(
            f"{URL}/{pg['apartment']}/update",
            json={"field_key": "apartment.Jewish_status", "value": values[i]},
            headers=pg["headers"],
        )

    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)

    codes = sorted(r.status_code for r in results)
    assert codes == [200] + [409] * (n - 1), [r.text for r in results]
    winner = next(r.json() for r in results if r.status_code == 200)
    db = pg["Session"]()
    try:
        lineage = db.query(models.Apartment).filter(
            or_(models.Apartment.id == pg["apartment"], models.Apartment.root_id == pg["apartment"])
        ).all()
        active = [a for a in lineage if a.is_display]
        assert len(lineage) == 2 and [a.id for a in active] == [winner["apartment_id"]]
    finally:
        db.close()
