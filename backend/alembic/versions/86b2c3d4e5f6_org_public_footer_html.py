"""Add public_footer_html column to organizations table.

Revision ID: 86b2c3d4e5f6
Revises: 85a1b2c3d4e5
Create Date: 2026-10-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "86b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "85a1b2c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("public_footer_html", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "public_footer_html")
