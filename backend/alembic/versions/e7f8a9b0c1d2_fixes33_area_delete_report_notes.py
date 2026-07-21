"""fixes33: buildings.area_id nullable (area delete/unassign) + organizations.report_notes

Revision ID: e7f8a9b0c1d2
Revises: d1e2f3a4b5c6
Create Date: 2026-07-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('buildings', 'area_id', existing_type=sa.Integer(), nullable=True)
    op.add_column('organizations', sa.Column('report_notes', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('organizations', 'report_notes')
    op.alter_column('buildings', 'area_id', existing_type=sa.Integer(), nullable=False)
