"""fixes72 §A/§B — campaign_building_completion table + apartments.campaign_id
(for the new read-time per-campaign change-history view).

Revision ID: e2f3a4b5c6d7
Revises: d4a7c9e21b3f
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"
down_revision: Union[str, Sequence[str], None] = "d4a7c9e21b3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaign_building_completion",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=False),
        sa.Column("building_id", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.Column("completed_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"]),
        sa.ForeignKeyConstraint(["building_id"], ["buildings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["completed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "campaign_id", "building_id",
            name="uq_campaignbuildingcompletion_campaign_building",
        ),
    )
    op.create_index(
        op.f("ix_campaign_building_completion_guid"),
        "campaign_building_completion", ["guid"], unique=True,
    )
    op.create_index(
        op.f("ix_campaign_building_completion_campaign_id"),
        "campaign_building_completion", ["campaign_id"], unique=False,
    )
    op.create_index(
        op.f("ix_campaign_building_completion_building_id"),
        "campaign_building_completion", ["building_id"], unique=False,
    )

    op.add_column("apartments", sa.Column("campaign_id", sa.Integer(), nullable=True))
    with op.batch_alter_table("apartments") as batch_op:
        batch_op.create_foreign_key(
            "fk_apartments_campaign_id_campaigns",
            "campaigns", ["campaign_id"], ["id"], ondelete="SET NULL",
        )
    op.create_index(
        op.f("ix_apartments_campaign_id"), "apartments", ["campaign_id"], unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_apartments_campaign_id"), table_name="apartments")
    with op.batch_alter_table("apartments") as batch_op:
        batch_op.drop_constraint("fk_apartments_campaign_id_campaigns", type_="foreignkey")
    op.drop_column("apartments", "campaign_id")

    op.drop_index(
        op.f("ix_campaign_building_completion_building_id"),
        table_name="campaign_building_completion",
    )
    op.drop_index(
        op.f("ix_campaign_building_completion_campaign_id"),
        table_name="campaign_building_completion",
    )
    op.drop_index(
        op.f("ix_campaign_building_completion_guid"),
        table_name="campaign_building_completion",
    )
    op.drop_table("campaign_building_completion")
