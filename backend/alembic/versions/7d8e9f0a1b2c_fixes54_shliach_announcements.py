"""fixes54 §5 — shliach_announcements table.

One new table backing the WYSIWYG-managed admin announcements shown to
activists on their dedicated landing page (`/dashboard/activist`). Purely
additive.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7d8e9f0a1b2c"
down_revision: Union[str, Sequence[str], None] = "6c7d8e9f0a1b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shliach_announcements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("message_title", sa.String(length=255), nullable=False),
        sa.Column("message_content", sa.Text(), nullable=False),
        sa.Column(
            "is_visible", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_shliach_announcements_guid",
        "shliach_announcements", ["guid"], unique=True,
    )
    op.create_index(
        "ix_shliach_announcements_organization_id",
        "shliach_announcements", ["organization_id"],
    )


def downgrade() -> None:
    op.drop_table("shliach_announcements")
