"""fixes40 §4 — global field-label text styling.

Three independently-nullable `organizations` columns: `label_font_size`
(px), `label_color` (hex), `label_font_family`. `null` means "use the app's
built-in styling" — no backfill needed for any existing org.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organizations", sa.Column("label_font_size", sa.Integer(), nullable=True)
    )
    op.add_column(
        "organizations", sa.Column("label_color", sa.String(length=20), nullable=True)
    )
    op.add_column(
        "organizations",
        sa.Column("label_font_family", sa.String(length=100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organizations", "label_font_family")
    op.drop_column("organizations", "label_color")
    op.drop_column("organizations", "label_font_size")
