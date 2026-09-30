"""fixes75 §4/§5/§9 — error_logs table; system_access_logs gains the IP,
the resolved user and organization; organizations.errors_admin_emails.

Revision ID: 75d1e2f3a401
Revises: 74c3e1a4d523
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "75d1e2f3a401"
down_revision: Union[str, Sequence[str], None] = "74c3e1a4d523"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "error_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("method", sa.String(length=10), nullable=True),
        sa.Column("path", sa.String(length=500), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("error_type", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("traceback", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_error_logs_guid", "error_logs", ["guid"], unique=True)
    op.create_index("ix_error_logs_created_at", "error_logs", ["created_at"])
    op.create_index("ix_error_logs_organization_id", "error_logs", ["organization_id"])
    op.create_index("ix_error_logs_user_id", "error_logs", ["user_id"])

    with op.batch_alter_table("system_access_logs") as batch:
        batch.add_column(sa.Column("ip_address", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("organization_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_system_access_logs_user_id", "users", ["user_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_foreign_key(
            "fk_system_access_logs_organization_id", "organizations",
            ["organization_id"], ["id"], ondelete="SET NULL",
        )
        batch.create_index("ix_system_access_logs_user_id", ["user_id"])
        batch.create_index("ix_system_access_logs_organization_id", ["organization_id"])
        batch.create_index("ix_system_access_logs_created_at", ["created_at"])

    with op.batch_alter_table("organizations") as batch:
        batch.add_column(sa.Column("errors_admin_emails", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("organizations") as batch:
        batch.drop_column("errors_admin_emails")
    with op.batch_alter_table("system_access_logs") as batch:
        batch.drop_index("ix_system_access_logs_created_at")
        batch.drop_index("ix_system_access_logs_organization_id")
        batch.drop_index("ix_system_access_logs_user_id")
        batch.drop_constraint("fk_system_access_logs_organization_id", type_="foreignkey")
        batch.drop_constraint("fk_system_access_logs_user_id", type_="foreignkey")
        batch.drop_column("organization_id")
        batch.drop_column("user_id")
        batch.drop_column("ip_address")
    op.drop_table("error_logs")
