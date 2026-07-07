"""fixes9: system_settings table, admin_areas entity, mekurav admin_area/tzedaka

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- Global (non-tenant) superadmin-editable settings (fixes9 §1) ---
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_system_settings_guid", "system_settings", ["guid"], unique=True)
    op.create_index("ix_system_settings_key", "system_settings", ["key"], unique=True)

    # --- New admin_areas entity (fixes9 §2) ---
    op.create_table(
        "admin_areas",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_admin_areas_guid", "admin_areas", ["guid"], unique=True)
    op.create_index("ix_admin_areas_organization_id", "admin_areas", ["organization_id"])

    # --- contact_mekurav: admin_area FK (§2C) + tzedaka_potential (§3) ---
    with op.batch_alter_table("contact_mekurav") as batch_op:
        batch_op.add_column(sa.Column("admin_area_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("tzedaka_potential", sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            "fk_contact_mekurav_admin_area_id",
            "admin_areas",
            ["admin_area_id"],
            ["id"],
        )
    op.create_index(
        "ix_contact_mekurav_admin_area_id", "contact_mekurav", ["admin_area_id"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_contact_mekurav_admin_area_id", table_name="contact_mekurav")
    with op.batch_alter_table("contact_mekurav") as batch_op:
        batch_op.drop_constraint("fk_contact_mekurav_admin_area_id", type_="foreignkey")
        batch_op.drop_column("tzedaka_potential")
        batch_op.drop_column("admin_area_id")

    op.drop_index("ix_admin_areas_organization_id", table_name="admin_areas")
    op.drop_index("ix_admin_areas_guid", table_name="admin_areas")
    op.drop_table("admin_areas")

    op.drop_index("ix_system_settings_key", table_name="system_settings")
    op.drop_index("ix_system_settings_guid", table_name="system_settings")
    op.drop_table("system_settings")
