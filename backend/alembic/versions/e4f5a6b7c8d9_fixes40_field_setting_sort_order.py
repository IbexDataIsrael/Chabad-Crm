"""fixes40 round 2 §3 — FieldSetting.sort_order.

Nullable `field_settings.sort_order`: NULL means unordered (falls after every
explicitly-ordered field, in its original registry position) — no backfill
needed for any existing row.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, Sequence[str], None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "field_settings", sa.Column("sort_order", sa.Integer(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("field_settings", "sort_order")
