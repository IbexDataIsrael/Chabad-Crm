"""fixes118: assistant_requests (the helper's request_id proof of write).

Revision ID: 118a1b2c3d4e
Revises: 113b2c4d6e8f
Create Date: 2026-10-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "118a1b2c3d4e"
down_revision: Union[str, Sequence[str], None] = "113b2c4d6e8f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("result_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "request_id", name="uq_assistant_request_user_request"),
    )
    op.create_index("ix_assistant_requests_organization_id", "assistant_requests", ["organization_id"])
    op.create_index("ix_assistant_requests_user_id", "assistant_requests", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_requests_user_id", table_name="assistant_requests")
    op.drop_index("ix_assistant_requests_organization_id", table_name="assistant_requests")
    op.drop_table("assistant_requests")
