"""fixes85 — organizations.name_en + public_subtitle_en: a separate English
title and subtitle, shown when the app / public page is viewed in English
(falls back to the Hebrew name / subtitle when blank).

Revision ID: 85a1b2c3d4e5
Revises: 75d1e2f3a401
Create Date: 2026-10-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "85a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "75d1e2f3a401"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("name_en", sa.String(length=150), nullable=True))
    op.add_column("organizations", sa.Column("public_subtitle_en", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "public_subtitle_en")
    op.drop_column("organizations", "name_en")
