"""fixes14: per-org email uniqueness + system access logs

- users.email: global unique index -> non-unique index + per-org unique
  constraint (the same email may exist in several organizations).
- users.google_sub: unique index -> non-unique (one binding per org).
- new system_access_logs audit table (every login attempt).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, Sequence[str], None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
    op.create_unique_constraint(
        "uq_user_org_email", "users", ["organization_id", "email"]
    )

    op.drop_index(op.f("ix_users_google_sub"), table_name="users")
    op.create_index(
        op.f("ix_users_google_sub"), "users", ["google_sub"], unique=False
    )

    op.create_table(
        "system_access_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("time", sa.Time(), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_system_access_logs_guid"), "system_access_logs", ["guid"], unique=True
    )
    op.create_index(
        op.f("ix_system_access_logs_date"), "system_access_logs", ["date"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_system_access_logs_date"), table_name="system_access_logs")
    op.drop_index(op.f("ix_system_access_logs_guid"), table_name="system_access_logs")
    op.drop_table("system_access_logs")

    op.drop_index(op.f("ix_users_google_sub"), table_name="users")
    op.create_index(
        op.f("ix_users_google_sub"), "users", ["google_sub"], unique=True
    )

    op.drop_constraint("uq_user_org_email", "users", type_="unique")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
