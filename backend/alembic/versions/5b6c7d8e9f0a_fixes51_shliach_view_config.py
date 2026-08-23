"""fixes51 §4 — Shliach Role Configuration Panel.

Adds `organizations.shliach_view_config` (nullable JSON) — one settings blob
for the admin-only /dashboard/shliach-config page: disable_edit, hide_filters,
default_filters, default_columns. Null (every existing org) means nothing
configured yet, so no backfill is needed.

Data-preserving both ways.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5b6c7d8e9f0a"
down_revision: Union[str, Sequence[str], None] = "4a5b6c7d8e9f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations", sa.Column("shliach_view_config", sa.JSON(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("organizations", "shliach_view_config")
