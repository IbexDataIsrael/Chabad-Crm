"""fixes17: user_preferences table — per-user UI preferences in the DB.

Column selections and the interface language used to live in localStorage;
storing them per user makes them follow the account across browsers/devices.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-12 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, Sequence[str], None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_preferences",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "key", name="uq_userpref_user_key"),
    )
    op.create_index(
        op.f("ix_user_preferences_guid"), "user_preferences", ["guid"], unique=True
    )
    op.create_index(
        op.f("ix_user_preferences_user_id"),
        "user_preferences",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_user_preferences_user_id"), table_name="user_preferences")
    op.drop_index(op.f("ix_user_preferences_guid"), table_name="user_preferences")
    op.drop_table("user_preferences")
