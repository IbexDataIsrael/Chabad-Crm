"""fixes19: report numbers, apartment versioning, town houses.

- New `report_number` (org-scoped) + `report_number_contact_shliach` bridge.
- Drop `contact_shliach_apartment` (shliach↔apartment coverage is replaced by
  the report-number association).
- `apartments`: versioning columns (is_display / last_edit / editor_id /
  root_id) + report_number_id.
- `buildings`: is_town_house flag.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-07-13 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, Sequence[str], None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- report_number (מספר דוח) ---
    op.create_table(
        "report_number",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_report_number_guid", "report_number", ["guid"], unique=True)
    op.create_index(
        "ix_report_number_organization_id", "report_number", ["organization_id"]
    )

    # --- report_number ↔ contact_shliach bridge ---
    op.create_table(
        "report_number_contact_shliach",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "report_number_id",
            sa.Integer(),
            sa.ForeignKey("report_number.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "contact_shliach_id",
            sa.Integer(),
            sa.ForeignKey("contact_shliach.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "report_number_id", "contact_shliach_id", name="uq_report_shliach"
        ),
    )
    op.create_index(
        "ix_report_number_contact_shliach_guid",
        "report_number_contact_shliach",
        ["guid"],
        unique=True,
    )
    op.create_index(
        "ix_report_number_contact_shliach_organization_id",
        "report_number_contact_shliach",
        ["organization_id"],
    )
    op.create_index(
        "ix_report_number_contact_shliach_report_number_id",
        "report_number_contact_shliach",
        ["report_number_id"],
    )
    op.create_index(
        "ix_report_number_contact_shliach_contact_shliach_id",
        "report_number_contact_shliach",
        ["contact_shliach_id"],
    )

    # --- drop the shliach↔apartment coverage bridge (fixes19 §1) ---
    op.drop_index(
        "ix_contact_shliach_apartment_organization_id",
        table_name="contact_shliach_apartment",
    )
    op.drop_index(
        "ix_contact_shliach_apartment_guid", table_name="contact_shliach_apartment"
    )
    op.drop_index(
        "ix_contact_shliach_apartment_contact_shliach_id",
        table_name="contact_shliach_apartment",
    )
    op.drop_index(
        "ix_contact_shliach_apartment_apartment_id",
        table_name="contact_shliach_apartment",
    )
    op.drop_table("contact_shliach_apartment")

    # --- apartments: versioning + report number (fixes19 §1/§3) ---
    with op.batch_alter_table("apartments") as batch_op:
        batch_op.add_column(
            sa.Column(
                "report_number_id",
                sa.Integer(),
                sa.ForeignKey("report_number.id"),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "is_display",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("true"),
            )
        )
        batch_op.add_column(sa.Column("last_edit", sa.DateTime(), nullable=True))
        # SET NULL: editor_id must never block a user delete, and root_id is a
        # self-FK — cascade deletes would otherwise depend on row ordering.
        batch_op.add_column(
            sa.Column(
                "editor_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "root_id",
                sa.Integer(),
                sa.ForeignKey("apartments.id", ondelete="SET NULL"),
                nullable=True,
            )
        )
    op.create_index("ix_apartments_report_number_id", "apartments", ["report_number_id"])
    op.create_index("ix_apartments_root_id", "apartments", ["root_id"])

    # --- buildings: town house flag (fixes19 §4) ---
    with op.batch_alter_table("buildings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_town_house",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("buildings") as batch_op:
        batch_op.drop_column("is_town_house")

    op.drop_index("ix_apartments_root_id", table_name="apartments")
    op.drop_index("ix_apartments_report_number_id", table_name="apartments")
    with op.batch_alter_table("apartments") as batch_op:
        batch_op.drop_column("root_id")
        batch_op.drop_column("editor_id")
        batch_op.drop_column("last_edit")
        batch_op.drop_column("is_display")
        batch_op.drop_column("report_number_id")

    op.create_table(
        "contact_shliach_apartment",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "contact_shliach_id",
            sa.Integer(),
            sa.ForeignKey("contact_shliach.id"),
            nullable=False,
        ),
        sa.Column(
            "apartment_id",
            sa.Integer(),
            sa.ForeignKey("apartments.id"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "contact_shliach_id", "apartment_id", name="uq_shliach_apartment"
        ),
    )
    op.create_index(
        "ix_contact_shliach_apartment_apartment_id",
        "contact_shliach_apartment",
        ["apartment_id"],
    )
    op.create_index(
        "ix_contact_shliach_apartment_contact_shliach_id",
        "contact_shliach_apartment",
        ["contact_shliach_id"],
    )
    op.create_index(
        "ix_contact_shliach_apartment_guid",
        "contact_shliach_apartment",
        ["guid"],
        unique=True,
    )
    op.create_index(
        "ix_contact_shliach_apartment_organization_id",
        "contact_shliach_apartment",
        ["organization_id"],
    )
    op.drop_table("report_number_contact_shliach")  # indexes drop with the table
    op.drop_index("ix_report_number_organization_id", table_name="report_number")
    op.drop_index("ix_report_number_guid", table_name="report_number")
    op.drop_table("report_number")
