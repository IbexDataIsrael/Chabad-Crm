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
    assert "regions" not in tables  # replaced by the areas table


def test_contact_has_new_fields():
    # Core CRM fields stay on `contacts`; kiruv fields moved to `contact_mekurav`
    # in the fixes2 split.
    Base.metadata.create_all(bind=engine)
    insp = inspect(engine)
    contact_cols = {c["name"] for c in insp.get_columns("contacts")}
    assert {"phone", "email", "contact_type"}.issubset(contact_cols)
    assert "region_id" not in contact_cols

    mekurav_cols = {c["name"] for c in insp.get_columns("contact_mekurav")}
    assert {
        "first_visit",
        "potential_next_step",
        "background",
        "rebbe_connection",
    }.issubset(mekurav_cols)


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
