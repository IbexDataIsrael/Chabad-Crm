"""fixes32 — generic normalized picklist storage.

Replaces every hardcoded picklist-backed column with one generic table,
`picklist_links` (organization_id, entity_table, entity_id,
picklist_definition_id, picklist_value_id — a real FK to `picklist_values.id`,
not a stored text token). Also retires the old contact-only
`contact_picklist_values` junction table into the same generic store.

Columns migrated: apartments.jewish_status / campaign_status /
mezuzah_status / language; contacts.pipeline_status / color_tag;
contact_mekurav.potential_next_step; visit_history.torah_thought /
visit_type; significant_dates.special_date_type.

Deliberately excluded (see docs/fixes32-plan.md §0): contacts.contact_type
(structural type discriminator, not a true open picklist) and
interaction.category (embedded in visit_history.interactions JSON, not a
per-row column).

Apartments are versioned (every edit inserts a new row with a new id); links
for entity_table="apartments" are keyed by each version's own id so
historical snapshots keep their own value — the apartments router copies
links forward onto each new version.

Data-preserving both ways: upgrade backfills picklist_links from the old
columns (creating any missing PicklistDefinition/PicklistValue rows for
legacy/free-text values so nothing is dropped); downgrade backfills the old
columns (and contact_picklist_values) back from picklist_links before
dropping it.
"""
import datetime
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, Sequence[str], None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (entity_table, value_column, field_key, hebrew_label_for_a_missing_definition)
_COLUMN_MIGRATIONS = [
    ("apartments", "jewish_status", "apartment.Jewish_status", "יהדות (דירה)"),
    ("apartments", "campaign_status", "apartment.campaign_status", "סטטוס קמפיין"),
    ("apartments", "mezuzah_status", "apartment.mezuzah_status", "מזוזה"),
    ("apartments", "language", "apartment.language", "שפה"),
    ("contacts", "pipeline_status", "contact.pipeline_status", "סטטוס"),
    ("contacts", "color_tag", "contact.color_tag", "צבע"),
    ("contact_mekurav", "potential_next_step", "contact.potential_next_step", "פוטנציאל לצעד"),
    ("visit_history", "torah_thought", "checklist.torah_thought", "דבר תורה"),
    ("visit_history", "visit_type", "visit.type", "סוג ביקור"),
    ("significant_dates", "special_date_type", "significant_date.type", "סוג תאריך"),
]

# The 2 contact.* field_keys that get a real column back on downgrade — every
# other contact-scoped link (Jewish_status, affiliation, language, any custom
# picklist) is dynamic and goes back into contact_picklist_values.
_CONTACT_COLUMN_FIELD_KEYS = ("contact.pipeline_status", "contact.color_tag")


def _get_or_create_definition_id(conn, cache, org_id, field_key, hebrew_label) -> int:
    key = (org_id, field_key)
    if key in cache:
        return cache[key]
    row = conn.execute(
        sa.text("SELECT id FROM picklists WHERE organization_id = :o AND system_name = :f"),
        {"o": org_id, "f": field_key},
    ).first()
    if row:
        cache[key] = row[0]
        return row[0]
    now = datetime.datetime.utcnow()
    conn.execute(
        sa.text(
            "INSERT INTO picklists"
            " (guid, organization_id, system_name, hebrew_display_name, is_system,"
            "  sort_order, created_at)"
            " VALUES (:g, :o, :f, :h, 1, 0, :now)"
        ),
        {"g": str(uuid.uuid4()), "o": org_id, "f": field_key, "h": hebrew_label, "now": now},
    )
    new_id = conn.execute(
        sa.text("SELECT id FROM picklists WHERE organization_id = :o AND system_name = :f"),
        {"o": org_id, "f": field_key},
    ).scalar()
    cache[key] = new_id
    return new_id


def _get_or_create_value_id(conn, cache, org_id, field_key, value) -> int:
    key = (org_id, field_key, value)
    if key in cache:
        return cache[key]
    row = conn.execute(
        sa.text(
            "SELECT id FROM picklist_values"
            " WHERE organization_id = :o AND field_key = :f AND value = :v"
        ),
        {"o": org_id, "f": field_key, "v": value},
    ).first()
    if row:
        cache[key] = row[0]
        return row[0]
    # Legacy/free-text value with no matching option — create one so the data
    # survives the migration instead of being silently dropped.
    max_sort = conn.execute(
        sa.text(
            "SELECT COALESCE(MAX(sort_order), -1) FROM picklist_values"
            " WHERE organization_id = :o AND field_key = :f"
        ),
        {"o": org_id, "f": field_key},
    ).scalar()
    now = datetime.datetime.utcnow()
    # Inactive by default (matches app.picklist_utils.set_value's same
    # fallback): this branch only runs when the field had zero *active*
    # options to begin with (e.g. apartment.campaign_status, which ships
    # empty by design — every one of its values hits this path). Making the
    # first legacy value "active" would make it the field's only allowed
    # value and start rejecting every other pre-existing free-text value.
    conn.execute(
        sa.text(
            "INSERT INTO picklist_values"
            " (guid, organization_id, field_key, value, hebrew_label, sort_order,"
            "  is_active, is_default, created_at, updated_at)"
            " VALUES (:g, :o, :f, :v, :v, :s, 0, 0, :now, :now)"
        ),
        {
            "g": str(uuid.uuid4()), "o": org_id, "f": field_key, "v": value,
            "s": (max_sort if max_sort is not None else -1) + 1, "now": now,
        },
    )
    new_id = conn.execute(
        sa.text(
            "SELECT id FROM picklist_values"
            " WHERE organization_id = :o AND field_key = :f AND value = :v"
        ),
        {"o": org_id, "f": field_key, "v": value},
    ).scalar()
    cache[key] = new_id
    return new_id


def _insert_link(conn, org_id, entity_table, entity_id, definition_id, value_id) -> None:
    now = datetime.datetime.utcnow()
    conn.execute(
        sa.text(
            "INSERT INTO picklist_links"
            " (guid, organization_id, entity_table, entity_id, picklist_definition_id,"
            "  picklist_value_id, created_at, updated_at)"
            " VALUES (:g, :o, :et, :eid, :did, :vid, :now, :now)"
        ),
        {
            "g": str(uuid.uuid4()), "o": org_id, "et": entity_table, "eid": entity_id,
            "did": definition_id, "vid": value_id, "now": now,
        },
    )


def _hydrate_links(conn) -> None:
    def_cache: dict = {}
    value_cache: dict = {}
    for entity_table, col, field_key, hebrew_label in _COLUMN_MIGRATIONS:
        rows = conn.execute(
            sa.text(
                f"SELECT id, organization_id, {col} AS v FROM {entity_table}"
                f" WHERE {col} IS NOT NULL AND {col} <> ''"
            )
        ).fetchall()
        for r in rows:
            m = r._mapping
            def_id = _get_or_create_definition_id(
                conn, def_cache, m["organization_id"], field_key, hebrew_label
            )
            val_id = _get_or_create_value_id(
                conn, value_cache, m["organization_id"], field_key, m["v"]
            )
            _insert_link(conn, m["organization_id"], entity_table, m["id"], def_id, val_id)

    # Existing dynamic contact picklists (Jewish_status/affiliation/language/
    # any admin-added custom list) fold into the same generic store.
    rows = conn.execute(
        sa.text(
            "SELECT cpv.organization_id, cpv.contact_id, cpv.value, cpv.picklist_id,"
            " pd.system_name FROM contact_picklist_values cpv"
            " JOIN picklists pd ON pd.id = cpv.picklist_id"
        )
    ).fetchall()
    for r in rows:
        m = r._mapping
        val_id = _get_or_create_value_id(
            conn, value_cache, m["organization_id"], m["system_name"], m["value"]
        )
        _insert_link(
            conn, m["organization_id"], "contacts", m["contact_id"], m["picklist_id"], val_id
        )


def _restore_column(conn, entity_table, col, field_key) -> None:
    conn.execute(
        sa.text(
            f"UPDATE {entity_table} SET {col} = ("
            " SELECT pv.value FROM picklist_links pl"
            " JOIN picklist_values pv ON pv.id = pl.picklist_value_id"
            " JOIN picklists pd ON pd.id = pl.picklist_definition_id"
            f" WHERE pl.entity_table = '{entity_table}' AND pl.entity_id = {entity_table}.id"
            "  AND pd.system_name = :fk"
            ")"
            f" WHERE {entity_table}.id IN ("
            " SELECT pl2.entity_id FROM picklist_links pl2"
            " JOIN picklists pd2 ON pd2.id = pl2.picklist_definition_id"
            f" WHERE pl2.entity_table = '{entity_table}' AND pd2.system_name = :fk"
            ")"
        ),
        {"fk": field_key},
    )


def upgrade() -> None:
    conn = op.get_bind()

    op.create_table(
        "picklist_links",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("entity_table", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("picklist_definition_id", sa.Integer(), nullable=False),
        sa.Column("picklist_value_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["picklist_definition_id"], ["picklists.id"]),
        sa.ForeignKeyConstraint(["picklist_value_id"], ["picklist_values.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "entity_table", "entity_id", "picklist_definition_id",
            name="uq_picklist_link_entity_field",
        ),
    )
    op.create_index(op.f("ix_picklist_links_guid"), "picklist_links", ["guid"], unique=True)
    op.create_index(
        op.f("ix_picklist_links_organization_id"), "picklist_links", ["organization_id"]
    )
    op.create_index(op.f("ix_picklist_links_entity_table"), "picklist_links", ["entity_table"])
    op.create_index(op.f("ix_picklist_links_entity_id"), "picklist_links", ["entity_id"])
    op.create_index(
        op.f("ix_picklist_links_picklist_definition_id"),
        "picklist_links", ["picklist_definition_id"],
    )
    op.create_index(
        op.f("ix_picklist_links_picklist_value_id"), "picklist_links", ["picklist_value_id"]
    )

    _hydrate_links(conn)

    op.drop_column("apartments", "jewish_status")
    op.drop_column("apartments", "campaign_status")
    op.drop_column("apartments", "mezuzah_status")
    op.drop_column("apartments", "language")
    op.drop_column("contacts", "pipeline_status")
    op.drop_column("contacts", "color_tag")
    op.drop_column("contact_mekurav", "potential_next_step")
    op.drop_column("visit_history", "torah_thought")
    op.drop_column("visit_history", "visit_type")
    op.drop_column("significant_dates", "special_date_type")

    op.drop_index(op.f("ix_contact_picklist_values_picklist_id"), table_name="contact_picklist_values")
    op.drop_index(op.f("ix_contact_picklist_values_organization_id"), table_name="contact_picklist_values")
    op.drop_index(op.f("ix_contact_picklist_values_guid"), table_name="contact_picklist_values")
    op.drop_index(op.f("ix_contact_picklist_values_contact_id"), table_name="contact_picklist_values")
    op.drop_table("contact_picklist_values")


def downgrade() -> None:
    conn = op.get_bind()

    op.add_column("apartments", sa.Column("jewish_status", sa.String(length=100), nullable=True))
    op.add_column("apartments", sa.Column("campaign_status", sa.String(length=100), nullable=True))
    op.add_column("apartments", sa.Column("mezuzah_status", sa.String(length=100), nullable=True))
    op.add_column("apartments", sa.Column("language", sa.String(length=100), nullable=True))
    op.add_column("contacts", sa.Column("pipeline_status", sa.String(length=50), nullable=True))
    op.add_column("contacts", sa.Column("color_tag", sa.String(length=20), nullable=True))
    op.add_column(
        "contact_mekurav", sa.Column("potential_next_step", sa.String(length=50), nullable=True)
    )
    op.add_column("visit_history", sa.Column("torah_thought", sa.String(length=50), nullable=True))
    op.add_column("visit_history", sa.Column("visit_type", sa.String(), nullable=True))
    op.add_column(
        "significant_dates", sa.Column("special_date_type", sa.String(length=50), nullable=True)
    )

    for entity_table, col, field_key, _ in _COLUMN_MIGRATIONS:
        _restore_column(conn, entity_table, col, field_key)

    op.create_table(
        "contact_picklist_values",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("picklist_id", sa.Integer(), nullable=False),
        sa.Column("value", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"]),
        sa.ForeignKeyConstraint(["picklist_id"], ["picklists.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("contact_id", "picklist_id", name="uq_contact_picklist"),
    )
    op.create_index(
        op.f("ix_contact_picklist_values_guid"), "contact_picklist_values", ["guid"], unique=True
    )
    op.create_index(
        op.f("ix_contact_picklist_values_organization_id"),
        "contact_picklist_values", ["organization_id"],
    )
    op.create_index(
        op.f("ix_contact_picklist_values_contact_id"),
        "contact_picklist_values", ["contact_id"],
    )
    op.create_index(
        op.f("ix_contact_picklist_values_picklist_id"),
        "contact_picklist_values", ["picklist_id"],
    )

    known = ", ".join(f"'{fk}'" for fk in _CONTACT_COLUMN_FIELD_KEYS)
    dynamic_rows = conn.execute(
        sa.text(
            "SELECT pl.organization_id, pl.entity_id AS contact_id,"
            " pl.picklist_definition_id AS picklist_id, pv.value"
            " FROM picklist_links pl"
            " JOIN picklist_values pv ON pv.id = pl.picklist_value_id"
            " JOIN picklists pd ON pd.id = pl.picklist_definition_id"
            f" WHERE pl.entity_table = 'contacts' AND pd.system_name NOT IN ({known})"
        )
    ).fetchall()
    for r in dynamic_rows:
        m = r._mapping
        conn.execute(
            sa.text(
                "INSERT INTO contact_picklist_values"
                " (guid, organization_id, contact_id, picklist_id, value)"
                " VALUES (:g, :o, :cid, :pid, :v)"
            ),
            {
                "g": str(uuid.uuid4()), "o": m["organization_id"], "cid": m["contact_id"],
                "pid": m["picklist_id"], "v": m["value"],
            },
        )

    op.drop_index(op.f("ix_picklist_links_picklist_value_id"), table_name="picklist_links")
    op.drop_index(op.f("ix_picklist_links_picklist_definition_id"), table_name="picklist_links")
    op.drop_index(op.f("ix_picklist_links_entity_id"), table_name="picklist_links")
    op.drop_index(op.f("ix_picklist_links_entity_table"), table_name="picklist_links")
    op.drop_index(op.f("ix_picklist_links_organization_id"), table_name="picklist_links")
    op.drop_index(op.f("ix_picklist_links_guid"), table_name="picklist_links")
    op.drop_table("picklist_links")
