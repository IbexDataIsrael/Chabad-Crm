"""fixes43 §3.1: contact_shliach_edit_history — field-level audit trail for
shliach coverage data (notes/area_ids/report_number_ids).

Revision ID: 2b3c4d5e6f7a
Revises: 1a2b3c4d5e6f
Create Date: 2026-08-10 00:00:01.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2b3c4d5e6f7a"
down_revision: Union[str, Sequence[str], None] = "1a2b3c4d5e6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "contact_shliach_edit_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "contact_shliach_id",
            sa.Integer(),
            sa.ForeignKey("contact_shliach.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field", sa.String(length=50), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column(
            "editor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("changed_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_contact_shliach_edit_history_organization_id",
        "contact_shliach_edit_history",
        ["organization_id"],
    )
    op.create_index(
        "ix_contact_shliach_edit_history_contact_shliach_id",
        "contact_shliach_edit_history",
        ["contact_shliach_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_contact_shliach_edit_history_contact_shliach_id",
        table_name="contact_shliach_edit_history",
    )
    op.drop_index(
        "ix_contact_shliach_edit_history_organization_id",
        table_name="contact_shliach_edit_history",
    )
    op.drop_table("contact_shliach_edit_history")
