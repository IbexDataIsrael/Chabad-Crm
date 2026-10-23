"""fixes109: task date & time (tasks.scheduled_at).

Revision ID: 109a7c3e2d41
Revises: a2b3c4d5e6f7
Create Date: 2026-10-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "109a7c3e2d41"
down_revision: Union[str, Sequence[str], None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("scheduled_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "scheduled_at")
