"""fixes74 §12 — street_activity_events (an activist's street2 mark /
unmark / building-complete log, as synced from their device) and
users.street_synced_at (when their street2 last reached the server).

Revision ID: 74c3e1a4d523
Revises: 74b2d0f3c412
Create Date: 2026-09-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "74c3e1a4d523"
down_revision: Union[str, Sequence[str], None] = "74b2d0f3c412"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "street_activity_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("apartment_id", sa.Integer(), nullable=True),
        sa.Column("building_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=300), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["building_id"], ["buildings.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_street_activity_events_guid"), "street_activity_events", ["guid"], unique=True
    )
    op.create_index(
        op.f("ix_street_activity_events_organization_id"),
        "street_activity_events", ["organization_id"], unique=False,
    )
    op.create_index(
        "ix_street_activity_events_user_occurred",
        "street_activity_events", ["user_id", "occurred_at"], unique=False,
    )
    op.add_column("users", sa.Column("street_synced_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "street_synced_at")
    op.drop_index("ix_street_activity_events_user_occurred", table_name="street_activity_events")
    op.drop_index(
        op.f("ix_street_activity_events_organization_id"), table_name="street_activity_events"
    )
    op.drop_index(op.f("ix_street_activity_events_guid"), table_name="street_activity_events")
    op.drop_table("street_activity_events")
