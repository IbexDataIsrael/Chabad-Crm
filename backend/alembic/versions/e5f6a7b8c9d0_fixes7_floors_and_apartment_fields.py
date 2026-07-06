"""fixes7: floors table, optional building/apartment names, apartment data fields

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- New floors table (each floor belongs to a building; cascade delete) ---
    op.create_table(
        "floors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "building_id",
            sa.Integer(),
            sa.ForeignKey("buildings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_floors_guid", "floors", ["guid"], unique=True)
    op.create_index("ix_floors_organization_id", "floors", ["organization_id"])
    op.create_index("ix_floors_building_id", "floors", ["building_id"])

    # --- building_name is no longer required (fixes7 §2) ---
    with op.batch_alter_table("buildings") as batch_op:
        batch_op.alter_column(
            "building_name", existing_type=sa.String(length=150), nullable=True
        )

    # --- apartment_name is no longer required; new apartment data fields (§4) ---
    with op.batch_alter_table("apartments") as batch_op:
        batch_op.alter_column(
            "apartment_name", existing_type=sa.String(length=150), nullable=True
        )
        batch_op.add_column(sa.Column("floor", sa.String(length=50), nullable=True))
        batch_op.add_column(
            sa.Column("jewish_status", sa.String(length=100), nullable=True)
        )
        batch_op.add_column(
            sa.Column("campaign_status", sa.String(length=100), nullable=True)
        )
        batch_op.add_column(
            sa.Column("mezuzah_status", sa.String(length=100), nullable=True)
        )
        batch_op.add_column(sa.Column("name", sa.String(length=150), nullable=True))
        batch_op.add_column(sa.Column("phone", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("email", sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("apartments") as batch_op:
        batch_op.drop_column("email")
        batch_op.drop_column("phone")
        batch_op.drop_column("name")
        batch_op.drop_column("mezuzah_status")
        batch_op.drop_column("campaign_status")
        batch_op.drop_column("jewish_status")
        batch_op.drop_column("floor")
        batch_op.alter_column(
            "apartment_name", existing_type=sa.String(length=150), nullable=False
        )

    with op.batch_alter_table("buildings") as batch_op:
        batch_op.alter_column(
            "building_name", existing_type=sa.String(length=150), nullable=False
        )

    op.drop_index("ix_floors_building_id", table_name="floors")
    op.drop_index("ix_floors_organization_id", table_name="floors")
    op.drop_index("ix_floors_guid", table_name="floors")
    op.drop_table("floors")
