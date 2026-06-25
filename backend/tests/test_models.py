from sqlalchemy import inspect

from app.database import engine
from app.main import app  # noqa: F401 — triggers nothing; tables created below
from app.database import Base


def test_all_tables_created():
    Base.metadata.create_all(bind=engine)
    tables = set(inspect(engine).get_table_names())
    expected = {
        "organizations",
        "users",
        "contacts",
        "community_checklists",
        "interactions",
        "field_localization",
        "picklist_values",
    }
    assert expected.issubset(tables)
    assert "regions" not in tables  # replaced by the contact.area picklist


def test_contact_has_new_fields():
    cols = {c["name"] for c in inspect(engine).get_columns("contacts")}
    assert {"area", "first_visit", "potential_next_step", "background", "phone"}.issubset(cols)
    assert "region_id" not in cols


def test_every_table_has_guid():
    insp = inspect(engine)
    for table in [
        "organizations",
        "users",
        "contacts",
        "community_checklists",
        "interactions",
        "field_localization",
        "picklist_values",
    ]:
        cols = {c["name"] for c in insp.get_columns(table)}
        assert "guid" in cols, f"{table} missing guid"


def test_user_has_role_column():
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert "role" in cols
