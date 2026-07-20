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
        "visit_history",
        "field_localization",
        "picklist_values",
    }
    assert expected.issubset(tables)
    assert "regions" not in tables  # replaced by the areas table
    # fixes25: the contact-level checklist + interaction tables are gone —
    # engagement data lives on visits.
    assert "community_checklists" not in tables
    assert "interactions" not in tables


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
        "background",
    }.issubset(mekurav_cols)
    # fixes25: rebbe_connection moved to visit_history.connection_to_rebbe.
    assert "rebbe_connection" not in mekurav_cols
    # fixes32: potential_next_step (picklist-backed) moved to PicklistLink.
    assert "potential_next_step" not in mekurav_cols


def test_visit_has_engagement_fields():
    """fixes25: visits carry the Mivtzoim flags, the interactions JSON log and
    the moved contact-level extras."""
    Base.metadata.create_all(bind=engine)
    visit_cols = {c["name"] for c in inspect(engine).get_columns("visit_history")}
    assert {
        "interactions",
        "tefillin",
        "tzedakah",
        "shabbat_candles",
        "torah_pamphlet",
        "letter_in_torah",
        "connection_to_rebbe",
    }.issubset(visit_cols)
    # fixes32: torah_thought/visit_type (picklist-backed) moved to PicklistLink.
    assert "torah_thought" not in visit_cols
    assert "visit_type" not in visit_cols
    value_cols = {c["name"] for c in inspect(engine).get_columns("custom_field_values")}
    assert "visit_id" in value_cols
    assert "contact_id" not in value_cols


def test_every_table_has_guid():
    insp = inspect(engine)
    for table in [
        "organizations",
        "users",
        "contacts",
        "visit_history",
        "field_localization",
        "picklist_values",
    ]:
        cols = {c["name"] for c in insp.get_columns(table)}
        assert "guid" in cols, f"{table} missing guid"


def test_user_has_role_column():
    cols = {c["name"] for c in inspect(engine).get_columns("users")}
    assert "role" in cols
