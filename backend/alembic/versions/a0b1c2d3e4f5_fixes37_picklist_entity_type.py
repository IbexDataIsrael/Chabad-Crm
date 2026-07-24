"""fixes37 — PicklistDefinition.entity_type as real data.

`picklists.system_name` has always followed a string-prefix convention
(`apartment.*`, `visit.`/`checklist.`/`interaction.*`, `significant_date.*`,
`shliach.*`, everything else contact-level) to signal which entity a
picklist belongs to — but nothing in the schema recorded it; every consumer
(8 frontend files, plus field_registry.py's picklist_entity() on the
backend) re-derived it from the string itself (see docs/fixes37-plan.md).
This migration adds a real `entity_type` column (contact_mekurav |
contact_shliach | apartment | visit | significant_date — matching the
vocabulary CustomFieldDefinition.entity_type already uses) and backfills
existing rows from that same convention, so it stops being implicit.

Data-preserving both ways (downgrade just drops the column — the entity
association reverts to being implicit in system_name again, same as before
this migration).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a0b1c2d3e4f5"
down_revision: Union[str, Sequence[str], None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    op.add_column(
        "picklists",
        sa.Column(
            "entity_type",
            sa.String(length=30),
            nullable=False,
            server_default="contact_mekurav",
        ),
    )

    # Backfill from the system_name prefix convention (matches
    # app/picklist_utils.py PICKLIST_FIELDS and the frontend's prior
    # startsWith()-based guessing). server_default already covers the
    # "contact_mekurav" case (bare names, contact.*), so only the other 3
    # need an explicit UPDATE.
    conn.execute(
        sa.text(
            "UPDATE picklists SET entity_type = 'apartment'"
            " WHERE system_name LIKE 'apartment.%'"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE picklists SET entity_type = 'visit'"
            " WHERE system_name LIKE 'visit.%'"
            "    OR system_name LIKE 'checklist.%'"
            "    OR system_name LIKE 'interaction.%'"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE picklists SET entity_type = 'significant_date'"
            " WHERE system_name LIKE 'significant_date.%'"
        )
    )
    # shliach.* is a real, existing sub-namespace of contact (fixes35 §5:
    # admin-added custom picklists scoped to shliach-type contacts only,
    # rendered in their own section — see field_registry.py's identical
    # startswith("shliach.") check for CustomFieldDefinition). Distinct from
    # plain "contact" so the contact-detail page's mekurav-section fallthrough
    # doesn't pick these up (same leak shape fixes36 fixed for significant_date).
    conn.execute(
        sa.text(
            "UPDATE picklists SET entity_type = 'contact_shliach'"
            " WHERE system_name LIKE 'shliach.%'"
        )
    )

    # Every future insert (seed or admin create) must now pass entity_type
    # explicitly — no silent fallback that reintroduces guessing.
    op.alter_column("picklists", "entity_type", server_default=None)


def downgrade() -> None:
    op.drop_column("picklists", "entity_type")
