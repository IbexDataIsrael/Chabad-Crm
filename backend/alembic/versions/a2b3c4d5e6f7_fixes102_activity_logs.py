"""fixes102: per-organization activity log.

Revision ID: a2b3c4d5e6f7
Revises: 98a1b2c3d4e5
Create Date: 2026-10-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, Sequence[str], None] = "98a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("action", sa.String(length=150), nullable=False),
        sa.Column("method", sa.String(length=10), nullable=True),
        sa.Column("route", sa.String(length=300), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("page", sa.String(length=500), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_activity_logs_guid", "activity_logs", ["guid"], unique=True)
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"])
    op.create_index("ix_activity_logs_user_id", "activity_logs", ["user_id"])
    op.create_index(
        "ix_activity_logs_org_created", "activity_logs", ["organization_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("activity_logs")
