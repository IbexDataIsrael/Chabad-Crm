"""fixes16: org_backups table — per-organization backup/restore points.

Each row is one restore point: metadata + the organization's CRM data as a
zlib-compressed JSON blob (stored in-DB because the app server's disk is
ephemeral). Retention (last 10 per org) is enforced by the application.

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-07-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, Sequence[str], None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "org_backups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("created_by_name", sa.String(length=150), nullable=True),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("counts", sa.Text(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_org_backups_guid"), "org_backups", ["guid"], unique=True)
    op.create_index(
        op.f("ix_org_backups_organization_id"),
        "org_backups",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_org_backups_created_at"), "org_backups", ["created_at"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_org_backups_created_at"), table_name="org_backups")
    op.drop_index(op.f("ix_org_backups_organization_id"), table_name="org_backups")
    op.drop_index(op.f("ix_org_backups_guid"), table_name="org_backups")
    op.drop_table("org_backups")
