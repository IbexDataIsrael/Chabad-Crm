"""fixes54 §8 — organization_prefs table.

Superadmin-managed per-organization feature toggles (Area/Building/Apartment/
Activist module display, AI query) — same key-value-JSON shape as
user_preferences, scoped to organization_id instead of user_id. Purely
additive.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8e9f0a1b2c3d"
down_revision: Union[str, Sequence[str], None] = "7d8e9f0a1b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organization_prefs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False, server_default="null"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_organization_prefs_guid",
        "organization_prefs", ["guid"], unique=True,
    )
    op.create_index(
        "ix_organization_prefs_organization_id",
        "organization_prefs", ["organization_id"],
    )
    op.create_unique_constraint(
        "uq_orgpref_org_key", "organization_prefs", ["organization_id", "key"],
    )


def downgrade() -> None:
    op.drop_table("organization_prefs")
