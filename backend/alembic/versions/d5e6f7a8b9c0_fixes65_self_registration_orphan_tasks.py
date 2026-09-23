"""fixes65 — public landing page, activist self-registration, orphan tasks,
QR claim audit, paper-entry attribution

- organizations: slug (unique), public_subtitle, public_gallery (JSON list of
  image URLs), self_registration_enabled (default off; turned on for the
  Sheepshead Bay org, matched by name).
- tasks: volunteer_user_id nullable (orphan pool), claimed_at, claimed_via.
- users: registration_source ('public' | 'qr' — null for admin-created).
- task_paper_entries: history of office data entry from paper task sheets.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-09-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, Sequence[str], None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("slug", sa.String(80), nullable=True))
    op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)
    op.add_column("organizations", sa.Column("public_subtitle", sa.Text(), nullable=True))
    op.add_column("organizations", sa.Column("public_gallery", sa.JSON(), nullable=True))
    op.add_column(
        "organizations",
        sa.Column(
            "self_registration_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    with op.batch_alter_table("tasks") as batch:
        batch.alter_column("volunteer_user_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("tasks", sa.Column("claimed_at", sa.DateTime(), nullable=True))
    op.add_column("tasks", sa.Column("claimed_via", sa.String(20), nullable=True))

    op.add_column("users", sa.Column("registration_source", sa.String(20), nullable=True))

    op.create_table(
        "task_paper_entries",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "performer_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("performer_name", sa.String(150), nullable=True),
        sa.Column("performer_unknown", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "entered_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("apartment_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_task_paper_entries_guid", "task_paper_entries", ["guid"], unique=True)
    op.create_index(
        "ix_task_paper_entries_organization_id", "task_paper_entries", ["organization_id"]
    )
    op.create_index("ix_task_paper_entries_task_id", "task_paper_entries", ["task_id"])

    # Spec §1: default OFF, ON for Sheepshead Bay.
    op.execute(
        """
        UPDATE organizations
           SET self_registration_enabled = true,
               slug = 'sheepshead-bay'
         WHERE id = (
            SELECT id FROM organizations
             WHERE name LIKE '%שיפסיידביי%' OR lower(name) LIKE '%sheepshead%'
             ORDER BY id LIMIT 1
         )
        """
    )


def downgrade() -> None:
    op.drop_index("ix_task_paper_entries_task_id", table_name="task_paper_entries")
    op.drop_index("ix_task_paper_entries_organization_id", table_name="task_paper_entries")
    op.drop_index("ix_task_paper_entries_guid", table_name="task_paper_entries")
    op.drop_table("task_paper_entries")
    op.drop_column("users", "registration_source")
    op.drop_column("tasks", "claimed_via")
    op.drop_column("tasks", "claimed_at")
    # Orphan tasks can't survive a NOT NULL volunteer — drop them first.
    op.execute("DELETE FROM tasks WHERE volunteer_user_id IS NULL")
    with op.batch_alter_table("tasks") as batch:
        batch.alter_column("volunteer_user_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("organizations", "self_registration_enabled")
    op.drop_column("organizations", "public_gallery")
    op.drop_column("organizations", "public_subtitle")
    op.drop_index("ix_organizations_slug", table_name="organizations")
    op.drop_column("organizations", "slug")
