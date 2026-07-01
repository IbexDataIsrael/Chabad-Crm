"""visit_history: nullable contact_id + visit_type + location

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Promote visits to a first-class entity: optional contact + type + location."""
    # batch_alter_table so the contact_id nullability change works on SQLite too.
    with op.batch_alter_table("visit_history") as batch:
        batch.add_column(sa.Column("visit_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("location", sa.Text(), nullable=True))
        batch.alter_column("contact_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("visit_history") as batch:
        batch.alter_column("contact_id", existing_type=sa.Integer(), nullable=False)
        batch.drop_column("location")
        batch.drop_column("visit_type")
