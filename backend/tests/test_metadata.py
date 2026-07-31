from app import models
from app.seed import seed_all, seed_localization


def test_localization_endpoint_shape(client, db_session):
    seed_localization(db_session)

    r = client.get("/api/metadata/localization")
    assert r.status_code == 200  # public, no auth required
    data = r.json()

    # Flat map keyed by technical_name, each value carrying he + en.
    assert data["contacts.pipeline_status"]["he"] == "סטטוס"
    assert data["contacts.pipeline_status"]["en"] == "Status"
    assert data["visits.shabbat_candles"]["he"] == "נרות"
    assert data["nav.contacts"]["he"] == "אנשי קשר"


def test_localization_requires_no_auth(client, db_session):
    seed_localization(db_session)
    # No Authorization header at all.
    assert client.get("/api/metadata/localization").status_code == 200


def test_seed_all_is_idempotent(client, db_session):
    seed_all(db_session)
    loc_first = db_session.query(models.FieldLocalization).count()
    contacts_first = db_session.query(models.Contact).count()
    users_first = db_session.query(models.User).count()

    seed_all(db_session)
    assert db_session.query(models.FieldLocalization).count() == loc_first
    assert db_session.query(models.Contact).count() == contacts_first
    assert db_session.query(models.User).count() == users_first

    # Sanity: seeding actually produced data (full bilingual UI string set).
    assert loc_first > 100
    assert contacts_first >= 2
