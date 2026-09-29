"""fixes74 §11 — shliach_report_completions.task_id: which task an
activist's completion report is about. Existing reports stay unlinked
(NULL) on purpose — nothing guesses which task they belonged to.

Revision ID: 74b2d0f3c412
Revises: 74a1c9e2b301
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "74b2d0f3c412"
down_revision: Union[str, Sequence[str], None] = "74a1c9e2b301"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "shliach_report_completions", sa.Column("task_id", sa.Integer(), nullable=True)
    )
    with op.batch_alter_table("shliach_report_completions") as batch_op:
        batch_op.create_foreign_key(
            "fk_shliach_report_completions_task_id_tasks",
            "tasks", ["task_id"], ["id"], ondelete="SET NULL",
        )
    op.create_index(
        op.f("ix_shliach_report_completions_task_id"),
        "shliach_report_completions", ["task_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_shliach_report_completions_task_id"), table_name="shliach_report_completions"
    )
    with op.batch_alter_table("shliach_report_completions") as batch_op:
        batch_op.drop_constraint(
            "fk_shliach_report_completions_task_id_tasks", type_="foreignkey"
        )
    op.drop_column("shliach_report_completions", "task_id")
