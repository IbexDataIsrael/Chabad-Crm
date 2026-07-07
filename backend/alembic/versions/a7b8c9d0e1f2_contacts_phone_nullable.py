"""contacts.phone becomes nullable (data import — see docs/data_import-plan.md)

The (organization_id, phone) unique constraint stays: NULLs never collide, so
imported contacts without a phone coexist while real numbers remain unique.

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-07-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, Sequence[str], None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("contacts") as batch_op:
        batch_op.alter_column(
            "phone", existing_type=sa.String(length=50), nullable=True
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("contacts") as batch_op:
        batch_op.alter_column(
            "phone", existing_type=sa.String(length=50), nullable=False
        )
