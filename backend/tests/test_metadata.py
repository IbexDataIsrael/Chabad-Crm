from app import models
from app.seed import seed_all, seed_localization


def test_localization_endpoint_shape(client, db_session):
    seed_localization(db_session)

    r = client.get("/api/metadata/localization")
    assert r.status_code == 200  # public, no auth required
    data = r.json()

    # Grouped by entity_type.
    assert set(data.keys()) >= {"table", "column", "interaction_category"}
    # Column keys are table-qualified and carry Hebrew labels.
    assert data["column"]["contacts.pipeline_status"] == "סטטוס"
    assert data["column"]["community_checklists.shabbat_candles"] == "נרות"
    assert data["column"]["contacts.area"] == "אזור"
    # Interaction categories present.
    assert data["interaction_category"]["heart_connection"] == "חיבור לב"


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

    # Sanity: seeding actually produced data.
    assert loc_first == 40  # 4 tables + 33 columns + 3 categories
    assert contacts_first == 2
