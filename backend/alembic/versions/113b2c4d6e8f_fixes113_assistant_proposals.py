"""fixes113: assistant_proposals (confirm-before-write + idempotency).

Revision ID: 113b2c4d6e8f
Revises: 109a7c3e2d41
Create Date: 2026-10-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "113b2c4d6e8f"
down_revision: Union[str, Sequence[str], None] = "109a7c3e2d41"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assistant_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("result_contact_id", sa.Integer(), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_assistant_proposals_organization_id", "assistant_proposals", ["organization_id"])
    op.create_index("ix_assistant_proposals_user_id", "assistant_proposals", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_proposals_user_id", table_name="assistant_proposals")
    op.drop_index("ix_assistant_proposals_organization_id", table_name="assistant_proposals")
    op.drop_table("assistant_proposals")
