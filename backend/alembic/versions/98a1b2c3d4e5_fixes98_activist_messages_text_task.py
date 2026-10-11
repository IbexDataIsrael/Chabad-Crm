"""fixes98: text tasks, activist messages, per-org activist stats.

Also adds organizations.public_footer_html_en (the model already declares it;
guarded, so a DB that got it some other way is left alone).

Revision ID: 98a1b2c3d4e5
Revises: 86b2c3d4e5f6
Create Date: 2026-10-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "98a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "86b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    if not _has_column("organizations", "public_footer_html_en"):
        op.add_column(
            "organizations", sa.Column("public_footer_html_en", sa.Text(), nullable=True)
        )
    op.add_column("tasks", sa.Column("task_text", sa.Text(), nullable=True))

    op.create_table(
        "activist_messages",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("language", sa.String(5), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_activist_messages_guid", "activist_messages", ["guid"], unique=True)
    op.create_index(
        "ix_activist_messages_organization_id", "activist_messages", ["organization_id"]
    )

    op.create_table(
        "org_activist_stats",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("organization_name", sa.String(200), nullable=False),
        sa.Column("number_of_apartments", sa.Integer(), nullable=False),
        sa.Column("number_of_jews", sa.Integer(), nullable=False),
        sa.Column("calculated_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_org_activist_stats_guid", "org_activist_stats", ["guid"], unique=True)
    op.create_index(
        "ix_org_activist_stats_organization_id",
        "org_activist_stats",
        ["organization_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_org_activist_stats_organization_id", table_name="org_activist_stats")
    op.drop_table("org_activist_stats")
    op.drop_index("ix_activist_messages_organization_id", table_name="activist_messages")
    op.drop_table("activist_messages")
    op.drop_column("tasks", "task_text")
