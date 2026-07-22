"""fixes35 — generalize custom fields to every entity + field type.

`custom_field_definitions` gains `entity_type` (contact_mekurav /
contact_shliach / visit / apartment — existing rows backfill "visit") and
`field_type` (text / number / boolean / date / select — existing rows
backfill "boolean") plus an optional `english_label`. The unique constraint
moves from (org, field_key) to (org, entity_type, field_key) since a field
key is now only required to be unique within its own entity.

`custom_field_values` gains `organization_id` (mirrors `picklist_links` —
removes the need for the visit_id-join special-casing `core/backup.py` and
`routers/admin.py` both carried purely because this table had no org column
of its own) and generic `entity_table`/`entity_id` (mirrors `picklist_links`
exactly). Existing rows backfill `entity_table='visit_history'`,
`entity_id=visit_id`, `organization_id` from the owning visit's org. The old
`visit_id` column is deliberately KEPT (nullable, unused by new code) rather
than dropped: up to 10 backup snapshots per org (fixes16) may contain
pre-migration rows shaped `{visit_id, definition_id, checked, note}` with no
`organization_id`/`entity_table` at all, and `restore_snapshot` drops any
column absent from the current model — dropping `visit_id` here would
silently lose that data on a future restore of an old snapshot. A new
`value` column (nullable text) holds text/number/date values (parsed at the
API boundary, same as `PicklistValue.value` has no DB-level type).

Data-preserving both ways.
"""
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f9a0b1c2d3e4"
down_revision: Union[str, Sequence[str], None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # --- custom_field_definitions ------------------------------------------
    op.add_column(
        "custom_field_definitions",
        sa.Column("entity_type", sa.String(length=30), nullable=False, server_default="visit"),
    )
    op.add_column(
        "custom_field_definitions",
        sa.Column("field_type", sa.String(length=20), nullable=False, server_default="boolean"),
    )
    op.add_column(
        "custom_field_definitions", sa.Column("english_label", sa.String(length=100), nullable=True)
    )
    op.alter_column("custom_field_definitions", "entity_type", server_default=None)
    op.alter_column("custom_field_definitions", "field_type", server_default=None)

    op.drop_constraint(
        "uq_customfield_org_key", "custom_field_definitions", type_="unique"
    )
    op.create_unique_constraint(
        "uq_customfield_org_entity_key",
        "custom_field_definitions",
        ["organization_id", "entity_type", "field_key"],
    )

    # --- custom_field_values -------------------------------------------------
    op.add_column(
        "custom_field_values",
        sa.Column("organization_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "custom_field_values", sa.Column("entity_table", sa.String(length=50), nullable=True)
    )
    op.add_column("custom_field_values", sa.Column("entity_id", sa.Integer(), nullable=True))
    op.add_column("custom_field_values", sa.Column("value", sa.Text(), nullable=True))
    # visit_id was NOT NULL before this migration — relax it since new,
    # non-visit rows never set it.
    op.alter_column("custom_field_values", "visit_id", nullable=True)

    conn.execute(
        sa.text(
            "UPDATE custom_field_values SET"
            " organization_id = (SELECT organization_id FROM visit_history"
            "                     WHERE visit_history.id = custom_field_values.visit_id),"
            " entity_table = 'visit_history',"
            " entity_id = custom_field_values.visit_id"
            " WHERE custom_field_values.entity_table IS NULL"
        )
    )
    op.alter_column("custom_field_values", "organization_id", nullable=False)

    op.create_foreign_key(
        "fk_customval_org", "custom_field_values", "organizations",
        ["organization_id"], ["id"],
    )
    op.create_index(
        op.f("ix_custom_field_values_organization_id"), "custom_field_values", ["organization_id"]
    )
    op.create_index(
        op.f("ix_custom_field_values_entity_table"), "custom_field_values", ["entity_table"]
    )
    op.create_index(
        op.f("ix_custom_field_values_entity_id"), "custom_field_values", ["entity_id"]
    )

    op.drop_constraint("uq_customval_visit_def", "custom_field_values", type_="unique")
    op.create_unique_constraint(
        "uq_customval_entity_def",
        "custom_field_values",
        ["entity_table", "entity_id", "definition_id"],
    )


def downgrade() -> None:
    conn = op.get_bind()

    op.drop_constraint("uq_customval_entity_def", "custom_field_values", type_="unique")

    # A row created after this migration for a non-visit entity_type (or any
    # row that never had a visit_id in the first place) has no way to satisfy
    # the pre-fixes35 NOT NULL visit_id constraint — this data structurally
    # cannot exist in the old schema. Documented, accepted data loss on
    # downgrade only (mirrors d1e2f3a4b5c6's own downgrade caveats); upgrade
    # never loses anything.
    conn.execute(
        sa.text(
            "DELETE FROM custom_field_values"
            " WHERE entity_table IS DISTINCT FROM 'visit_history' OR visit_id IS NULL"
        )
    )

    op.create_unique_constraint(
        "uq_customval_visit_def", "custom_field_values", ["visit_id", "definition_id"]
    )

    op.drop_index(op.f("ix_custom_field_values_entity_id"), table_name="custom_field_values")
    op.drop_index(op.f("ix_custom_field_values_entity_table"), table_name="custom_field_values")
    op.drop_index(
        op.f("ix_custom_field_values_organization_id"), table_name="custom_field_values"
    )
    op.drop_constraint("fk_customval_org", "custom_field_values", type_="foreignkey")

    op.alter_column("custom_field_values", "visit_id", nullable=False)
    op.drop_column("custom_field_values", "value")
    op.drop_column("custom_field_values", "entity_id")
    op.drop_column("custom_field_values", "entity_table")
    op.drop_column("custom_field_values", "organization_id")

    op.drop_constraint(
        "uq_customfield_org_entity_key", "custom_field_definitions", type_="unique"
    )

    # Two definitions in different entity_types sharing a field_key (allowed
    # since this migration's upgrade, now impossible to represent) would
    # violate the restored (org, field_key)-only constraint — keep the
    # oldest, drop the rest (and its values, via the model's cascade — done
    # in Python below since a raw DELETE here wouldn't cascade to
    # custom_field_values). Same accepted-downgrade-data-loss rationale as
    # the visit_id cleanup above.
    conn.execute(
        sa.text(
            "DELETE FROM custom_field_values WHERE definition_id IN ("
            " SELECT id FROM custom_field_definitions WHERE id NOT IN ("
            "  SELECT MIN(id) FROM custom_field_definitions"
            "  GROUP BY organization_id, field_key"
            " )"
            ")"
        )
    )
    conn.execute(
        sa.text(
            "DELETE FROM custom_field_definitions WHERE id NOT IN ("
            " SELECT MIN(id) FROM custom_field_definitions"
            " GROUP BY organization_id, field_key"
            ")"
        )
    )

    op.create_unique_constraint(
        "uq_customfield_org_key", "custom_field_definitions", ["organization_id", "field_key"]
    )
    op.drop_column("custom_field_definitions", "english_label")
    op.drop_column("custom_field_definitions", "field_type")
    op.drop_column("custom_field_definitions", "entity_type")
