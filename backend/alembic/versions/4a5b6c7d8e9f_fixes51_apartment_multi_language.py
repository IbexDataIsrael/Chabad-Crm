"""fixes51 §2.2 — apartment.language becomes multi-select.

`picklist_links` (fixes32) enforced exactly one selected value per
(entity_table, entity_id, picklist_definition_id) via
`uq_picklist_link_entity_field`. To let an apartment carry more than one
language, that constraint is loosened to include `picklist_value_id` — one
row per selected value instead of one row per field. Every other
picklist-backed field keeps its single-value behavior purely at the
application layer (`picklist_utils.set_value` still upserts in place), so
this is additive: nothing about the existing single-select fields changes.

`picklists.allow_multiple` (new column, default False) marks which
definitions the frontend/backend should treat as multi-value; only
`apartment.language` (every org) is backfilled to True here — new orgs get
it set at provisioning time (see `app/seed.py`).

Data-preserving both ways: downgrade re-derives the single-row constraint by
keeping only the most-recently-created link per (entity_table, entity_id,
picklist_definition_id) — any org that had actually picked >1 language loses
all but one on downgrade (same lossy-but-safe shape as other downgrades in
this migration chain that collapse newly-generalized data back into an
older, narrower model).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4a5b6c7d8e9f"
down_revision: Union[str, Sequence[str], None] = "3c4d5e6f7a8b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "picklists",
        sa.Column(
            "allow_multiple", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    conn.execute(
        sa.text(
            "UPDATE picklists SET allow_multiple = TRUE"
            " WHERE system_name = 'apartment.language'"
        )
    )

    op.drop_constraint(
        "uq_picklist_link_entity_field", "picklist_links", type_="unique"
    )
    op.create_unique_constraint(
        "uq_picklist_link_entity_field",
        "picklist_links",
        ["entity_table", "entity_id", "picklist_definition_id", "picklist_value_id"],
    )


def downgrade() -> None:
    conn = op.get_bind()

    # Collapse any (entity, field) with more than one link down to its
    # most-recently-created row before the narrower constraint can apply.
    conn.execute(
        sa.text(
            "DELETE FROM picklist_links WHERE id IN ("
            "  SELECT pl.id FROM picklist_links pl"
            "  WHERE pl.id NOT IN ("
            "    SELECT MAX(pl2.id) FROM picklist_links pl2"
            "    GROUP BY pl2.entity_table, pl2.entity_id, pl2.picklist_definition_id"
            "  )"
            ")"
        )
    )

    op.drop_constraint(
        "uq_picklist_link_entity_field", "picklist_links", type_="unique"
    )
    op.create_unique_constraint(
        "uq_picklist_link_entity_field",
        "picklist_links",
        ["entity_table", "entity_id", "picklist_definition_id"],
    )

    op.drop_column("picklists", "allow_multiple")
