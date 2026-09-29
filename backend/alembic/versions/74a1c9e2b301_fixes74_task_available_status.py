"""fixes74 §2/§4/§11 — "AVAILABLE" task status for unassigned tasks, and
tasks.assigned_at (when the current activist got the task).

Existing orphan tasks stored as ACTIVE become AVAILABLE; ACTIVE now means
"taken" (נלקח) and keeps its stored value. assigned_at is backfilled from
the claim time, or the creation time for a task that already had an activist.

Revision ID: 74a1c9e2b301
Revises: e2f3a4b5c6d7
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "74a1c9e2b301"
down_revision: Union[str, Sequence[str], None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("assigned_at", sa.DateTime(), nullable=True))
    op.execute(
        "UPDATE tasks SET status = 'AVAILABLE' "
        "WHERE status = 'ACTIVE' AND volunteer_user_id IS NULL "
        "AND (claimed_via IS NULL OR claimed_via <> 'paper')"
    )
    op.execute(
        "UPDATE tasks SET assigned_at = COALESCE(claimed_at, created_at) "
        "WHERE volunteer_user_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("UPDATE tasks SET status = 'ACTIVE' WHERE status = 'AVAILABLE'")
    op.drop_column("tasks", "assigned_at")
