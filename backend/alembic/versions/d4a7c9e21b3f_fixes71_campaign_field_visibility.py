"""fixes71 §B — campaign_field_visibility (per-campaign apartment field hide/show)

Revision ID: d4a7c9e21b3f
Revises: cfead2898e35
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4a7c9e21b3f"
down_revision: Union[str, Sequence[str], None] = "cfead2898e35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaign_field_visibility",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("field_key", sa.String(length=150), nullable=False),
        sa.Column("is_visible", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "campaign_id", "field_key", name="uq_campaignfieldvis_campaign_key"
        ),
    )
    op.create_index(
        op.f("ix_campaign_field_visibility_guid"),
        "campaign_field_visibility",
        ["guid"],
        unique=True,
    )
    op.create_index(
        op.f("ix_campaign_field_visibility_campaign_id"),
        "campaign_field_visibility",
        ["campaign_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_campaign_field_visibility_campaign_id"),
        table_name="campaign_field_visibility",
    )
    op.drop_index(
        op.f("ix_campaign_field_visibility_guid"), table_name="campaign_field_visibility"
    )
    op.drop_table("campaign_field_visibility")
