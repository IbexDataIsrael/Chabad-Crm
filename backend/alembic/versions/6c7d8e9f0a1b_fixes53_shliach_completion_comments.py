"""fixes53 §7/§9 — shliach report-completion + system-comments logs.

Two new append-only tables backing the self-edit page's "Report completed"
and "Comments about the system" buttons, and the /dashboard/messages-from-
activists page that lists them:

- shliach_report_completions: one row per submission (status +
  optional comments), keyed by contacts.id (stable — unlike
  contact_shliach.id, which is versioned and changes on every profile edit).
- shliach_system_comments: one row per free-text system-feedback submission.

Both are purely additive; nothing existing changes shape.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6c7d8e9f0a1b"
down_revision: Union[str, Sequence[str], None] = "5b6c7d8e9f0a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "shliach_report_completions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "contact_id",
            sa.Integer(),
            sa.ForeignKey("contacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_shliach_report_completions_guid",
        "shliach_report_completions", ["guid"], unique=True,
    )
    op.create_index(
        "ix_shliach_report_completions_organization_id",
        "shliach_report_completions", ["organization_id"],
    )
    op.create_index(
        "ix_shliach_report_completions_contact_id",
        "shliach_report_completions", ["contact_id"],
    )

    op.create_table(
        "shliach_system_comments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("guid", sa.String(length=36), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "contact_id",
            sa.Integer(),
            sa.ForeignKey("contacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_shliach_system_comments_guid",
        "shliach_system_comments", ["guid"], unique=True,
    )
    op.create_index(
        "ix_shliach_system_comments_organization_id",
        "shliach_system_comments", ["organization_id"],
    )
    op.create_index(
        "ix_shliach_system_comments_contact_id",
        "shliach_system_comments", ["contact_id"],
    )


def downgrade() -> None:
    op.drop_table("shliach_system_comments")
    op.drop_table("shliach_report_completions")
